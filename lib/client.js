window.__ModuleLoader__.load({
	id: "dsh-chat-assistant",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/config.ts
		/** Default command names: `/side` primary, `/btw` as the ZCode synonym. */
		const DEFAULT_COMMAND_NAMES = ["side", "btw"];
		const KNOWN_KEYS = /* @__PURE__ */ new Set(["commandNames", "selectionChip"]);
		const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;
		function fail(key, problem) {
			throw new Error(`dsh-chat-assistant: config.${key} ${problem}`);
		}
		function requireObject(raw) {
			if (raw === void 0 || raw === null) return {};
			if (typeof raw !== "object" || Array.isArray(raw)) fail("", "must be an object when present");
			return raw;
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
		function normalizeConfig(raw) {
			const source = requireObject(raw);
			for (const key of Object.keys(source)) if (!KNOWN_KEYS.has(key)) fail(key, "is not a recognized configuration key");
			let commandNames = DEFAULT_COMMAND_NAMES;
			if (source.commandNames !== void 0) {
				if (!Array.isArray(source.commandNames) || source.commandNames.length === 0) fail("commandNames", "must be a non-empty string array when present");
				for (const name of source.commandNames) if (typeof name !== "string" || !COMMAND_NAME.test(name)) fail("commandNames", `entries must match ${COMMAND_NAME.source}, got ${JSON.stringify(name)}`);
				commandNames = [...source.commandNames];
			}
			if (source.selectionChip !== void 0 && typeof source.selectionChip !== "boolean") fail("selectionChip", "must be a boolean when present");
			return {
				commandNames,
				selectionChip: source.selectionChip ?? true
			};
		}
		//#endregion
		//#region src/client/registry.ts
		/** Storage key (versioned; bump on breaking shape changes). */
		const REGISTRY_KEY = "dsh.chat-assistant.registry.v1";
		function readRegistry() {
			try {
				const raw = localStorage.getItem(REGISTRY_KEY);
				if (raw === null) return { byParent: {} };
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || typeof parsed.byParent !== "object") return { byParent: {} };
				const byParent = {};
				for (const [parent, entries] of Object.entries(parsed.byParent)) {
					if (!Array.isArray(entries)) continue;
					const valid = entries.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.childId === "string" && typeof entry.label === "string" && typeof entry.createdAt === "number");
					if (valid.length > 0) byParent[parent] = valid;
				}
				return { byParent };
			} catch (_unreadable) {
				return { byParent: {} };
			}
		}
		function writeRegistry(registry) {
			try {
				localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
			} catch (_storageUnavailable) {}
		}
		/**
		* List one parent's aux children, oldest first.
		* @param parentSessionId - parent session id.
		* @returns registered children (a defensive copy).
		*/
		function auxChildrenOf(parentSessionId) {
			return [...readRegistry().byParent[parentSessionId] ?? []].sort((left, right) => left.createdAt - right.createdAt);
		}
		/**
		* Register one aux child under its parent.
		* @param parentSessionId - parent session id.
		* @param child - child record.
		*/
		function addAuxChild(parentSessionId, child) {
			const registry = readRegistry();
			const existing = registry.byParent[parentSessionId] ?? [];
			if (existing.some((entry) => entry.childId === child.childId)) return;
			writeRegistry({ byParent: {
				...registry.byParent,
				[parentSessionId]: [...existing, child]
			} });
		}
		/**
		* Remove one aux child from its parent's registry entry.
		* @param parentSessionId - parent session id.
		* @param childId - child session id.
		*/
		function removeAuxChild(parentSessionId, childId) {
			const registry = readRegistry();
			const existing = registry.byParent[parentSessionId];
			if (existing === void 0) return;
			const next = existing.filter((entry) => entry.childId !== childId);
			const byParent = { ...registry.byParent };
			if (next.length === 0) delete byParent[parentSessionId];
			else byParent[parentSessionId] = next;
			writeRegistry({ byParent });
		}
		/**
		* Find the parent that owns one aux child (reverse lookup).
		* @param childId - child session id.
		* @returns the owning parent session id, or `undefined` when not registered.
		*/
		function ownerOfChild(childId) {
			const byParent = readRegistry().byParent;
			for (const parent of Object.keys(byParent)) {
				const entries = byParent[parent];
				if (entries !== void 0 && entries.some((entry) => entry.childId === childId)) return parent;
			}
		}
		/**
		* Drop registry entries whose session no longer exists in the live catalog.
		* @param parentSessionId - parent session id.
		* @param liveIds - currently known session ids (from `sessions.list`).
		* @returns the pruned, still-live children, oldest first.
		*/
		function pruneAuxChildren(parentSessionId, liveIds) {
			const live = auxChildrenOf(parentSessionId).filter((entry) => liveIds.has(entry.childId));
			const dead = auxChildrenOf(parentSessionId).filter((entry) => !liveIds.has(entry.childId));
			for (const entry of dead) removeAuxChild(parentSessionId, entry.childId);
			return live;
		}
		/**
		* Smallest unused aux ordinal for one parent: 1 first, then 2, 3…
		* Archiving frees the number for reuse.
		* @param parentSessionId - parent session id.
		* @returns the next ordinal.
		*/
		function nextAuxOrdinal(parentSessionId) {
			const used = new Set(auxChildrenOf(parentSessionId).map((entry) => entry.label));
			let ordinal = 1;
			while (used.has(`辅助对话 ${ordinal}`)) ordinal += 1;
			return ordinal;
		}
		//#endregion
		//#region src/client/locales.ts
		/** `chat-assistant` namespace dictionaries (browser face copy). */
		/** Dictionary namespace owned by this plugin. */
		const NS = "chat-assistant";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"chip.open": "打开辅助对话",
			"chip.new": "新开辅助对话",
			"aux.delete": "删除辅助对话",
			"menu.title": "辅助对话",
			"menu.open": "打开 / 聚焦辅助对话",
			"menu.newDefault": "另开一个辅助对话",
			"menu.newByModel": "按模型另开",
			"menu.constraint": "附加约束文件",
			"menu.loading": "正在加载模型目录…",
			"menu.loadFailed": "模型目录加载失败"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"chip.open": "Open in auxiliary chat",
			"chip.new": "New auxiliary chat",
			"aux.delete": "Delete auxiliary chat",
			"menu.title": "Aux chat",
			"menu.open": "Open / focus auxiliary chat",
			"menu.newDefault": "New auxiliary chat",
			"menu.newByModel": "New with model",
			"menu.constraint": "Attach constraint file",
			"menu.loading": "Loading model catalog…",
			"menu.loadFailed": "Failed to load the model catalog"
		};
		//#endregion
		//#region src/client/index.ts
		/** Cordis plugin name used by loader diagnostics. */
		const name = "dsh-chat-assistant-client";
		/** Browser services this face consumes. */
		const inject = [
			"commandUi",
			"conversation",
			"locale",
			"resources",
			"sessions",
			"sidebarRight",
			"sidebarRightTabs",
			"slots",
			"remote",
			"remote.session",
			"remote.workspace"
		];
		/** Resource-address prefix of this plugin's aux-chat tab. */
		const AUX_CHAT_ADDRESS = "dsh-resource://auxchat/session/";
		/** Stable registry entry id of this plugin's sidebar tab type (also the pane-tab dispatch key). */
		const AUX_CHAT_TAB_ID = "dsh-chat-assistant/auxchat";
		/** Upper bound for one selection forwarded into the auxiliary chat. */
		const SELECTION_MAX_CHARS = 4e3;
		/** ZCode-style quote limits: at most 8 selections, 16000 chars in total. */
		const QUOTE_MAX_COUNT = 8;
		const QUOTE_MAX_TOTAL_CHARS = 16e3;
		/** How long to wait for the auxiliary composer to mount before giving up on a draft write. */
		const COMPOSER_WAIT_MS = 6e3;
		/**
		* Boundary-constraint file auto-attached to every FRESH auxiliary chat (the
		* user's design: the rules ride a visible, deletable attachment — removing
		* the chip unbinds the constraints). English rules for the model (ZCode
		* styles its boundary the same way for instruction reliability); the Chinese
		* note explains the removal gesture to the user.
		*/
		const AUX_CONSTRAINT_MARKDOWN = [
			"# 辅助对话边界约束",
			"",
			"> 本文件由辅助对话自动附带。删除这个附件，即解除以下全部约束。",
			"",
			"You are in a side conversation forked from a parent task.",
			"- The inherited conversation history is provided for REFERENCE ONLY.",
			"- Do not continue the parent task's work automatically; answer only the new questions asked in this side conversation.",
			"- Modify the workspace only when the user explicitly asks you to in this side conversation.",
			"- Whenever you do modify files, leave a clear record of what was changed (e.g., a commit with a descriptive message, or a short change summary in the reply), so the parent task can trace side-conversation changes."
		].join("\n");
		/** Build this plugin's resource address for one aux child. */
		function auxChatAddress(childId) {
			return `${AUX_CHAT_ADDRESS}${encodeURIComponent(childId)}`;
		}
		/** Parse one aux-chat resource address back into the child id. */
		function parseAuxChatAddress(value) {
			let url;
			try {
				url = new URL(value);
			} catch (_invalidUrl) {
				return;
			}
			if (url.protocol !== "dsh-resource:" || url.hostname.toLowerCase() !== "auxchat") return void 0;
			const parts = url.pathname.split("/").filter(Boolean);
			const childSegment = parts[1];
			if (parts.length !== 2 || parts[0] !== "session" || childSegment === void 0) return void 0;
			try {
				return decodeURIComponent(childSegment);
			} catch (_invalidEncoding) {
				return;
			}
		}
		function waitForAbort(signal) {
			if (signal.aborted) return Promise.resolve();
			return new Promise((resolve) => {
				signal.addEventListener("abort", () => {
					resolve();
				}, { once: true });
			});
		}
		/** Live notice count so quick successive notices stack instead of overlapping. */
		let activeNotices = 0;
		/**
		* Show one transient on-screen notice (top center, auto-dismisses). Used for
		* failures that would otherwise only land in the logger.
		*/
		function showNotice(text) {
			const notice = document.createElement("div");
			notice.textContent = text;
			const style = notice.style;
			style.position = "fixed";
			style.top = `${14 + activeNotices * 46}px`;
			activeNotices += 1;
			style.left = "50%";
			style.transform = "translateX(-50%)";
			style.zIndex = "2147483000";
			style.padding = "8px 14px";
			style.border = "1px solid rgba(255, 255, 255, 0.16)";
			style.borderRadius = "8px";
			style.background = "#2f3037";
			style.color = "#f2f3f5";
			style.font = "inherit";
			style.fontSize = "13px";
			style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.35)";
			document.body.appendChild(notice);
			window.setTimeout(() => {
				notice.remove();
				activeNotices = Math.max(0, activeNotices - 1);
			}, 3e3);
		}
		/** Fixed Chat selection used by the embedded Conversation occurrence. */
		function FixedChatConversationView(props) {
			return (0, react.createElement)("div", null, props.renderSlot("conversation.session", { view: "chat" }));
		}
		/** Render the shared Conversation content for one explicitly provided fork session. */
		function AuxConversationPanel({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
			const session = useSession((value) => value);
			const shellPhase = useConversation((value) => value).activeTargets.size > 0 || !session.blank && !session.awaitingFirstTurn || session.running ? "active" : session.promptAttempted ? "engaging" : "blank";
			const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
			const settling = shellPhase === "blank" && session.openState === "loading" && summaryBlank !== true;
			const hero = shellPhase === "blank" && (session.openState === "open" || summaryBlank === true);
			return renderFactorySlot("conversation.content", {
				variant: "embedded",
				phase: settling ? "settling" : hero ? "hero" : "active",
				hero
			}, { slots: { views: FixedChatConversationView } });
		}
		let auxToolbarBinding;
		/** Dropdown row shared with the header menu styling. */
		function toolbarMenuItem(text, onClick) {
			return (0, react.createElement)("button", {
				type: "button",
				style: MENU_ITEM_STYLE,
				onMouseEnter: (event) => {
					event.currentTarget.style.background = "rgba(255,255,255,0.08)";
				},
				onMouseLeave: (event) => {
					event.currentTarget.style.background = "transparent";
				},
				onClick
			}, text);
		}
		/**
		* In-aux tab toolbar: the aux view renders NO conversation header (the
		* platform content factory is body-only), so the docked tab carries its own
		* controls — the three operations that make sense from inside the chat.
		*/
		function AuxTabToolbar({ childId }) {
			const binding = auxToolbarBinding;
			const [open, setOpen] = (0, react.useState)(false);
			const wrapRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onOutside = (event) => {
					if (wrapRef.current !== null && event.target instanceof Node && wrapRef.current.contains(event.target)) return;
					setOpen(false);
				};
				const onEscape = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onOutside, true);
				document.addEventListener("keydown", onEscape, true);
				return () => {
					document.removeEventListener("mousedown", onOutside, true);
					document.removeEventListener("keydown", onEscape, true);
				};
			}, [open]);
			return (0, react.createElement)("div", {
				ref: wrapRef,
				style: {
					position: "absolute",
					top: "8px",
					right: "12px",
					zIndex: 30
				}
			}, (0, react.createElement)("button", {
				type: "button",
				title: "辅助对话操作",
				onClick: () => {
					setOpen((value) => !value);
				},
				style: {
					border: "1px solid rgba(255, 255, 255, 0.16)",
					background: "rgba(47, 48, 55, 0.85)",
					color: "rgba(230, 231, 234, 0.9)",
					font: "inherit",
					fontSize: "14px",
					lineHeight: "1",
					cursor: "pointer",
					borderRadius: "8px",
					padding: "4px 9px"
				}
			}, "⋯"), open ? (0, react.createElement)("div", { style: {
				position: "absolute",
				top: "calc(100% + 6px)",
				right: "0",
				zIndex: "2147483000",
				minWidth: "180px",
				overflowY: "auto",
				padding: "6px",
				display: "flex",
				flexDirection: "column",
				gap: "2px",
				background: "#2f3037",
				border: "1px solid rgba(255, 255, 255, 0.16)",
				color: "#f2f3f5",
				font: "inherit",
				borderRadius: "10px",
				boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)"
			} }, toolbarMenuItem("附加约束文件", () => {
				setOpen(false);
				binding?.attachConstraint(childId);
			}), toolbarMenuItem("删除本对话", () => {
				setOpen(false);
				binding?.deleteThis(childId);
			}), toolbarMenuItem("另开一个", () => {
				setOpen(false);
				binding?.createNew(childId);
			})) : null);
		}
		/**
		* Aux-chat tab body: retain the addressed fork session through the resource
		* provider and render the shared conversation below the SessionProvider. A
		* visible loading placeholder covers the not-yet-yielded window so a stuck
		* resource is distinguishable from a silent blank.
		*/
		function AuxChatTabBody({ useResource, useTabInfo, SessionProvider, renderSlot }) {
			const tab = useTabInfo().tab;
			const resource = useResource(tab.contentId);
			if (resource.value === void 0) return (0, react.createElement)("div", {
				"data-aux-chat": true,
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					height: "100%",
					color: "rgba(200, 200, 205, 0.55)",
					fontSize: "13px"
				}
			}, "辅助对话内容加载中…");
			const conversation = renderSlot("chat-assistant.conversation", {});
			return (0, react.createElement)("div", {
				"data-aux-chat": true,
				style: {
					display: "flex",
					flexDirection: "column",
					position: "relative",
					height: "100%",
					minHeight: "0",
					overflow: "hidden"
				}
			}, (0, react.createElement)(AuxTabToolbar, { childId: resource.value.childId }), (0, react.createElement)(SessionProvider, {
				session: resource.value.reference,
				children: conversation
			}));
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
		function installSelectionChip(t, send) {
			const chip = document.createElement("div");
			chip.dataset.chatAssistantChip = "";
			const chipStyle = chip.style;
			chipStyle.position = "fixed";
			chipStyle.display = "none";
			chipStyle.zIndex = "2147483000";
			chipStyle.padding = "4px";
			chipStyle.border = "1px solid rgba(255, 255, 255, 0.16)";
			chipStyle.borderRadius = "8px";
			chipStyle.background = "#2f3037";
			chipStyle.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.35)";
			const buttons = [{
				key: "latest",
				text: t("chip.open")
			}, {
				key: "new",
				text: t("chip.new")
			}].map(({ key, text }) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = text;
				button.style.position = "static";
				button.style.zIndex = "auto";
				button.style.padding = "5px 10px";
				button.style.border = "none";
				button.style.borderRadius = "6px";
				button.style.background = "transparent";
				button.style.color = "#f2f3f5";
				button.style.font = "inherit";
				button.style.fontSize = "13px";
				button.style.lineHeight = "1.4";
				button.style.cursor = "pointer";
				button.addEventListener("mouseenter", () => {
					button.style.background = "rgba(255,255,255,0.12)";
				});
				button.addEventListener("mouseleave", () => {
					button.style.background = "transparent";
				});
				chip.appendChild(button);
				return {
					button,
					key
				};
			});
			const hide = () => {
				chipStyle.display = "none";
			};
			const update = () => {
				const selection = document.getSelection();
				const text = selection?.toString() ?? "";
				if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || text.trim().length === 0) return hide();
				const anchor = selection.anchorNode;
				const element = anchor === null ? void 0 : anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement ?? void 0;
				if (element === void 0) return hide();
				if (element.closest("[data-aux-chat], [data-sidebar-chat], [data-chat-assistant-chip], input, textarea, [contenteditable=\"true\"]") !== null) return hide();
				const rect = selection.getRangeAt(0).getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) return hide();
				chipStyle.display = "flex";
				chipStyle.gap = "4px";
				const chipRect = chip.getBoundingClientRect();
				const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - chipRect.width - 8));
				const below = rect.bottom + 6;
				const top = below + chipRect.height > window.innerHeight - 8 ? Math.max(8, rect.top - chipRect.height - 6) : below;
				chipStyle.left = `${left}px`;
				chipStyle.top = `${top}px`;
			};
			chip.addEventListener("mousedown", (event) => {
				event.preventDefault();
			});
			for (const { button, key } of buttons) button.addEventListener("click", () => {
				const text = document.getSelection()?.toString().trim() ?? "";
				hide();
				if (text !== "") send(text, key);
			});
			const onUpdate = () => {
				window.setTimeout(update, 0);
			};
			const onKeyboardSelection = (event) => {
				if (event.shiftKey || event.key === "a" && (event.ctrlKey || event.metaKey)) onUpdate();
			};
			document.addEventListener("mouseup", onUpdate, true);
			document.addEventListener("keyup", onKeyboardSelection, true);
			window.addEventListener("scroll", hide, true);
			window.addEventListener("resize", hide);
			document.body.appendChild(chip);
			return () => {
				document.removeEventListener("mouseup", onUpdate, true);
				document.removeEventListener("keyup", onKeyboardSelection, true);
				window.removeEventListener("scroll", hide, true);
				window.removeEventListener("resize", hide);
				chip.remove();
			};
		}
		let headerControlsBinding;
		const MENU_ITEM_STYLE = {
			display: "block",
			width: "100%",
			textAlign: "left",
			border: "none",
			background: "transparent",
			color: "#e8e9eb",
			font: "inherit",
			fontSize: "13px",
			cursor: "pointer",
			padding: "6px 10px",
			borderRadius: "6px",
			whiteSpace: "nowrap"
		};
		/**
		* Header controls: one 「辅助对话 ▾」button with a dropdown aggregating every
		* capability — open/focus, open additional (default model or a picked one
		* from the Host catalog), and delete — so no flag syntax is required.
		*/
		function AuxHeaderControls(props) {
			const binding = headerControlsBinding;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [models, setModels] = (0, react.useState)(void 0);
			const wrapperRef = (0, react.useRef)(null);
			const [hasAux, setHasAux] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const family = ownerOfChild(props.sessionId) ?? props.sessionId;
				const refresh = () => {
					const ids = new Set(Object.keys(props.useSessions.getSnapshot().byId));
					setHasAux(pruneAuxChildren(family, ids).length > 0);
				};
				const unsubscribe = props.useSessions.subscribe(refresh);
				refresh();
				return unsubscribe;
			}, [props.sessionId, props.useSessions]);
			(0, react.useEffect)(() => {
				if (!menuOpen) return;
				const onOutside = (event) => {
					if (wrapperRef.current !== null && event.target instanceof Node && wrapperRef.current.contains(event.target)) return;
					setMenuOpen(false);
				};
				const onEscape = (event) => {
					if (event.key === "Escape") setMenuOpen(false);
				};
				document.addEventListener("mousedown", onOutside, true);
				document.addEventListener("keydown", onEscape, true);
				return () => {
					document.removeEventListener("mousedown", onOutside, true);
					document.removeEventListener("keydown", onEscape, true);
				};
			}, [menuOpen]);
			const openMenu = () => {
				setMenuOpen(true);
				if ((models === void 0 || models === "error") && binding !== void 0) {
					setModels("loading");
					binding.loadModels().then((catalog) => {
						setModels(catalog);
					}, () => {
						setModels("error");
					});
				}
			};
			const menuItem = toolbarMenuItem;
			const groupCaptionStyle = {
				padding: "6px 10px 2px",
				fontSize: "11px",
				color: "rgba(220, 221, 224, 0.55)",
				whiteSpace: "nowrap"
			};
			const menuChildren = [];
			menuChildren.push(menuItem(props.t("menu.open"), () => {
				setMenuOpen(false);
				binding?.openLatest(props.sessionId);
			}));
			menuChildren.push(menuItem(props.t("menu.newDefault"), () => {
				setMenuOpen(false);
				binding?.createNew(props.sessionId, void 0);
			}));
			menuChildren.push((0, react.createElement)("div", {
				key: "models-caption",
				style: {
					...groupCaptionStyle,
					marginTop: "4px"
				}
			}, props.t("menu.newByModel")));
			if (models === "loading" || models === void 0) menuChildren.push((0, react.createElement)("div", {
				key: "models-loading",
				style: groupCaptionStyle
			}, props.t("menu.loading")));
			else if (models === "error") menuChildren.push((0, react.createElement)("div", {
				key: "models-error",
				style: groupCaptionStyle
			}, props.t("menu.loadFailed")));
			else for (const group of models.groups) {
				menuChildren.push((0, react.createElement)("div", {
					key: `group:${group.id}`,
					style: groupCaptionStyle
				}, group.name));
				for (const model of group.models) menuChildren.push(menuItem(`另开：${model.name || model.id}`, () => {
					setMenuOpen(false);
					binding?.createNew(props.sessionId, {
						provider: group.id,
						model: model.id
					});
				}));
			}
			if (hasAux) {
				menuChildren.push((0, react.createElement)("div", {
					key: "delete-sep",
					style: {
						borderTop: "1px solid rgba(255,255,255,0.12)",
						margin: "4px 0"
					}
				}));
				menuChildren.push(menuItem(props.t("menu.constraint"), () => {
					setMenuOpen(false);
					binding?.attachConstraint(props.sessionId);
				}));
				menuChildren.push(menuItem(props.t("aux.delete"), () => {
					setMenuOpen(false);
					binding?.closeLatest(props.sessionId);
				}));
			}
			return (0, react.createElement)("span", {
				ref: wrapperRef,
				style: {
					position: "relative",
					display: "inline-flex"
				}
			}, (0, react.createElement)("button", {
				type: "button",
				title: props.t("menu.title"),
				style: {
					border: "none",
					background: "transparent",
					color: "rgba(200, 200, 205, 0.7)",
					font: "inherit",
					fontSize: "12px",
					cursor: "pointer",
					padding: "2px 6px",
					borderRadius: "6px"
				},
				onClick: () => {
					menuOpen ? setMenuOpen(false) : openMenu();
				}
			}, `${props.t("menu.title")} ▾`), menuOpen ? (0, react.createElement)("div", { style: {
				position: "absolute",
				top: "calc(100% + 6px)",
				right: "0",
				zIndex: "2147483000",
				minWidth: "230px",
				maxHeight: "380px",
				overflowY: "auto",
				padding: "6px",
				display: "flex",
				flexDirection: "column",
				gap: "2px",
				background: "#2f3037",
				border: "1px solid rgba(255, 255, 255, 0.16)",
				color: "#f2f3f5",
				font: "inherit",
				borderRadius: "10px",
				boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)"
			} }, menuChildren) : null);
		}
		/**
		* Browser plugin body (方案 B): register the tab surface, the header menu,
		* the selection chip, the `/side` contribution, and lifecycle cleanup.
		* @param ctx - browser root context carrying the injected services.
		* @param config - the composed row config.
		*/
		function apply(ctx, config) {
			const settings = normalizeConfig(config);
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-chat-assistant: locale dictionary");
			/** Live aux children of one parent (registry ∩ live catalog), oldest first. */
			const liveAuxOf = (parent) => {
				const snapshot = ctx.sessions.list.getSnapshot();
				return pruneAuxChildren(parent, new Set(Object.keys(snapshot.byId)));
			};
			/**
			* The family parent of a session: itself, or — when the session is a
			* registered aux child (the user is INSIDE an aux conversation) — the parent
			* that owns it, so every entry point keeps working there.
			*/
			const resolveTargetParent = (sessionId) => ownerOfChild(sessionId) ?? sessionId;
			/** Archive one aux child; forget the registry entry only when it succeeded. */
			const archiveAux = (owner, childId) => ctx.remote.workspace.archiveSession({
				sessionId: childId,
				stopActivity: true
			}).then((result) => {
				if (!result.ok) {
					ctx.logger.warn(`dsh-chat-assistant: aux archive failed: ${result.error.code}: ${result.error.message}`);
					return false;
				}
				removeAuxChild(owner, childId);
				pendingQuotes.delete(childId);
				constraintChips.delete(childId);
				constraintStaged.delete(childId);
				return true;
			}, (error) => {
				ctx.logger.warn("dsh-chat-assistant: aux archive threw", error);
				return false;
			});
			/**
			* Close every open aux tab of one child, on screen or not: the Tab domain's
			* `closeIn` reaches any adopted surface, and the same address can be open in
			* MORE than one surface (the parent's sidebar plus the child's own), so a
			* matching tab is closed in every candidate surface. The close handler
			* re-entry is safe — callers remove the registry entry first.
			*/
			const closeAuxTabEverywhere = (childId, ownerHint) => {
				const closeInFace = ctx.sidebarRight;
				const surfaces = /* @__PURE__ */ new Set();
				if (ownerHint !== void 0) surfaces.add(ownerHint);
				const owner = ownerOfChild(childId);
				if (owner !== void 0) surfaces.add(owner);
				surfaces.add(childId);
				for (const surface of surfaces) try {
					for (const tab of ctx.sidebarRight.tabsIn(surface)) if (tab.kind === "auxchat" && parseAuxChatAddress(tab.contentId) === childId) closeInFace.closeIn(surface, tab.id);
				} catch (_surfaceUnavailable) {}
			};
			/** Locate an already-open aux tab for one child session, if any. */
			const findAuxTab = (parent, childId) => ctx.sidebarRight.tabsIn(parent).find((entry) => entry.kind === "auxchat" && parseAuxChatAddress(entry.contentId) === childId);
			/**
			* Open (reveal + dock) one aux child's tab in the on-screen parent's
			* sidebar. An existing tab is focused (and the column expanded) instead of
			* re-running the claim path. The tab stays docked in the column — the
			* platform expands the sidebar to show it (its own open contract) and
			* keeps the layout persisted per session.
			*/
			const openTab = (parent, childId) => {
				const mounted = ctx.sidebarRight.mounted.getSnapshot();
				if (mounted !== void 0 && resolveTargetParent(mounted) !== parent) {
					showNotice("辅助对话入口与当前屏幕会话不一致，请刷新后重试");
					ctx.logger.warn(`dsh-chat-assistant: open skipped — mounted ${String(mounted)} ≠ family of ${String(parent)}`);
					return;
				}
				const tabDomain = ctx.sidebarRight;
				const attempt = () => {
					const existing = findAuxTab(parent, childId);
					if (existing !== void 0) {
						if (ctx.sidebarRight.mounted.getSnapshot() !== void 0 && !ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
						try {
							ctx.sidebarRight.focus(existing.id);
						} catch (_fullscreenFocus) {}
						return;
					}
					if (ctx.sidebarRight.mounted.getSnapshot() !== void 0) {
						ctx.sidebarRight.openResource(auxChatAddress(childId), {
							kind: "auxchat",
							preferNewPane: true
						});
						return;
					}
					const target = ctx.sidebarRight.commandTarget();
					if (target !== void 0) {
						tabDomain.openResourceIn(target.sessionId, auxChatAddress(childId), {
							kind: "auxchat",
							preferNewPane: true
						});
						return;
					}
					throw new Error("sidebarRight: no session surface is mounted");
				};
				try {
					attempt();
				} catch (first) {
					ctx.logger.warn("dsh-chat-assistant: open failed once, retrying shortly", first);
					window.setTimeout(() => {
						try {
							attempt();
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.logger.warn("dsh-chat-assistant: openResource threw", error);
							showNotice(`打开辅助对话失败：${/no session surface/i.test(message) ? "辅助对话已创建——全屏展示下无法打开新 tab，请退出全屏后在左侧列表查看" : message}`);
						}
					}, 350);
				}
			};
			/** One in-flight fork per parent: a double-invoked create gesture shares one creation. */
			const creatingByParent = /* @__PURE__ */ new Map();
			/** Fork one new aux conversation under a parent and open it (single-flight per parent). */
			const createAux = (rawParent, model) => {
				const parent = resolveTargetParent(rawParent);
				const inflight = creatingByParent.get(parent);
				if (inflight !== void 0) return inflight;
				const flight = (async () => {
					const childId = await ctx.sessions.fork({
						sessionId: parent,
						increaseTitle: false
					});
					const label = `辅助对话 ${nextAuxOrdinal(parent)}`;
					addAuxChild(parent, {
						childId,
						label,
						createdAt: Date.now()
					});
					try {
						const rename = await ctx.remote.session.rename({
							sessionId: childId,
							title: label
						});
						if (!rename.ok) ctx.logger.warn(`dsh-chat-assistant: aux rename failed: ${rename.error.code}: ${rename.error.message}`);
					} catch (error) {
						ctx.logger.warn("dsh-chat-assistant: aux rename threw", error);
					}
					if (model !== void 0) try {
						const selection = await ctx.remote.session.selectModel({
							sessionId: childId,
							provider: model.provider,
							model: model.model
						});
						if (!selection.ok) ctx.logger.warn(`dsh-chat-assistant: aux model preset failed: ${selection.error.code}: ${selection.error.message}`);
					} catch (error) {
						ctx.logger.warn("dsh-chat-assistant: aux model preset threw", error);
					}
					stageConstraintWhenReady(childId);
					openTab(parent, childId);
					return childId;
				})();
				creatingByParent.set(parent, flight);
				flight.then(() => {
					if (creatingByParent.get(parent) === flight) creatingByParent.delete(parent);
				}, () => {
					if (creatingByParent.get(parent) === flight) creatingByParent.delete(parent);
				});
				return flight;
			};
			/** Open (or create) the latest aux conversation of the on-screen parent. */
			const openLatest = (rawParent) => {
				const parent = resolveTargetParent(rawParent);
				const latest = [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0];
				if (latest !== void 0) {
					openTab(parent, latest.childId);
					return;
				}
				createAux(parent, void 0).catch((error) => {
					ctx.logger.warn("dsh-chat-assistant: aux fork failed", error);
					showNotice(`辅助对话创建失败：${error instanceof Error ? error.message : String(error)}`);
				});
			};
			/**
			* Archive one aux conversation and close its tab. Inside an aux conversation
			* 删除 targets the conversation on screen; elsewhere it targets the family's
			* latest.
			*/
			const closeLatest = (rawParent) => {
				const parent = resolveTargetParent(rawParent);
				const mounted = ctx.sidebarRight.mounted.getSnapshot();
				const target = (mounted !== void 0 && mounted !== parent ? auxChildrenOf(parent).find((entry) => entry.childId === mounted) : void 0) ?? [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0];
				if (target === void 0) {
					showNotice("当前没有可删除的辅助对话");
					return;
				}
				archiveAux(parent, target.childId).then((archived) => {
					if (!archived) {
						showNotice("辅助对话删除失败，请重试");
						return;
					}
					closeAuxTabEverywhere(target.childId, parent);
				});
			};
			/** Bridge to the concrete controller face: several attachment verbs ship off the public IConversation interface. */
			const conversationBridge = () => ctx.conversation;
			const createDraftFiles = (childId, files) => conversationBridge().createDrafts(childId, files);
			/** Per-aux pending merged quote: the staged attachment id and its collected texts. */
			const pendingQuotes = /* @__PURE__ */ new Map();
			/**
			* Merge one selection into the pending quote attachment of an aux chat —
			* ZCode semantics: identical selections dedupe silently; count/total limits
			* refuse loudly; each staging replaces the previous file so the composer
			* always shows exactly ONE quote chip no matter how many passages were
			* collected. Returns 'staged' | 'duplicate' (terminal) or 'busy' (caller
			* should retry).
			*/
			const stageQuote = (childId, actx, text) => {
				const input = ctx.conversation.input.for(actx);
				let pending = pendingQuotes.get(childId);
				if (pending !== void 0 && !input.state.getSnapshot().attachmentIds.includes(pending.attachmentId)) {
					pendingQuotes.delete(childId);
					pending = void 0;
				}
				if (pending !== void 0 && pending.items.includes(text)) return "duplicate";
				if (pending !== void 0 && pending.items.length >= QUOTE_MAX_COUNT) {
					showNotice(`对话引用最多 ${QUOTE_MAX_COUNT} 条，已达上限`);
					return "duplicate";
				}
				if ((pending?.items ?? []).reduce((sum, item) => sum + item.length, 0) + text.length > QUOTE_MAX_TOTAL_CHARS) {
					showNotice(`对话引用总量超过 ${QUOTE_MAX_TOTAL_CHARS} 字上限`);
					return "duplicate";
				}
				const items = [...pending?.items ?? [], text];
				const now = /* @__PURE__ */ new Date();
				const pad = (value) => String(value).padStart(2, "0");
				const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
				const header = items.length === 1 ? `# 对话引用\n\n> 划词自主会话 · ${stamp}\n\n` : `# 对话引用（${items.length} 条）\n\n> 划词自主会话 · ${stamp}\n\n`;
				const body = items.length === 1 ? items[0] : items.map((item, index) => `## 引用 ${index + 1}\n\n${item}`).join("\n\n");
				const name = items.length === 1 ? `对话引用 ${pad(now.getHours())}${pad(now.getMinutes())}.md` : `对话引用 ${items.length}条 ${pad(now.getHours())}${pad(now.getMinutes())}.md`;
				const file = new File([header + body], name, { type: "text/markdown" });
				if (pending !== void 0 && input.removeAttachment(pending.attachmentId)) conversationBridge().releaseDraftAttachment(pending.attachmentId);
				const ids = createDraftFiles(childId, [file]).map((draft) => draft.id);
				const quoteId = ids[0];
				if (quoteId === void 0) return "busy";
				if (!input.addAttachments(ids)) {
					conversationBridge().releaseDraftAttachment(quoteId);
					return "busy";
				}
				pendingQuotes.set(childId, {
					attachmentId: quoteId,
					items
				});
				input.focus();
				return "staged";
			};
			/** Aux children with a known live constraint chip (replaced on manual re-attach to avoid duplicates). */
			const constraintChips = /* @__PURE__ */ new Map();
			/** Stage the boundary-constraint file; pure attachment, never touches the draft, no focus steal. */
			const stageConstraintFile = (childId, actx) => {
				const file = new File([AUX_CONSTRAINT_MARKDOWN], "对话约束.md", { type: "text/markdown" });
				const ids = createDraftFiles(childId, [file]).map((draft) => draft.id);
				const attachmentId = ids[0];
				if (attachmentId === void 0) return void 0;
				if (!ctx.conversation.input.for(actx).addAttachments(ids)) {
					conversationBridge().releaseDraftAttachment(attachmentId);
					return;
				}
				constraintChips.set(childId, attachmentId);
				return attachmentId;
			};
			/** Aux children whose constraint file was already staged (or declined) this page lifetime. */
			const constraintStaged = /* @__PURE__ */ new Set();
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
			const stageConstraintWhenReady = (childId) => {
				if (constraintStaged.has(childId)) return;
				constraintStaged.add(childId);
				const deadline = Date.now() + COMPOSER_WAIT_MS;
				const attempt = () => {
					const actx = ctx.sessions.scope(childId);
					if (actx !== void 0) try {
						if (stageConstraintFile(childId, actx) !== void 0) return;
					} catch (error) {
						ctx.logger.warn("dsh-chat-assistant: constraint staging failed", error);
						return;
					}
					if (Date.now() < deadline) {
						window.setTimeout(attempt, 150);
						return;
					}
					constraintStaged.delete(childId);
				};
				attempt();
			};
			/**
			* Manually (re-)attach the constraint file to one aux conversation: covers
			* chats born before the constraint feature and chips the user deleted and
			* changed their mind about. Replaces a still-present constraint chip so a
			* double invocation never stacks duplicates.
			*/
			const attachConstraintManually = (childId) => {
				const deadline = Date.now() + COMPOSER_WAIT_MS;
				const attempt = () => {
					const actx = ctx.sessions.scope(childId);
					if (actx !== void 0) try {
						const input = ctx.conversation.input.for(actx);
						const previous = constraintChips.get(childId);
						if (previous !== void 0) {
							if (input.removeAttachment(previous)) conversationBridge().releaseDraftAttachment(previous);
							constraintChips.delete(childId);
						}
						if (stageConstraintFile(childId, actx) !== void 0) {
							showNotice("已附加约束文件（删除芯片即解除约束）");
							return;
						}
					} catch (error) {
						ctx.logger.warn("dsh-chat-assistant: manual constraint staging failed", error);
					}
					if (Date.now() < deadline) {
						window.setTimeout(attempt, 150);
						return;
					}
					showNotice("约束文件附加失败，请重试");
				};
				attempt();
			};
			/** Legacy fallback: write the quote into the draft as plain text. */
			const draftQuoteFallback = (childId, quote) => {
				const actx = ctx.sessions.scope(childId);
				if (actx === void 0) {
					showNotice("辅助对话输入框未就绪，选段未能带入——请手动粘贴");
					return;
				}
				try {
					const input = ctx.conversation.input.for(actx);
					input.setDraft(`「${quote}」\n`);
					input.focus();
				} catch (_composerGone) {
					showNotice("辅助对话输入框未就绪，选段未能带入——请手动粘贴");
				}
			};
			/**
			* Hand one selected passage to the auxiliary chat: open (or create) the aux
			* window, then stage the quote as a PACKAGED attachment — no message is
			* sent; the user completes and submits it themselves. Retries until the
			* session scope carries a resident input shell; a refusal or timeout falls
			* back to the legacy draft write.
			*/
			const handOffSelection = (text, mode) => {
				const mounted = ctx.sidebarRight.mounted.getSnapshot();
				if (mounted === void 0) {
					showNotice("当前无法确定主会话（全屏展示下请先退出全屏），选段未能带入");
					return;
				}
				const parent = resolveTargetParent(mounted);
				const quote = text.length > SELECTION_MAX_CHARS ? `${text.slice(0, SELECTION_MAX_CHARS)}\n\n（引用超过 ${SELECTION_MAX_CHARS} 字，已截断）` : text;
				const stage = (childId) => {
					const deadline = Date.now() + COMPOSER_WAIT_MS;
					const attempt = () => {
						const actx = ctx.sessions.scope(childId);
						if (actx !== void 0) try {
							if (stageQuote(childId, actx, quote) !== "busy") return;
						} catch (error) {
							ctx.logger.warn("dsh-chat-assistant: quote staging failed", error);
						}
						if (Date.now() < deadline) window.setTimeout(attempt, 150);
						else draftQuoteFallback(childId, quote);
					};
					attempt();
				};
				const latest = [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0];
				if (mode === "latest" && latest !== void 0) {
					openTab(parent, latest.childId);
					stage(latest.childId);
					return;
				}
				createAux(parent, void 0).then(stage, (error) => {
					ctx.logger.warn("dsh-chat-assistant: aux fork for selection failed", error);
					showNotice("辅助对话创建失败，选段未能带入");
				});
			};
			const resourceProvider = {
				protocol: "auxchat",
				async *open(resourceAddress, { signal }) {
					const childId = parseAuxChatAddress(resourceAddress);
					if (childId === void 0) {
						showNotice(`辅助对话资源地址无效：${resourceAddress}`);
						throw new Error(`dsh-chat-assistant: invalid aux resource address "${resourceAddress}"`);
					}
					if (signal.aborted) return;
					let reference;
					try {
						reference = ctx.sessions.retain(childId, {
							source: "auxChat",
							signal
						});
					} catch (error) {
						showNotice(`辅助对话会话保留失败：${error instanceof Error ? error.message : String(error)}`);
						throw error;
					}
					try {
						yield {
							ok: true,
							value: {
								childId,
								reference
							}
						};
						await waitForAbort(signal);
					} finally {
						reference.release();
					}
				}
			};
			ctx.inject(["resources", "sidebarRightTabs"], (scope) => {
				scope.effect(() => scope.resources.register(resourceProvider), "dsh-chat-assistant: aux resources");
				scope.effect(() => scope.sidebarRightTabs.register({
					id: AUX_CHAT_TAB_ID,
					kind: "auxchat",
					patterns: [`${AUX_CHAT_ADDRESS}**`],
					priority: "extension",
					keepMounted: true,
					canOpen: (address) => parseAuxChatAddress(address) !== void 0,
					title: (address) => {
						const child = parseAuxChatAddress(address);
						const summary = child === void 0 ? void 0 : ctx.sessions.list.getSnapshot().byId[child];
						return summary?.displayTitle ?? summary?.projectionValues?.title ?? "辅助对话";
					}
				}), "dsh-chat-assistant: aux tab type");
				scope.effect(() => scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
					name: "sidebar.right.pane.tab",
					key: AUX_CHAT_TAB_ID,
					children: { "chat-assistant.conversation": {
						kind: "single",
						scope: "session"
					} },
					inject: () => ({})
				}, AuxChatTabBody)), "dsh-chat-assistant: aux tab body");
				scope.effect(() => scope.slots.inject("chat-assistant.conversation", () => scope.slots.register({ name: "chat-assistant.conversation" }, AuxConversationPanel)), "dsh-chat-assistant: aux conversation");
			});
			ctx.effect(() => {
				headerControlsBinding = {
					openLatest: (parentSessionId) => {
						openLatest(parentSessionId);
					},
					createNew: (parentSessionId, model) => {
						createAux(parentSessionId, model).catch((error) => {
							ctx.logger.warn("dsh-chat-assistant: aux fork failed", error);
							showNotice("辅助对话创建失败，请重试");
						});
					},
					closeLatest: (parentSessionId) => {
						closeLatest(parentSessionId);
					},
					attachConstraint: (parentSessionId) => {
						const parent = resolveTargetParent(parentSessionId);
						const mounted = ctx.sidebarRight.mounted.getSnapshot();
						const target = (mounted !== void 0 && mounted !== parent && ownerOfChild(mounted) === parent ? mounted : void 0) ?? [...liveAuxOf(parent)].sort((left, right) => right.createdAt - left.createdAt)[0]?.childId;
						if (target === void 0) {
							showNotice("没有可附加约束的辅助对话");
							return;
						}
						attachConstraintManually(target);
					},
					loadModels: async () => {
						const result = await ctx.remote.session.modelCatalog();
						if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
						return result.value;
					}
				};
				return () => {
					headerControlsBinding = void 0;
				};
			}, "dsh-chat-assistant: header controls binding");
			ctx.effect(() => {
				auxToolbarBinding = {
					attachConstraint: (childId) => {
						attachConstraintManually(childId);
					},
					deleteThis: (childId) => {
						const owner = ownerOfChild(childId);
						if (owner === void 0) {
							showNotice("该对话不在登记表中，无法在此删除");
							return;
						}
						archiveAux(owner, childId).then((archived) => {
							if (!archived) {
								showNotice("辅助对话删除失败，请重试");
								return;
							}
							closeAuxTabEverywhere(childId, owner);
						});
					},
					createNew: (childId) => {
						createAux(resolveTargetParent(childId), void 0).catch((error) => {
							ctx.logger.warn("dsh-chat-assistant: aux fork failed", error);
							showNotice("辅助对话创建失败，请重试");
						});
					}
				};
				return () => {
					auxToolbarBinding = void 0;
				};
			}, "dsh-chat-assistant: aux toolbar binding");
			ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "chat-assistant-controls",
				order: 10,
				locale: NS,
				label: () => t("menu.title")
			}, AuxHeaderControls)), "dsh-chat-assistant: header controls");
			if (settings.selectionChip) ctx.effect(() => installSelectionChip(t, handOffSelection), "dsh-chat-assistant: selection chip");
			for (const commandName of settings.commandNames) ctx.effect(() => ctx.commandUi.register({
				name: commandName,
				label: () => t("menu.open"),
				description: () => "打开当前会话的辅助对话（停靠在右侧栏；关闭即归档）",
				available: (session) => true,
				ui: {
					kind: "action",
					run: (session) => {
						openLatest(session.sessionId);
					}
				}
			}), `dsh-chat-assistant: /${commandName} contribution`);
			ctx.effect(() => {
				const reconcile = () => {
					const snapshot = ctx.sessions.list.getSnapshot();
					const liveIds = new Set(Object.keys(snapshot.byId));
					for (const [parentKey, children] of Object.entries(auxRegistrySnapshot())) {
						const parentLive = liveIds.has(parentKey);
						for (const child of children) {
							const childLive = liveIds.has(child.childId);
							if (childLive && parentLive) continue;
							if (!childLive) {
								removeAuxChild(parentKey, child.childId);
								closeAuxTabEverywhere(child.childId, parentKey);
								continue;
							}
							ctx.remote.workspace.archiveSession({
								sessionId: child.childId,
								stopActivity: true
							}).then((result) => {
								if (result.ok) {
									removeAuxChild(parentKey, child.childId);
									closeAuxTabEverywhere(child.childId, parentKey);
								} else ctx.logger.warn(`dsh-chat-assistant: parent-cleanup archive failed: ${result.error.code}`);
							}, (error) => {
								ctx.logger.warn("dsh-chat-assistant: parent-cleanup archive threw", error);
							});
						}
					}
				};
				reconcile();
				const deferred = window.setTimeout(reconcile, 3e3);
				const unsubscribeList = ctx.sessions.list.subscribe(reconcile);
				const unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(reconcile);
				return () => {
					window.clearTimeout(deferred);
					unsubscribeList();
					unsubscribeMounted();
				};
			}, "dsh-chat-assistant: catalog reconcile");
			ctx.effect(() => ctx.sidebarRight.registerCloseHandler("auxchat", (_surfaceSession, tab) => {
				const childId = parseAuxChatAddress(tab.contentId);
				if (childId === void 0) return;
				const owner = ownerOfChild(childId);
				if (owner === void 0) return;
				archiveAux(owner, childId);
			}), "dsh-chat-assistant: close archives auxchat");
		}
		/** Read the raw registry (for the cleanup pass). */
		function auxRegistrySnapshot() {
			try {
				const raw = localStorage.getItem("dsh.chat-assistant.registry.v1");
				if (raw === null) return {};
				return JSON.parse(raw).byParent ?? {};
			} catch (_unreadable) {
				return {};
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map