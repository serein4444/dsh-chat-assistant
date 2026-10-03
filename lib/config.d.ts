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
    readonly commandNames: readonly string[];
    /** Show the selection chip ("打开辅助对话") when text is selected in the page. */
    readonly selectionChip: boolean;
}
/** Default command names: `/side` primary, `/btw` as the ZCode synonym. */
export declare const DEFAULT_COMMAND_NAMES: readonly string[];
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
export declare function normalizeConfig(raw: unknown): ChatAssistantConfig;
