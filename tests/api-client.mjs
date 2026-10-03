/**
 * Headless driver helpers for the dsh web HTTP API (the same Typert gateway
 * surface the browser client uses).
 *
 * Transport facts (from packages/api/gateway + packages/client/connection):
 * - GET  /?token=<token>  answers the page and sets the auth cookie.
 * - POST /api/<method>    with a `client-request` JSON envelope answers a
 *   `server-response` envelope whose `result` is RemoteResult { ok, value|error }.
 * - rpcId is a client-minted string echoed by the response.
 *
 * Usage: node tests/api-client.mjs is never run directly; the round scripts
 * import { connect } from it.
 */
import { readFileSync } from 'node:fs'

/** Read a possibly UTF-16 (PowerShell-redirected) log file as text. */
function readAnyEncoding(path) {
  const bytes = readFileSync(path)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le')
  return bytes.toString('utf8')
}

/** Extract the last `dsh web: http://.../?token=...` line from a server log. */
export function serverUrlFromLog(logPath) {
  const text = readAnyEncoding(logPath)
  const lines = text.split(/\r?\n/u).filter(line => line.includes('token='))
  const last = lines.at(-1)
  if (last === undefined) throw new Error(`no token line found in ${logPath}`)
  const match = /https?:\/\/\S+\/\?token=(\S+)/u.exec(last)
  if (match === null) throw new Error(`no URL+token in line: ${last}`)
  return { origin: new URL(match[0]).origin, token: match[1] }
}

let rpcSeq = 0

/**
 * Connect one headless API client.
 * @param {{ origin: string, token: string }} - authenticated URL facts.
 * @returns API facade: rpc(method, args), plus typed wrappers.
 */
export async function connect({ origin, token }) {
  // Token exchange answers 303 with the auth cookie (fetch would otherwise
  // follow it to the clean URL and drop the cookie); then load the page with
  // the cookie, exactly like the browser's two-step redirect.
  const exchange = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  if (exchange.status !== 303) {
    throw new Error(`token exchange expected 303, got ${exchange.status}: ${await exchange.text()}`)
  }
  const setCookie = exchange.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map(value => value.split(';', 1)[0]).join('; ')
  if (cookie === '') throw new Error('token exchange returned no set-cookie')
  const index = await fetch(`${origin}/`, { headers: { cookie, accept: 'text/html' } })
  if (!index.ok) throw new Error(`index GET failed: ${index.status}`)
  const html = await index.text()
  const headers = { 'content-type': 'application/json' }
  if (cookie !== '') headers.cookie = cookie

  /**
   * One unary gateway call.
   * @param {string} method - namespaced endpoint, e.g. 'commands/execute'.
   * @param {Record<string, unknown>} args - exact named wire arguments.
   * @returns the unwrapped business value; throws on wire/carrier failure.
   */
  async function rpc(method, args) {
    const rpcId = `test-${++rpcSeq}`
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`)
    const body = await response.json()
    if (body?.type !== 'server-response' || body.rpcId !== rpcId) {
      throw new Error(`${method}: invalid server-response envelope ${JSON.stringify(body)}`)
    }
    const result = body.result
    if (result === undefined || typeof result !== 'object') {
      throw new Error(`${method}: invalid server-response result`)
    }
    if (result.ok !== true) {
      throw new Error(`${method}: remote error ${result.error?.code}: ${result.error?.message}`)
    }
    return result.value
  }

  return {
    origin,
    token,
    html,
    rpc,
    /** Create one ordinary session and return its sessionId. */
    createSession: async () => (await rpc('session/create', { request: {} })).sessionId,
    /** Effective command descriptors for one agent. */
    listCommands: sessionId => rpc('commands/list', { agentId: sessionId }),
    /** Execute one slash-command line; returns CommandExecution|undefined. */
    executeCommand: (sessionId, line) =>
      rpc('commands/execute', { agentId: sessionId, line, submittedAttachments: [] }),
    /** Projection baseline (contains subagentCatalog) for one session. */
    projections: sessionId => rpc('session/projections', { request: { sessionId } }),
    /**
     * Message-aligned history page for one durable address. `throughSeq` must
     * be a concrete log cut (e.g. projections.asOfSeq); -1 paginates to an
     * empty window by design.
     */
    page: (address, throughSeq, maxMessages = 50) =>
      rpc('session/page', { request: { address, throughSeq, maxMessages } }),
  }
}
