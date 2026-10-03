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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes'
import type { SessionListState, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ConversationViewsProps, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createElement, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { normalizeConfig, type ChatAssistantConfig } from '../config.ts'
import { addAuxChild, auxChildrenOf, nextAuxOrdinal, ownerOfChild, pruneAuxChildren, removeAuxChild } from './registry.ts'
import { en, NS, zh, type ChatAssistantKey } from './locales.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Retention owned by this plugin's aux-chat sidebar tab. */
    auxChat: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'chat-assistant': ChatAssistantKey
  }
  interface ResourceProtocolMap {
    /** One forked auxiliary session hosted by this plugin's sidebar tab. */
    auxchat: AuxChatResource
  }
  interface SlotMap {
    'chat-assistant.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chat-assistant-client'

/** Browser services this face consumes. */
export const inject = [
  'commandUi', 'conversation', 'locale', 'resources', 'sessions',
  'sidebarRight', 'sidebarRightTabs', 'slots',
  'remote', 'remote.session', 'remote.workspace',
]

/** Resource-address prefix of this plugin's aux-chat tab. */
const AUX_CHAT_ADDRESS = 'dsh-resource://auxchat/session/'

/** Stable registry entry id of this plugin's sidebar tab type (also the pane-tab dispatch key). */
const AUX_CHAT_TAB_ID = 'dsh-chat-assistant/auxchat'

/** Upper bound for one selection forwarded into the auxiliary chat. */
const SELECTION_MAX_CHARS = 4000

/** ZCode-style quote limits: at most 8 selections, 16000 chars in total. */
const QUOTE_MAX_COUNT = 8
const QUOTE_MAX_TOTAL_CHARS = 16000

/** How long to wait for the auxiliary composer to mount before giving up on a draft write. */
const COMPOSER_WAIT_MS = 6000

/**
 * Boundary-constraint file auto-attached to every FRESH auxiliary chat (the
 * user's design: the rules ride a visible, deletable attachment — removing
 * the chip unbinds the constraints). English rules for the model (ZCode
 * styles its boundary the same way for instruction reliability); the Chinese
 * note explains the removal gesture to the user.
 */
const AUX_CONSTRAINT_MARKDOWN = [
  '# 辅助对话边界约束',
  '',
  '> 本文件由辅助对话自动附带。删除这个附件，即解除以下全部约束。',
  '',
  'You are in a side conversation forked from a parent task.',
  '- The inherited conversation history is provided for REFERENCE ONLY.',
  '- Do not continue the parent task\'s work automatically; answer only the new questions asked in this side conversation.',
  '- Modify the workspace only when the user explicitly asks you to in this side conversation.',
  '- Whenever you do modify files, leave a clear record of what was changed (e.g., a commit with a descriptive message, or a short change summary in the reply), so the parent task can trace side-conversation changes.',
].join('\n')

/** Value retained by one live aux-chat resource occurrence. */
interface AuxChatResource {
  readonly childId: SessionId
  readonly reference: SessionReference
}

/** Build this plugin's resource address for one aux child. */
function auxChatAddress(childId: SessionId): string {
  return `${AUX_CHAT_ADDRESS}${encodeURIComponent(childId)}`
}

/** Parse one aux-chat resource address back into the child id. */
function parseAuxChatAddress(value: string): SessionId | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch (_invalidUrl) {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'auxchat') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  const childSegment = parts[1]
  if (parts.length !== 2 || parts[0] !== 'session' || childSegment === undefined) return undefined
  try {
    return decodeURIComponent(childSegment) as SessionId
  } catch (_invalidEncoding) {
    return undefined
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** Live notice count so quick successive notices stack instead of overlapping. */
let activeNotices = 0

/**
 * Show one transient on-screen notice (top center, auto-dismisses). Used for
 * failures that would otherwise only land in the logger.
 */
function showNotice(text: string): void {
  const notice = document.createElement('div')
  notice.textContent = text
  const style = notice.style
  style.position = 'fixed'
  style.top = `${14 + activeNotices * 46}px`
  activeNotices += 1
  style.left = '50%'
  style.transform = 'translateX(-50%)'
  style.zIndex = '2147483000'
  style.padding = '8px 14px'
  style.border = '1px solid rgba(255, 255, 255, 0.16)'
  style.borderRadius = '8px'
  style.background = '#2f3037'
  style.color = '#f2f3f5'
  style.font = 'inherit'
  style.fontSize = '13px'
  style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.35)'
  document.body.appendChild(notice)
  window.setTimeout(() => {
    notice.remove()
    activeNotices = Math.max(0, activeNotices - 1)
  }, 3000)
}

/** Fixed Chat selection used by the embedded Conversation occurrence. */
function FixedChatConversationView(props: ConversationViewsProps): ReactNode {
  return createElement('div', null, props.renderSlot('conversation.session', { view: 'chat' }))
}

/** Selector state shapes for the embedded conversation panel (structural). */
interface SessionLikeState {
  readonly blank?: boolean
  readonly awaitingFirstTurn?: boolean
  readonly running?: boolean
  readonly promptAttempted?: boolean
  readonly openState?: string
}
interface ConversationLikeState {
  readonly activeTargets: ReadonlySet<string>
}

/** Props supplied to the child-Session Conversation host. */
export type AuxConversationPanelProps = PropsRuntime<'chat-assistant.conversation'> & PropsRenderFactories

/** Render the shared Conversation content for one explicitly provided fork session. */
function AuxConversationPanel({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot,
}: AuxConversationPanelProps): ReactNode {
  const session = useSession((value: SessionLikeState) => value)
  const conversation = useConversation((value: ConversationLikeState) => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions((state: SessionListState) => state.byId[sessionId as string as SessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedChatConversationView },
  })
}

/** Framework props of the aux-chat pane-tab body (injected tab face + renderSlot). */
type AuxChatTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'chat-assistant.conversation'>
  & {
    readonly useResource: (address: string) => { readonly value?: AuxChatResource }
    readonly SessionProvider: (props: { session: SessionReference, children: ReactNode }) => ReactNode
  }

/** Toolbar binding for the in-aux tab toolbar (written by `apply`). */
interface AuxToolbarBinding {
  attachConstraint(childId: SessionId): void
  deleteThis(childId: SessionId): void
  createNew(childId: SessionId): void
}

let auxToolbarBinding: AuxToolbarBinding | undefined

/** Dropdown row shared with the header menu styling. */
function toolbarMenuItem(text: string, onClick: () => void): ReactNode {
  return createElement('button', {
    type: 'button',
    style: MENU_ITEM_STYLE,
    onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => { event.currentTarget.style.background = 'rgba(255,255,255,0.08)' },
    onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => { event.currentTarget.style.background = 'transparent' },
    onClick,
  }, text)
}

/**
 * In-aux tab toolbar: the aux view renders NO conversation header (the
 * platform content factory is body-only), so the docked tab carries its own
 * controls — the three operations that make sense from inside the chat.
 */
function AuxTabToolbar({ childId }: { childId: SessionId }): ReactNode {
  const binding = auxToolbarBinding
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent): void => {
      if (wrapRef.current !== null && event.target instanceof Node && wrapRef.current.contains(event.target)) return
      setOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onOutside, true)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('mousedown', onOutside, true)
      document.removeEventListener('keydown', onEscape, true)
    }
  }, [open])
  const menuStyle: Record<string, string> = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: '0',
    zIndex: '2147483000',
    minWidth: '180px',
    overflowY: 'auto',
    padding: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    background: '#2f3037',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    color: '#f2f3f5',
    font: 'inherit',
    borderRadius: '10px',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)',
  }
  return createElement('div', {
    ref: wrapRef,
    style: { position: 'absolute', top: '8px', right: '12px', zIndex: 30 },
  },
    createElement('button', {
      type: 'button',
      title: '辅助对话操作',
      onClick: () => { setOpen(value => !value) },
      style: {
        border: '1px solid rgba(255, 255, 255, 0.16)',
        background: 'rgba(47, 48, 55, 0.85)',
        color: 'rgba(230, 231, 234, 0.9)',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '1',
        cursor: 'pointer',
        borderRadius: '8px',
        padding: '4px 9px',
      },
    }, '⋯'),
    open
      ? createElement('div', { style: menuStyle },
          toolbarMenuItem('附加约束文件', () => { setOpen(false); binding?.attachConstraint(childId) }),
          toolbarMenuItem('删除本对话', () => { setOpen(false); binding?.deleteThis(childId) }),
          toolbarMenuItem('另开一个', () => { setOpen(false); binding?.createNew(childId) }),
        )
      : null,
  )
}

