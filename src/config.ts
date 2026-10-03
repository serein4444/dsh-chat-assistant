/**
 * Shared JSON-safe configuration for both plugin faces (host + browser).
 *
 * No `Config` schema export: `@deepseek-ai/schemastery` is a vendored dsh
 * package, and this external plugin keeps zero runtime package imports, so
 * the row's config flows through unvalidated and {@link normalizeConfig}
 * validates it loudly at load instead.
 */

/** Resolved configuration shared by the host command and the browser face. */
export interface ChatAssistantConfig {
  /** Slash command names to register; the first one is the canonical creator. */
  readonly commandNames: readonly string[]
  /** Show the selection chip ("打开辅助对话") when text is selected in the page. */
  readonly selectionChip: boolean
}

/** Default command names: `/side` primary, `/btw` as the ZCode synonym. */
export const DEFAULT_COMMAND_NAMES: readonly string[] = ['side', 'btw']

const KNOWN_KEYS = new Set(['commandNames', 'selectionChip'])

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

function fail(key: string, problem: string): never {
  throw new Error(`dsh-chat-assistant: config.${key} ${problem}`)
}

function requireObject(raw: unknown): Readonly<Record<string, unknown>> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('', 'must be an object when present')
  return raw as Readonly<Record<string, unknown>>
}

/**
 * Validate and default one composed row config. Fails loud on wrong types,
 * unknown keys (typo protection), and malformed command names.
 *
 * History note: the 0.1.x subagent-era keys (`provider`, `label`,
 * `standbyPrompt`, `agentOptions`) were removed with the fork redesign
 * (方案 B) and are now rejected as unknown so stale row configs surface
 * instead of silently doing nothing.
 *
 * @param raw - the composed `config` value of the plugin row.
 * @returns the resolved configuration both faces use.
 */
export function normalizeConfig(raw: unknown): ChatAssistantConfig {
  const source = requireObject(raw)
  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.has(key)) fail(key, 'is not a recognized configuration key')
  }

  let commandNames = DEFAULT_COMMAND_NAMES
  if (source.commandNames !== undefined) {
    if (!Array.isArray(source.commandNames) || source.commandNames.length === 0) {
      fail('commandNames', 'must be a non-empty string array when present')
    }
    for (const name of source.commandNames) {
      if (typeof name !== 'string' || !COMMAND_NAME.test(name)) {
        fail('commandNames', `entries must match ${COMMAND_NAME.source}, got ${JSON.stringify(name)}`)
      }
    }
    commandNames = [...source.commandNames]
  }

  if (source.selectionChip !== undefined && typeof source.selectionChip !== 'boolean') {
    fail('selectionChip', 'must be a boolean when present')
  }

  return {
    commandNames,
    selectionChip: source.selectionChip ?? true,
  }
}
