// Headless probe: does sessions.fork create a listed child with the parent prefix?
import { connect, serverUrlFromLog } from './api-client.mjs'

const api = await connect(serverUrlFromLog(process.argv[2] ?? '../chat-assistant/dev-server.log'))

// 1) find a parent WITH content: non-blank session
const list = await api.rpc('session/list', { _request: {} })
const items = (list?.items ?? []).filter(item => item.blank !== true)
console.log('non-blank sessions:', items.length)
for (const item of items.slice(0, 4)) {
  console.log('  ', item.sessionId, JSON.stringify(item.displayTitle ?? ''), 'blank:', item.blank)
}
const parent = items[0]?.sessionId
if (parent === undefined) { console.log('no non-blank sessions'); process.exit(1) }
console.log('forking parent:', parent)

// 2) fork it
const fork = await api.rpc('session/fork', { request: { sessionId: parent } })
console.log('fork result:', JSON.stringify(fork))
const childId = fork?.sessionId

// 3) is the child in the session list?
const list2 = await api.rpc('session/list', { _request: {} })
const items2 = list2?.items ?? []
const childRow = items2.find(item => item.sessionId === childId)
console.log('child in list:', childRow !== undefined, 'blank:', childRow?.blank, 'title:', JSON.stringify(childRow?.displayTitle ?? childRow?.title ?? null))

// 4) child history page — does it carry the copied prefix?
const projections = await api.rpc('session/projections', { request: { sessionId: childId } })
console.log('child asOfSeq:', projections?.asOfSeq)
const page = await api.rpc('session/page', {
  request: { address: { kind: 'session', sessionId: childId }, throughSeq: projections?.asOfSeq ?? 0, maxMessages: 5 },
})
const records = page?.records ?? []
console.log('child page records:', records.length)
for (const record of records.slice(0, 4)) {
  console.log('  event:', record?.event?.type)
}
console.log('done')
process.exit(0)
