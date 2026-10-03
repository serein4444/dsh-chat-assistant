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
    readonly childId: string;
    readonly label: string;
    readonly createdAt: number;
}
/** Persisted registry shape. */
export interface AuxRegistry {
    readonly byParent: Readonly<Record<string, readonly AuxChildRecord[]>>;
}
/**
 * List one parent's aux children, oldest first.
 * @param parentSessionId - parent session id.
 * @returns registered children (a defensive copy).
 */
export declare function auxChildrenOf(parentSessionId: string): AuxChildRecord[];
/**
 * Register one aux child under its parent.
 * @param parentSessionId - parent session id.
 * @param child - child record.
 */
export declare function addAuxChild(parentSessionId: string, child: AuxChildRecord): void;
/**
 * Remove one aux child from its parent's registry entry.
 * @param parentSessionId - parent session id.
 * @param childId - child session id.
 */
export declare function removeAuxChild(parentSessionId: string, childId: string): void;
/**
 * Find the parent that owns one aux child (reverse lookup).
 * @param childId - child session id.
 * @returns the owning parent session id, or `undefined` when not registered.
 */
export declare function ownerOfChild(childId: string): string | undefined;
/**
 * Drop registry entries whose session no longer exists in the live catalog.
 * @param parentSessionId - parent session id.
 * @param liveIds - currently known session ids (from `sessions.list`).
 * @returns the pruned, still-live children, oldest first.
 */
export declare function pruneAuxChildren(parentSessionId: string, liveIds: ReadonlySet<string>): AuxChildRecord[];
/**
 * Smallest unused aux ordinal for one parent: 1 first, then 2, 3…
 * Archiving frees the number for reuse.
 * @param parentSessionId - parent session id.
 * @returns the next ordinal.
 */
export declare function nextAuxOrdinal(parentSessionId: string): number;
