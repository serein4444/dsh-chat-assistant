/**
 * Parent→aux-child registry for the fork-based auxiliary chat (方案 B).
 *
 * Fork sessions carry no platform-level parent linkage, so this plugin keeps
 * its own durable mapping in localStorage: which forked sessions belong to
 * which parent, with their display label and creation time. Pruning drops
 * entries whose session no longer exists in the Host catalog.
 */

/** One registered aux child of a parent session. */
export interface AuxChildRecord {
  readonly childId: string
  readonly label: string
  readonly createdAt: number
}

/** Persisted registry shape. */
export interface AuxRegistry {
  readonly byParent: Readonly<Record<string, readonly AuxChildRecord[]>>
}

/** Storage key (versioned; bump on breaking shape changes). */
const REGISTRY_KEY = 'dsh.chat-assistant.registry.v1'

function readRegistry(): AuxRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    if (raw === null) return { byParent: {} }
    const parsed = JSON.parse(raw) as AuxRegistry
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.byParent !== 'object') {
      return { byParent: {} }
    }
    // Harden the read path: a corrupted key (null entries, wrong shapes) must
    // not throw inside UI reads — drop malformed arrays and entries outright.
    const byParent: Record<string, readonly AuxChildRecord[]> = {}
    for (const [parent, entries] of Object.entries(parsed.byParent)) {
      if (!Array.isArray(entries)) continue
      const valid = entries.filter((entry): entry is AuxChildRecord =>
        typeof entry === 'object' && entry !== null
        && typeof (entry as AuxChildRecord).childId === 'string'
        && typeof (entry as AuxChildRecord).label === 'string'
        && typeof (entry as AuxChildRecord).createdAt === 'number')
      if (valid.length > 0) byParent[parent] = valid
    }
    return { byParent }
  } catch (_unreadable) {
    return { byParent: {} }
  }
}

function writeRegistry(registry: AuxRegistry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
  } catch (_storageUnavailable) {
    /* Registry state is best-effort; the plugin still functions per page. */
  }
}

/**
 * List one parent's aux children, oldest first.
 * @param parentSessionId - parent session id.
 * @returns registered children (a defensive copy).
 */
export function auxChildrenOf(parentSessionId: string): AuxChildRecord[] {
  const entries = readRegistry().byParent[parentSessionId] ?? []
  return [...entries].sort((left, right) => left.createdAt - right.createdAt)
}

/**
 * Register one aux child under its parent.
 * @param parentSessionId - parent session id.
 * @param child - child record.
 */
export function addAuxChild(parentSessionId: string, child: AuxChildRecord): void {
  const registry = readRegistry()
  const existing = registry.byParent[parentSessionId] ?? []
  if (existing.some(entry => entry.childId === child.childId)) return
  writeRegistry({
    byParent: {
      ...registry.byParent,
      [parentSessionId]: [...existing, child],
    },
  })
}

/**
 * Remove one aux child from its parent's registry entry.
 * @param parentSessionId - parent session id.
 * @param childId - child session id.
 */
export function removeAuxChild(parentSessionId: string, childId: string): void {
  const registry = readRegistry()
  const existing = registry.byParent[parentSessionId]
  if (existing === undefined) return
  const next = existing.filter(entry => entry.childId !== childId)
  const byParent = { ...registry.byParent }
  if (next.length === 0) delete byParent[parentSessionId]
  else byParent[parentSessionId] = next
  writeRegistry({ byParent })
}

/**
 * Find the parent that owns one aux child (reverse lookup).
 * @param childId - child session id.
 * @returns the owning parent session id, or `undefined` when not registered.
 */
export function ownerOfChild(childId: string): string | undefined {
  const byParent = readRegistry().byParent
  for (const parent of Object.keys(byParent)) {
    const entries = byParent[parent]
    if (entries !== undefined && entries.some(entry => entry.childId === childId)) return parent
  }
  return undefined
}

/**
 * Drop registry entries whose session no longer exists in the live catalog.
 * @param parentSessionId - parent session id.
 * @param liveIds - currently known session ids (from `sessions.list`).
 * @returns the pruned, still-live children, oldest first.
 */
export function pruneAuxChildren(parentSessionId: string, liveIds: ReadonlySet<string>): AuxChildRecord[] {
  const live = auxChildrenOf(parentSessionId).filter(entry => liveIds.has(entry.childId))
  const dead = auxChildrenOf(parentSessionId).filter(entry => !liveIds.has(entry.childId))
  for (const entry of dead) removeAuxChild(parentSessionId, entry.childId)
  return live
}

/**
 * Smallest unused aux ordinal for one parent: 1 first, then 2, 3…
 * Archiving frees the number for reuse.
 * @param parentSessionId - parent session id.
 * @returns the next ordinal.
 */
export function nextAuxOrdinal(parentSessionId: string): number {
  const used = new Set(auxChildrenOf(parentSessionId).map(entry => entry.label))
  let ordinal = 1
  while (used.has(`辅助对话 ${ordinal}`)) ordinal += 1
  return ordinal
}
