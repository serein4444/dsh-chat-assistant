/**
 * dsh-chat-assistant browser face (方案 B — fork-based auxiliary chat).
 *
 * The auxiliary conversation is an ORDINARY session forked from the parent
 * (`sessions.fork` with the default completed-turn prefix — the same
 * inheritance semantics as the subagent design), NOT a continuable
 * subagent. That removes the settlement notices and the delegation return
 * path entirely, and makes the fork a first-class session: `/model` works
 * inside the window and "open with model" is a plain `selectModel` call
 * right after forking.
 *
 * Surfaces (all button-driven; command forms are optional conveniences):
 * - a right-Sidebar tab kind `auxchat` rendering the forked session through
 *   the shared conversation composition (own resource protocol and pane
 *   body, mirroring ui-subagent's public pattern);
 * - the Session-header 「辅助对话 ▾」menu: open/focus, open additional,
 *   open with a picked model (Host catalog), delete (archive);
 * - the selection chip quoting into the aux composer as a DRAFT;
 * - a bare client-side `/side` command contribution (open/focus);
 * - a localStorage registry tracking parent→forked-children (labels,
 *   ordinals) with parent-lifecycle cleanup.
 *
 * @module dsh-chat-assistant/client
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { type ChatAssistantKey } from './locales.ts';
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        /** Retention owned by this plugin's aux-chat sidebar tab. */
        auxChat: unknown;
    }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'chat-assistant': ChatAssistantKey;
    }
    interface ResourceProtocolMap {
        /** One forked auxiliary session hosted by this plugin's sidebar tab. */
        auxchat: AuxChatResource;
    }
    interface SlotMap {
        'chat-assistant.conversation': {
            kind: 'single';
            scope: 'session';
        };
    }
}
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "dsh-chat-assistant-client";
/** Browser services this face consumes. */
export declare const inject: string[];
/** Value retained by one live aux-chat resource occurrence. */
interface AuxChatResource {
    readonly childId: SessionId;
    readonly reference: SessionReference;
}
/** Props supplied to the child-Session Conversation host. */
export type AuxConversationPanelProps = PropsRuntime<'chat-assistant.conversation'> & PropsRenderFactories;
/**
 * Browser plugin body (方案 B): register the tab surface, the header menu,
 * the selection chip, the `/side` contribution, and lifecycle cleanup.
 * @param ctx - browser root context carrying the injected services.
 * @param config - the composed row config.
 */
export declare function apply(ctx: Context, config: unknown): void;
export {};
