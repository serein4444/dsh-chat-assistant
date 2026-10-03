/**
 * dsh-chat-assistant host face (方案 B): intentionally empty.
 *
 * The fork-based auxiliary chat is entirely client-orchestrated —
 * `sessions.fork`, `session/rename`, `session/selectModel`, and
 * `workspace/archiveSession` are all client remotes, and the `/side` entry is
 * a client-side command contribution. The node half exists only because a
 * dual-face package needs a root entry for the Loader row.
 *
 * @module dsh-chat-assistant
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chat-assistant'

/** Host services this face consumes (none). */
export const inject: readonly string[] = []

/**
 * Host plugin body: no-op.
 * @param _ctx - host context (unused).
 */
export function apply(_ctx: Context): void {
  /* client-orchestrated; nothing to register host-side */
}