/**
 * Aux-chat tab body: retain the addressed fork session through the resource
 * provider and render the shared conversation below the SessionProvider. A
 * visible loading placeholder covers the not-yet-yielded window so a stuck
 * resource is distinguishable from a silent blank.
 */
function AuxChatTabBody({ useResource, useTabInfo, SessionProvider, renderSlot }: AuxChatTabBodyProps): ReactNode {
  const info = useTabInfo()
  const tab = info.tab
  const resource = useResource(tab.contentId)
  if (resource.value === undefined) {
    return createElement('div', {
      'data-aux-chat': true,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'rgba(200, 200, 205, 0.55)',
        fontSize: '13px',
      },
    }, '辅助对话内容加载中…')
  }
  const conversation = renderSlot('chat-assistant.conversation', {}) as ReactNode
  // The `conversation.content` factory yields ONLY the conversation body — a
  // `flex: 1; min-height: 0` item that expects a bounded flex-column parent
  // (the main panel wraps it in one; the `.root` box is not part of the
  // factory output). A block wrapper lets the body grow to content height:
  // the transcript never overflows (no scrollbar) and the absolutely-docked
  // composer ends up below the clip. Be the flex column the body expects.
  return createElement('div', {
    'data-aux-chat': true,
    style: {
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      height: '100%',
      minHeight: '0',
      overflow: 'hidden',
    },
  },
    createElement(AuxTabToolbar, { childId: resource.value.childId }),
    createElement(SessionProvider, { session: resource.value.reference, children: conversation }),
  )
}

/**
 * Install the selection chip: a small fixed-position two-button bar shown
 * next to non-collapsed text selections — 「打开辅助对话」quotes into the
 * CURRENT aux conversation's draft, 「新开辅助对话」forks a fresh one with
 * the quote. Selections inside the auxiliary chat itself, form fields, and
 * editors are ignored. Returns the disposer.
 * @param t - locale translator for the chip labels.
 * @param send - called with (text, mode) for the picked button.
 * @returns effect disposer removing the chip and its listeners.
 */
