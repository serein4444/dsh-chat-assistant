import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Cordis plugin name used by loader diagnostics. */
declare const name = "dsh-chat-assistant";
/** Host services this face consumes (none). */
declare const inject: readonly string[];
/**
 * Host plugin body: no-op.
 * @param _ctx - host context (unused).
 */
declare function apply(_ctx: Context): void;
//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.d.ts.map