function installSelectionChip(
  t: TranslateNS<typeof NS>,
  send: (text: string, mode: 'latest' | 'new') => void,
): () => void {
  const chip = document.createElement('div')
  chip.dataset.chatAssistantChip = ''
  // Neutral dark surface readable on both themes; theme-token styling can
  // replace this once the plugin ships its own stylesheet pipeline.
  const chipStyle = chip.style
  chipStyle.position = 'fixed'
  chipStyle.display = 'none'
  chipStyle.zIndex = '2147483000'
  chipStyle.padding = '4px'
  chipStyle.border = '1px solid rgba(255, 255, 255, 0.16)'
  chipStyle.borderRadius = '8px'
  chipStyle.background = '#2f3037'
  chipStyle.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.35)'

  const buttons = [
    { key: 'latest' as const, text: t('chip.open') },
    { key: 'new' as const, text: t('chip.new') },
  ].map(({ key, text }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = text
    button.style.position = 'static'
    button.style.zIndex = 'auto'
    button.style.padding = '5px 10px'
    button.style.border = 'none'
    button.style.borderRadius = '6px'
    button.style.background = 'transparent'
    button.style.color = '#f2f3f5'
    button.style.font = 'inherit'
    button.style.fontSize = '13px'
    button.style.lineHeight = '1.4'
    button.style.cursor = 'pointer'
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,0.12)' })
    button.addEventListener('mouseleave', () => { button.style.background = 'transparent' })
    chip.appendChild(button)
    return { button, key }
  })

  const hide = (): void => { chipStyle.display = 'none' }

  const update = (): void => {
    const selection = document.getSelection()
    const text = selection?.toString() ?? ''
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || text.trim().length === 0) {
      return hide()
    }
    const anchor = selection.anchorNode
    const element = anchor === null
      ? undefined
      : anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement ?? undefined
    if (element === undefined) return hide()
    if (element.closest('[data-aux-chat], [data-sidebar-chat], [data-chat-assistant-chip], input, textarea, [contenteditable="true"]') !== null) {
      return hide()
    }
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return hide()
    chipStyle.display = 'flex'
    chipStyle.gap = '4px'
    const chipRect = chip.getBoundingClientRect()
    const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - chipRect.width - 8))
    const below = rect.bottom + 6
    const top = below + chipRect.height > window.innerHeight - 8
      ? Math.max(8, rect.top - chipRect.height - 6)
      : below
    chipStyle.left = `${left}px`
    chipStyle.top = `${top}px`
  }

  // preventDefault on mousedown keeps the selection alive between mouseup and
  // click, so the click handlers can still read it.
  chip.addEventListener('mousedown', (event) => { event.preventDefault() })
  for (const { button, key } of buttons) {
    button.addEventListener('click', () => {
      const text = document.getSelection()?.toString().trim() ?? ''
      hide()
      if (text !== '') send(text, key)
    })
  }

  const onUpdate = (): void => { window.setTimeout(update, 0) }
  const onKeyboardSelection = (event: KeyboardEvent): void => {
    if (event.shiftKey || (event.key === 'a' && (event.ctrlKey || event.metaKey))) onUpdate()
  }
  document.addEventListener('mouseup', onUpdate, true)
  document.addEventListener('keyup', onKeyboardSelection, true)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  document.body.appendChild(chip)

  return () => {
    document.removeEventListener('mouseup', onUpdate, true)
    document.removeEventListener('keyup', onKeyboardSelection, true)
    window.removeEventListener('scroll', hide, true)
    window.removeEventListener('resize', hide)
    chip.remove()
  }
}

/**
 * Apply-time binding for the header controls. The header-actions slot's
 * registration schema is `{ id, order, label }` — it declares no inject face —
 * so the callbacks and model loader ride this module binding, written by
 * `apply` (the client plugin applies once per page).
 */
interface HeaderControlsBinding {
  /** Open (or create) the latest aux chat of the addressed parent. */
  openLatest(parentSessionId: SessionId): void
  /** Fork an ADDITIONAL aux conversation, optionally presetting a model. */
  createNew(parentSessionId: SessionId, model: { provider: string, model: string } | undefined): void
  /** Archive the latest aux conversation of the addressed parent. */
  closeLatest(parentSessionId: SessionId): void
  /** (Re-)attach the boundary-constraint file to the addressed family's aux chat. */
  attachConstraint(parentSessionId: SessionId): void
  /** Host-generation model catalog for the "open with model" items. */
  loadModels(): Promise<ModelCatalog>
}

let headerControlsBinding: HeaderControlsBinding | undefined

/** Framework shares + the `t` seat of the header controls. */
interface AuxHeaderControlsProps extends PropsRuntime<'conversation.session.header.actions'> {
  readonly t: TranslateNS<typeof NS>
}

type MenuModels = ModelCatalog | 'loading' | 'error' | undefined

const MENU_ITEM_STYLE: Record<string, string> = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: '#e8e9eb',
  font: 'inherit',
  fontSize: '13px',
  cursor: 'pointer',
  padding: '6px 10px',
  borderRadius: '6px',
  whiteSpace: 'nowrap',
}

/**
 * Header controls: one 「辅助对话 ▾」button with a dropdown aggregating every
 * capability — open/focus, open additional (default model or a picked one
 * from the Host catalog), and delete — so no flag syntax is required.
 */
function AuxHeaderControls(props: AuxHeaderControlsProps): ReactNode {
  const binding = headerControlsBinding
  const [menuOpen, setMenuOpen] = useState(false)
  const [models, setModels] = useState<MenuModels>(undefined)
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const [hasAux, setHasAux] = useState(false)
  useEffect(() => {
    // Inside an aux conversation the controls act on its family: look through
    // the child to the parent that owns it.
    const family = (ownerOfChild(props.sessionId) ?? props.sessionId) as SessionId
    const refresh = (): void => {
      const ids = new Set(Object.keys(props.useSessions.getSnapshot().byId))
      setHasAux(pruneAuxChildren(family, ids).length > 0)
    }
    const unsubscribe = props.useSessions.subscribe(refresh)
    refresh()
    return unsubscribe
  }, [props.sessionId, props.useSessions])

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (event: MouseEvent): void => {
      if (wrapperRef.current !== null && event.target instanceof Node && wrapperRef.current.contains(event.target)) return
      setMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onOutside, true)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('mousedown', onOutside, true)
      document.removeEventListener('keydown', onEscape, true)
    }
  }, [menuOpen])

  const openMenu = (): void => {
    setMenuOpen(true)
    // Retry on every open while no catalog loaded: a previous failure should
    // not poison the menu for the rest of the page lifetime.
    if ((models === undefined || models === 'error') && binding !== undefined) {
      setModels('loading')
      binding.loadModels().then(
        (catalog) => { setModels(catalog) },
        () => { setModels('error') },
      )
    }
  }

  const menuItem = toolbarMenuItem

  const groupCaptionStyle: Record<string, string> = {
    padding: '6px 10px 2px',
    fontSize: '11px',
    color: 'rgba(220, 221, 224, 0.55)',
    whiteSpace: 'nowrap',
  }

  const menuChildren: ReactNode[] = []
  menuChildren.push(menuItem(props.t('menu.open'), () => { setMenuOpen(false); binding?.openLatest(props.sessionId as SessionId) }))
  menuChildren.push(menuItem(props.t('menu.newDefault'), () => { setMenuOpen(false); binding?.createNew(props.sessionId as SessionId, undefined) }))
  menuChildren.push(createElement('div', {
    key: 'models-caption',
    style: { ...groupCaptionStyle, marginTop: '4px' },
  }, props.t('menu.newByModel')))
  if (models === 'loading' || models === undefined) {
    menuChildren.push(createElement('div', { key: 'models-loading', style: groupCaptionStyle }, props.t('menu.loading')))
  } else if (models === 'error') {
    menuChildren.push(createElement('div', { key: 'models-error', style: groupCaptionStyle }, props.t('menu.loadFailed')))
  } else {
    for (const group of models.groups) {
      menuChildren.push(createElement('div', {
        key: `group:${group.id}`,
        style: groupCaptionStyle,
      }, group.name))
      for (const model of group.models) {
        menuChildren.push(menuItem(`另开：${model.name || model.id}`, () => {
          setMenuOpen(false)
          binding?.createNew(props.sessionId as SessionId, { provider: group.id, model: model.id })
        }))
      }
    }
  }
  if (hasAux) {
    menuChildren.push(createElement('div', { key: 'delete-sep', style: { borderTop: '1px solid rgba(255,255,255,0.12)', margin: '4px 0' } }))
    menuChildren.push(menuItem(props.t('menu.constraint'), () => { setMenuOpen(false); binding?.attachConstraint(props.sessionId as SessionId) }))
    menuChildren.push(menuItem(props.t('aux.delete'), () => { setMenuOpen(false); binding?.closeLatest(props.sessionId as SessionId) }))
  }

  return createElement('span', { ref: wrapperRef, style: { position: 'relative', display: 'inline-flex' } },
    createElement('button', {
      type: 'button',
      title: props.t('menu.title'),
      style: {
        border: 'none',
        background: 'transparent',
        color: 'rgba(200, 200, 205, 0.7)',
        font: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
        padding: '2px 6px',
        borderRadius: '6px',
      },
      onClick: () => { menuOpen ? setMenuOpen(false) : openMenu() },
    }, `${props.t('menu.title')} ▾`),
    menuOpen
      ? createElement('div', {
          style: {
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: '0',
            zIndex: '2147483000',
            minWidth: '230px',
            maxHeight: '380px',
            overflowY: 'auto',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            background: '#2f3037',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            color: '#f2f3f5',
            font: 'inherit',
            borderRadius: '10px',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)',
          },
        }, menuChildren)
      : null)
}

/**
 * Browser plugin body (方案 B): register the tab surface, the header menu,
 * the selection chip, the `/side` contribution, and lifecycle cleanup.
 * @param ctx - browser root context carrying the injected services.
 * @param config - the composed row config.
 */
export function apply(ctx: Context, config: unknown): void {
  const settings = normalizeConfig(config)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-chat-assistant: locale dictionary')

  // ── registry-backed aux operations ────────────────────────────────────────

  /** Live aux children of one parent (registry ∩ live catalog), oldest first. */
  const liveAuxOf = (parent: SessionId) => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const ids = new Set(Object.keys(snapshot.byId))
    return pruneAuxChildren(parent, ids)
  }

  /**
   * The family parent of a session: itself, or — when the session is a
   * registered aux child (the user is INSIDE an aux conversation) — the parent
   * that owns it, so every entry point keeps working there.
   */
  const resolveTargetParent = (sessionId: SessionId): SessionId =>
    (ownerOfChild(sessionId) as SessionId | undefined) ?? sessionId

  /** Archive one aux child; forget the registry entry only when it succeeded. */
  const archiveAux = (owner: SessionId, childId: SessionId): Promise<boolean> =>
    ctx.remote.workspace.archiveSession({ sessionId: childId, stopActivity: true }).then(
      (result) => {
        if (!result.ok) {
          ctx.logger.warn(`dsh-chat-assistant: aux archive failed: ${result.error.code}: ${result.error.message}`)
          return false
        }
        removeAuxChild(owner, childId)
        // Drop any page-local state pointing at the now-archived session.
        pendingQuotes.delete(childId)
        constraintChips.delete(childId)
        constraintStaged.delete(childId)
        return true
      },
      (error: unknown) => {
        ctx.logger.warn('dsh-chat-assistant: aux archive threw', error)
        return false
      },
    )

  /**
   * Close every open aux tab of one child, on screen or not: the Tab domain's
   * `closeIn` reaches any adopted surface, and the same address can be open in
   * MORE than one surface (the parent's sidebar plus the child's own), so a
   * matching tab is closed in every candidate surface. The close handler
   * re-entry is safe — callers remove the registry entry first.
   */
  const closeAuxTabEverywhere = (childId: SessionId, ownerHint?: SessionId): void => {
    const closeInFace = ctx.sidebarRight as unknown as { closeIn(sessionId: SessionId, tabId: string): void }
    const surfaces = new Set<SessionId>()
    if (ownerHint !== undefined) surfaces.add(ownerHint)
    const owner = ownerOfChild(childId) as SessionId | undefined
    if (owner !== undefined) surfaces.add(owner)
    surfaces.add(childId)
    for (const surface of surfaces) {
      try {
        for (const tab of ctx.sidebarRight.tabsIn(surface)) {
          if (tab.kind === 'auxchat' && parseAuxChatAddress(tab.contentId) === childId) {
            closeInFace.closeIn(surface, tab.id)
          }
        }
      } catch (_surfaceUnavailable) {
        // Not adopted; try the next candidate surface.
      }
    }
  }

  /** Locate an already-open aux tab for one child session, if any. */
  const findAuxTab = (parent: SessionId, childId: SessionId) =>
    ctx.sidebarRight.tabsIn(parent).find(entry => entry.kind === 'auxchat' && parseAuxChatAddress(entry.contentId) === childId)

  /**
   * Open (reveal + dock) one aux child's tab in the on-screen parent's
   * sidebar. An existing tab is focused (and the column expanded) instead of
   * re-running the claim path. The tab stays docked in the column — the
   * platform expands the sidebar to show it (its own open contract) and
   * keeps the layout persisted per session.
   */
  const openTab = (parent: SessionId, childId: SessionId): void => {
    const mounted = ctx.sidebarRight.mounted.getSnapshot()
    if (mounted !== undefined && resolveTargetParent(mounted) !== parent) {
      // The sidebar-right public face only operates on the on-screen session;
      // surface the mismatch instead of failing silently. Staying INSIDE an aux
      // conversation is fine: its family parent is the intended target.
      showNotice('辅助对话入口与当前屏幕会话不一致，请刷新后重试')
      ctx.logger.warn(`dsh-chat-assistant: open skipped — mounted ${String(mounted)} ≠ family of ${String(parent)}`)
      return
    }
    const tabDomain = ctx.sidebarRight as unknown as {
      openResourceIn(sessionId: SessionId, address: string, options?: { kind?: string, preferNewPane?: boolean }): void
    }
    const attempt = (): void => {
      const existing = findAuxTab(parent, childId)
      if (existing !== undefined) {
        if (ctx.sidebarRight.mounted.getSnapshot() !== undefined && !ctx.sidebarRight.isExpanded()) {
          ctx.sidebarRight.toggleExpanded()
        }
        try {
          ctx.sidebarRight.focus(existing.id)
        } catch (_fullscreenFocus) {
          // Fullscreen presentation: the tab already IS the visible surface.
        }
        return
      }
      if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) {
        ctx.sidebarRight.openResource(auxChatAddress(childId), { kind: 'auxchat', preferNewPane: true })
        return
      }
      // Fullscreen presentation: the public face has no on-screen session, but
      // the sidebar surface the user is looking at can still host the tab via
      // the Tab domain path (works while focus sits inside that surface).
      const target = ctx.sidebarRight.commandTarget()
      if (target !== undefined) {
        tabDomain.openResourceIn(target.sessionId, auxChatAddress(childId), { kind: 'auxchat', preferNewPane: true })
        return
      }
      throw new Error('sidebarRight: no session surface is mounted')
    }
    try {
      attempt()
    } catch (first: unknown) {
      // Right after a refresh the persisted layout can come back before this
      // plugin's tab-type registration lands; one deferred retry covers the
      // race instead of teaching the user a phantom failure.
      ctx.logger.warn('dsh-chat-assistant: open failed once, retrying shortly', first)
      window.setTimeout(() => {
        try {
          attempt()
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn('dsh-chat-assistant: openResource threw', error)
          const friendly = /no session surface/i.test(message)
            ? '辅助对话已创建——全屏展示下无法打开新 tab，请退出全屏后在左侧列表查看'
            : message
          showNotice(`打开辅助对话失败：${friendly}`)
        }
      }, 350)
    }
  }

  /** One in-flight fork per parent: a double-invoked create gesture shares one creation. */
  const creatingByParent = new Map<SessionId, Promise<SessionId>>()

  /** Fork one new aux conversation under a parent and open it (single-flight per parent). */
  const createAux = (rawParent: SessionId, model: { provider: string, model: string } | undefined): Promise<SessionId> => {
    const parent = resolveTargetParent(rawParent)
    const inflight = creatingByParent.get(parent)
    if (inflight !== undefined) return inflight
    const flight = (async (): Promise<SessionId> => {
      const childId = await ctx.sessions.fork({ sessionId: parent, increaseTitle: false })
      const ordinal = nextAuxOrdinal(parent)
      const label = `辅助对话 ${ordinal}`
      // Register IMMEDIATELY after the fork resolves: a rejecting
      // rename/selectModel below must never orphan a real fork outside the
      // registry (the user would be told 创建失败 while a session landed).
      addAuxChild(parent, { childId: childId as string, label, createdAt: Date.now() })
      try {
        const rename = await ctx.remote.session.rename({ sessionId: childId, title: label })
        if (!rename.ok) {
          ctx.logger.warn(`dsh-chat-assistant: aux rename failed: ${rename.error.code}: ${rename.error.message}`)
        }
      } catch (error: unknown) {
        // Cosmetic failure only — the tab title falls back to the catalog title.
        ctx.logger.warn('dsh-chat-assistant: aux rename threw', error)
      }
      if (model !== undefined) {
        try {
          const selection = await ctx.remote.session.selectModel({
            sessionId: childId,
            provider: model.provider,
            model: model.model,
          })
          if (!selection.ok) {
            ctx.logger.warn(`dsh-chat-assistant: aux model preset failed: ${selection.error.code}: ${selection.error.message}`)
          }
        } catch (error: unknown) {
          // The chat still works on the inherited model.
          ctx.logger.warn('dsh-chat-assistant: aux model preset threw', error)
        }
      }
      stageConstraintWhenReady(childId)
      openTab(parent, childId)
      return childId
    })()
    creatingByParent.set(parent, flight)
    flight.then(
      () => { if (creatingByParent.get(parent) === flight) creatingByParent.delete(parent) },
      () => { if (creatingByParent.get(parent) === flight) creatingByParent.delete(parent) },
    )
    return flight
  }

  /** Open (or create) the latest aux conversation of the on-screen parent. */
  const openLatest = (rawParent: SessionId): void => {
    const parent = resolveTargetParent(rawParent)
    const latest = [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (latest !== undefined) {
      openTab(parent, latest.childId as SessionId)
      return
    }
    void createAux(parent, undefined).catch((error: unknown) => {
      ctx.logger.warn('dsh-chat-assistant: aux fork failed', error)
      showNotice(`辅助对话创建失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * Archive one aux conversation and close its tab. Inside an aux conversation
   * 删除 targets the conversation on screen; elsewhere it targets the family's
   * latest.
   */
  const closeLatest = (rawParent: SessionId): void => {
    const parent = resolveTargetParent(rawParent)
    const mounted = ctx.sidebarRight.mounted.getSnapshot()
    const onScreenEntry = mounted !== undefined && mounted !== parent
      ? auxChildrenOf(parent).find(entry => entry.childId === mounted)
      : undefined
    const target = onScreenEntry
      ?? [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (target === undefined) {
      showNotice('当前没有可删除的辅助对话')
      return
    }
    void archiveAux(parent, target.childId as SessionId).then((archived) => {
      if (!archived) {
        showNotice('辅助对话删除失败，请重试')
        return
      }
      closeAuxTabEverywhere(target.childId as SessionId, parent)
    })
  }

  /** Bridge to the concrete controller face: several attachment verbs ship off the public IConversation interface. */
  const conversationBridge = () => ctx.conversation as unknown as {
    createDrafts(sessionId: SessionId, files: readonly File[]): ReadonlyArray<{ readonly id: DraftAttachmentId }>
    releaseDraftAttachment(id: DraftAttachmentId): void
  }
  const createDraftFiles = (childId: SessionId, files: readonly File[]): ReadonlyArray<{ readonly id: DraftAttachmentId }> =>
    conversationBridge().createDrafts(childId, files)

  /** Per-aux pending merged quote: the staged attachment id and its collected texts. */
  const pendingQuotes = new Map<string, { readonly attachmentId: DraftAttachmentId, readonly items: readonly string[] }>()

  /**
   * Merge one selection into the pending quote attachment of an aux chat —
   * ZCode semantics: identical selections dedupe silently; count/total limits
   * refuse loudly; each staging replaces the previous file so the composer
   * always shows exactly ONE quote chip no matter how many passages were
   * collected. Returns 'staged' | 'duplicate' (terminal) or 'busy' (caller
   * should retry).
   */
  const stageQuote = (childId: SessionId, actx: Context, text: string): 'staged' | 'duplicate' | 'busy' => {
    const input = ctx.conversation.input.for(actx)
    let pending = pendingQuotes.get(childId)
    if (pending !== undefined && !input.state.getSnapshot().attachmentIds.includes(pending.attachmentId)) {
      // The staged quote already left the draft (message sent, chip deleted):
      // start a fresh collection instead of resurrecting sent passages into
      // new files and burning the count/total caps on stale items.
      pendingQuotes.delete(childId)
      pending = undefined
    }
    if (pending !== undefined && pending.items.includes(text)) return 'duplicate'
    if (pending !== undefined && pending.items.length >= QUOTE_MAX_COUNT) {
      showNotice(`对话引用最多 ${QUOTE_MAX_COUNT} 条，已达上限`)
      return 'duplicate'
    }
    const totalNow = (pending?.items ?? []).reduce((sum, item) => sum + item.length, 0)
    if (totalNow + text.length > QUOTE_MAX_TOTAL_CHARS) {
      showNotice(`对话引用总量超过 ${QUOTE_MAX_TOTAL_CHARS} 字上限`)
      return 'duplicate'
    }
    const items = [...(pending?.items ?? []), text]
    const now = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    const header = items.length === 1
      ? `# 对话引用\n\n> 划词自主会话 · ${stamp}\n\n`
      : `# 对话引用（${items.length} 条）\n\n> 划词自主会话 · ${stamp}\n\n`
    const body = items.length === 1
      ? items[0]
      : items.map((item, index) => `## 引用 ${index + 1}\n\n${item}`).join('\n\n')
    // No colon in the file name: uploads sanitize Windows-invalid characters.
    const name = items.length === 1
      ? `对话引用 ${pad(now.getHours())}${pad(now.getMinutes())}.md`
      : `对话引用 ${items.length}条 ${pad(now.getHours())}${pad(now.getMinutes())}.md`
    const file = new File([header + body], name, { type: 'text/markdown' })
    if (pending !== undefined && input.removeAttachment(pending.attachmentId)) {
      // The replaced draft's upload is never cited by anything anymore.
      conversationBridge().releaseDraftAttachment(pending.attachmentId)
    }
    const ids = createDraftFiles(childId, [file]).map(draft => draft.id)
    const quoteId = ids[0]
    if (quoteId === undefined) return 'busy'
    if (!input.addAttachments(ids)) {
      // A refused draft would leak its immediately-started background upload;
      // release it and let the caller retry cleanly.
      conversationBridge().releaseDraftAttachment(quoteId)
      return 'busy'
    }
    pendingQuotes.set(childId, { attachmentId: quoteId, items })
    input.focus()
    return 'staged'
  }

  /** Aux children with a known live constraint chip (replaced on manual re-attach to avoid duplicates). */
  const constraintChips = new Map<string, DraftAttachmentId>()

  /** Stage the boundary-constraint file; pure attachment, never touches the draft, no focus steal. */
  const stageConstraintFile = (childId: SessionId, actx: Context): DraftAttachmentId | undefined => {
    const file = new File([AUX_CONSTRAINT_MARKDOWN], '对话约束.md', { type: 'text/markdown' })
    const ids = createDraftFiles(childId, [file]).map(draft => draft.id)
    const attachmentId = ids[0]
    if (attachmentId === undefined) return undefined
    const input = ctx.conversation.input.for(actx)
    if (!input.addAttachments(ids)) {
      // A refused draft would leak its immediately-started background upload.
      conversationBridge().releaseDraftAttachment(attachmentId)
      return undefined
    }
    constraintChips.set(childId, attachmentId)
    return attachmentId
  }

  /** Aux children whose constraint file was already staged (or declined) this page lifetime. */
  const constraintStaged = new Set<string>()

  /**
   * Auto-attach the boundary-constraint file to a NEWLY-FORKED auxiliary chat
   * (the user's design: constraints ride a visible, deletable attachment chip;
   * deleting the chip unbinds them). Called from `createAux` only — a fork is
   * fresh by construction. Deliberately NOT called on open/focus of existing
   * aux chats: the session catalog marks a fork child as non-blank from birth
   * (it inherits history), so there is no reliable "user has not spoken yet"
   * signal for older chats, and a constraint arriving mid-conversation is
   * noise. Retries until the session scope materializes; give-up releases the
   * once-guard so a later fork can try again.
   */
  const stageConstraintWhenReady = (childId: SessionId): void => {
    if (constraintStaged.has(childId)) return
    constraintStaged.add(childId)
    const deadline = Date.now() + COMPOSER_WAIT_MS
    const attempt = (): void => {
      const actx = ctx.sessions.scope(childId)
      if (actx !== undefined) {
        try {
          if (stageConstraintFile(childId, actx) !== undefined) return
        } catch (error: unknown) {
          ctx.logger.warn('dsh-chat-assistant: constraint staging failed', error)
          return // adapter refused (locked admission etc.): do not fight the composer
        }
      }
      if (Date.now() < deadline) {
        window.setTimeout(attempt, 150)
        return
      }
      constraintStaged.delete(childId)
    }
    attempt()
  }

  /**
   * Manually (re-)attach the constraint file to one aux conversation: covers
   * chats born before the constraint feature and chips the user deleted and
   * changed their mind about. Replaces a still-present constraint chip so a
   * double invocation never stacks duplicates.
   */
  const attachConstraintManually = (childId: SessionId): void => {
    const deadline = Date.now() + COMPOSER_WAIT_MS
    const attempt = (): void => {
      const actx = ctx.sessions.scope(childId)
      if (actx !== undefined) {
        try {
          const input = ctx.conversation.input.for(actx)
          const previous = constraintChips.get(childId)
          if (previous !== undefined) {
            if (input.removeAttachment(previous)) {
              conversationBridge().releaseDraftAttachment(previous)
            }
            constraintChips.delete(childId)
          }
          if (stageConstraintFile(childId, actx) !== undefined) {
            showNotice('已附加约束文件（删除芯片即解除约束）')
            return
          }
        } catch (error: unknown) {
          ctx.logger.warn('dsh-chat-assistant: manual constraint staging failed', error)
        }
      }
      if (Date.now() < deadline) {
        window.setTimeout(attempt, 150)
        return
      }
      showNotice('约束文件附加失败，请重试')
    }
    attempt()
  }

  /** Legacy fallback: write the quote into the draft as plain text. */
  const draftQuoteFallback = (childId: SessionId, quote: string): void => {
    const actx = ctx.sessions.scope(childId)
    if (actx === undefined) {
      showNotice('辅助对话输入框未就绪，选段未能带入——请手动粘贴')
      return
    }
    try {
      const input = ctx.conversation.input.for(actx)
      input.setDraft(`「${quote}」\n`)
      input.focus()
    } catch (_composerGone) {
      showNotice('辅助对话输入框未就绪，选段未能带入——请手动粘贴')
    }
  }

  /**
   * Hand one selected passage to the auxiliary chat: open (or create) the aux
   * window, then stage the quote as a PACKAGED attachment — no message is
   * sent; the user completes and submits it themselves. Retries until the
   * session scope carries a resident input shell; a refusal or timeout falls
   * back to the legacy draft write.
   */
  const handOffSelection = (text: string, mode: 'latest' | 'new'): void => {
    const mounted = ctx.sidebarRight.mounted.getSnapshot()
    if (mounted === undefined) {
      // Fullscreen presentation / global panel: no family can be resolved.
      showNotice('当前无法确定主会话（全屏展示下请先退出全屏），选段未能带入')
      return
    }
    const parent = resolveTargetParent(mounted)
    const truncated = text.length > SELECTION_MAX_CHARS
    const quote = truncated
      ? `${text.slice(0, SELECTION_MAX_CHARS)}\n\n（引用超过 ${SELECTION_MAX_CHARS} 字，已截断）`
      : text
    const stage = (childId: SessionId): void => {
      const deadline = Date.now() + COMPOSER_WAIT_MS
      const attempt = (): void => {
        const actx = ctx.sessions.scope(childId)
        if (actx !== undefined) {
          try {
            // 'staged' and 'duplicate' are terminal (the latter includes loud
            // limit refusals); only 'busy' (composer locked) is worth retrying.
            if (stageQuote(childId, actx, quote) !== 'busy') return
          } catch (error: unknown) {
            ctx.logger.warn('dsh-chat-assistant: quote staging failed', error)
          }
        }
        if (Date.now() < deadline) window.setTimeout(attempt, 150)
        else draftQuoteFallback(childId, quote)
      }
      attempt()
    }
    const latest = [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (mode === 'latest' && latest !== undefined) {
      openTab(parent, latest.childId as SessionId)
      stage(latest.childId as SessionId)
      return
    }
    void createAux(parent, undefined).then(
      stage,
      (error: unknown) => {
        ctx.logger.warn('dsh-chat-assistant: aux fork for selection failed', error)
        showNotice('辅助对话创建失败，选段未能带入')
      },
    )
  }

  // ── surfaces ──────────────────────────────────────────────────────────────

  // A) Own resource protocol + tab kind + pane body: the forked session
  //    renders through the shared conversation composition.
  const resourceProvider: ResourceProvider<'auxchat'> = {
    protocol: 'auxchat',
    async *open(resourceAddress, { signal }) {
      const childId: SessionId | undefined = parseAuxChatAddress(resourceAddress)
      if (childId === undefined) {
        showNotice(`辅助对话资源地址无效：${resourceAddress}`)
        throw new Error(`dsh-chat-assistant: invalid aux resource address "${resourceAddress}"`)
      }
      if (signal.aborted) return
      let reference: SessionReference
      try {
        reference = ctx.sessions.retain(childId, { source: 'auxChat', signal })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        showNotice(`辅助对话会话保留失败：${message}`)
        throw error
      }
      try {
        yield { ok: true, value: { childId, reference } }
        await waitForAbort(signal)
      } finally {
        reference.release()
      }
    },
  }
  ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
    scope.effect(() => scope.resources.register(resourceProvider), 'dsh-chat-assistant: aux resources')
    scope.effect(() => scope.sidebarRightTabs.register({
      id: AUX_CHAT_TAB_ID,
      kind: 'auxchat',
      patterns: [`${AUX_CHAT_ADDRESS}**`],
      priority: 'extension',
      keepMounted: true,
      canOpen: address => parseAuxChatAddress(address) !== undefined,
      title: (address) => {
        const child = parseAuxChatAddress(address)
        const summary = child === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[child]
        return summary?.displayTitle ?? summary?.projectionValues?.title ?? '辅助对话'
      },
    } satisfies SidebarRightTabDefinition), 'dsh-chat-assistant: aux tab type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab',
      key: AUX_CHAT_TAB_ID,
      children: { 'chat-assistant.conversation': { kind: 'single', scope: 'session' } },
      inject: () => ({}),
    }, AuxChatTabBody)), 'dsh-chat-assistant: aux tab body')
    scope.effect(() => scope.slots.inject('chat-assistant.conversation', () => scope.slots.register({
      name: 'chat-assistant.conversation',
    }, AuxConversationPanel)), 'dsh-chat-assistant: aux conversation')
  })

  // B) Header controls: open/focus, open additional, open-with-model, delete.
  ctx.effect(() => {
    headerControlsBinding = {
      openLatest: (parentSessionId) => { openLatest(parentSessionId) },
      createNew: (parentSessionId, model) => {
        void createAux(parentSessionId, model).catch((error: unknown) => {
          ctx.logger.warn('dsh-chat-assistant: aux fork failed', error)
          showNotice('辅助对话创建失败，请重试')
        })
      },
      closeLatest: (parentSessionId) => { closeLatest(parentSessionId) },
      attachConstraint: (parentSessionId) => {
        const parent = resolveTargetParent(parentSessionId)
        const mounted = ctx.sidebarRight.mounted.getSnapshot()
        // Inside an aux conversation, the constraint belongs to THAT chat;
        // elsewhere it goes to the family's latest.
        const onScreenChild = mounted !== undefined && mounted !== parent && ownerOfChild(mounted) === parent
          ? mounted
          : undefined
        const target = onScreenChild
          ?? [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0]?.childId as SessionId | undefined
        if (target === undefined) {
          showNotice('没有可附加约束的辅助对话')
          return
        }
        attachConstraintManually(target)
      },
      loadModels: async () => {
        const result = await ctx.remote.session.modelCatalog()
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        return result.value
      },
    }
    return () => { headerControlsBinding = undefined }
  }, 'dsh-chat-assistant: header controls binding')

  // B2) In-aux toolbar binding: the aux tab body renders no conversation
  // header, so it carries its own controls for the three in-place operations.
  ctx.effect(() => {
    auxToolbarBinding = {
      attachConstraint: (childId) => { attachConstraintManually(childId) },
      deleteThis: (childId) => {
        const owner = ownerOfChild(childId) as SessionId | undefined
        if (owner === undefined) {
          showNotice('该对话不在登记表中，无法在此删除')
          return
        }
        void archiveAux(owner, childId).then((archived) => {
          if (!archived) {
            showNotice('辅助对话删除失败，请重试')
            return
          }
          closeAuxTabEverywhere(childId, owner)
        })
      },
      createNew: (childId) => {
        void createAux(resolveTargetParent(childId), undefined).catch((error: unknown) => {
          ctx.logger.warn('dsh-chat-assistant: aux fork failed', error)
          showNotice('辅助对话创建失败，请重试')
        })
      },
    }
    return () => { auxToolbarBinding = undefined }
  }, 'dsh-chat-assistant: aux toolbar binding')
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'chat-assistant-controls',
    order: 10,
    locale: NS,
    label: () => t('menu.title'),
  }, AuxHeaderControls)), 'dsh-chat-assistant: header controls')

  // C) Selection chip: select text anywhere in the conversation, click the
  //    chip, and the passage lands in the auxiliary composer as a DRAFT.
  if (settings.selectionChip) {
    ctx.effect(() => installSelectionChip(t, handOffSelection), 'dsh-chat-assistant: selection chip')
  }

  // D) Bare slash commands as client-side contributions (no host command
  //    needed): open or focus the latest aux chat of the receiving session.
  //    Every configured name registers (defaults: /side and /btw synonym).
  for (const commandName of settings.commandNames) {
    ctx.effect(() => ctx.commandUi.register({
      name: commandName,
      label: () => t('menu.open'),
      description: () => '打开当前会话的辅助对话（停靠在右侧栏；关闭即归档）',
      available: (session: ClientSessionContext): boolean => true,
      ui: { kind: 'action', run: (session: ClientSessionContext): void => { openLatest(session.sessionId as SessionId) } },
    }), `dsh-chat-assistant: /${commandName} contribution`)
  }

  // E) Catalog reconcile — keep registry, catalog, and open tabs consistent.
  //    A child that left the catalog (archived anywhere, e.g. the left list) is
  //    forgotten and its stale tab closed, so an archived conversation can
  //    neither be reopened into a dead chat. A parent that left the catalog
  //    gets its aux children archived (no orphans). Runs once up front (which
  //    cleans persisted stale tabs after a restart), once deferred (covers
  //    surfaces adopted late), and on every catalog or on-screen change.
  ctx.effect(() => {
    const reconcile = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const liveIds = new Set(Object.keys(snapshot.byId))
      for (const [parentKey, children] of Object.entries(auxRegistrySnapshot())) {
        const parentLive = liveIds.has(parentKey)
        for (const child of children) {
          const childLive = liveIds.has(child.childId)
          if (childLive && parentLive) continue
          if (!childLive) {
            removeAuxChild(parentKey, child.childId)
            closeAuxTabEverywhere(child.childId as SessionId, parentKey as SessionId)
            continue
          }
          void ctx.remote.workspace.archiveSession({ sessionId: child.childId as SessionId, stopActivity: true }).then(
            (result) => {
              if (result.ok) {
                removeAuxChild(parentKey, child.childId)
                closeAuxTabEverywhere(child.childId as SessionId, parentKey as SessionId)
              } else {
                ctx.logger.warn(`dsh-chat-assistant: parent-cleanup archive failed: ${result.error.code}`)
              }
            },
            (error: unknown) => { ctx.logger.warn('dsh-chat-assistant: parent-cleanup archive threw', error) },
          )
        }
      }
    }
    reconcile()
    const deferred = window.setTimeout(reconcile, 3000)
    const unsubscribeList = ctx.sessions.list.subscribe(reconcile)
    const unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(reconcile)
    return () => {
      window.clearTimeout(deferred)
      unsubscribeList()
      unsubscribeMounted()
    }
  }, 'dsh-chat-assistant: catalog reconcile')

  // F) Close = archive: 用完关闭后即自动归档. Every explicit close of an aux
  //    tab (×, tab menu, close shortcut, tab replacement) archives the forked
  //    session in the background. Collapsing the column or switching sessions
  //    is NOT a close and archives nothing. The registry lookup doubles as the
  //    re-entry guard: the reconcile sweep removes the entry before closing a
  //    stale tab, so that path never double-archives.
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler('auxchat', (_surfaceSession, tab) => {
    const childId = parseAuxChatAddress(tab.contentId)
    if (childId === undefined) return
    const owner = ownerOfChild(childId) as SessionId | undefined
    if (owner === undefined) return
    void archiveAux(owner, childId)
  }), 'dsh-chat-assistant: close archives auxchat')
}

/** Read the raw registry (for the cleanup pass). */
function auxRegistrySnapshot(): Readonly<Record<string, readonly { childId: string, label: string, createdAt: number }[]>> {
  try {
    const raw = localStorage.getItem('dsh.chat-assistant.registry.v1')
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as { byParent?: Record<string, readonly { childId: string, label: string, createdAt: number }[]> }
    return parsed.byParent ?? {}
  } catch (_unreadable) {
    return {}
  }
}
