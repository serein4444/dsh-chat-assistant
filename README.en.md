# dsh-chat-assistant

English | [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-chat-assistant.svg)](https://www.npmjs.com/package/dsh-chat-assistant)
[![npm downloads](https://img.shields.io/npm/dm/dsh-chat-assistant.svg)](https://www.npmjs.com/package/dsh-chat-assistant)
[![License](https://img.shields.io/npm/l/dsh-chat-assistant.svg)](https://github.com/serein4444/dsh-chat-assistant/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/serein4444/dsh-chat-assistant.svg)](https://github.com/serein4444/dsh-chat-assistant/releases)

A third-party plugin for DeepSeek Harness (DSH): an **auxiliary chat**. It forks an ordinary session from the main conversation and opens it as an `auxchat` tab **docked in the right sidebar** — carrying the full inherited history, supporting multiple chats, with its own model choice. Selected text is handed off as a packaged attachment chip, and **closing the tab archives the session automatically**.

Two things added within what a third-party plugin can reach: the constraints travel as a deletable attachment (removing the chip unbinds them), and closing the tab archives the conversation (no orphan sessions left behind).

Available from: [npm](https://www.npmjs.com/package/dsh-chat-assistant) · [GitHub Releases](https://github.com/serein4444/dsh-chat-assistant/releases) · [source repository](https://github.com/serein4444/dsh-chat-assistant)

## Features

| Capability | Details |
|---|---|
| Docked in the sidebar | Aux chats use a dedicated tab type in the right sidebar; split, fullscreen, and collapse all work (`keepMounted`, so switching away never loses the state) |
| Full history | The fork inherits the parent's completed-turn prefix; the transcript scrolls back through it |
| Multiple chats | Auto-numbered (`辅助对话 1`, `辅助对话 2`, …); numbers are reused after deletion; opening again focuses the existing chat; creation is single-flight (double-clicking never forks twice) |
| Model | Create with a specific model from the catalog; a fork is an ordinary session, so `/model` switches freely inside the window |
| Selection quotes | Two buttons next to a selection: open in the current aux chat, or start a new one. The quote is packaged as an `.md` **attachment chip** — the composer text stays empty — and multiple selections merge into one chip (≤ 8 quotes, ≤ 16000 characters total, exact-text dedup). It is sent natively with your next message |
| Constraint file | Every fresh aux chat gets a `对话约束.md` attachment: inherited history is reference only / do not continue the parent task automatically / modify the workspace only when explicitly asked / leave a record of any modification. **Deleting the chip unbinds the constraints**; re-attach any time from the menu |
| Close = archive | Explicitly closing a tab (×, menu, shortcut, or replacement) archives that session; collapsing the sidebar is not a close |
| Lifecycle reconciliation | Catalog reconcile: if an aux chat is archived anywhere, its stale tab is closed; if the parent is archived, all its aux chats are archived too |

## Entry points

- **Main-session header menu** (`辅助对话 ▾`): open/focus · start another · start with a chosen model · attach constraint file · delete;
- **In-tab toolbar** (top-right `⋯`, self-sufficient even in fullscreen): attach constraint file · delete this chat · start another;
- **Selection chip**: appears as soon as you select text;
- **Slash commands**: `/side` (plus `/btw` as a synonym by default) opens or focuses the current session's aux chat.

## Configuration

Override the `chat-assistant` row in your profile's `cordis.patch.yml` (restate every key you change):

```yaml
- insert:
    - id: chat-assistant
      name: dsh-chat-assistant
      config:
        commandNames: [side, btw]   # slash command names (all of them are registered)
        selectionChip: true         # show the selection chip
```

Configuration is validated strictly: unknown keys, wrong types, and malformed command names all fail loudly at load. The 0.1.x keys (`provider`, `label`, `standbyPrompt`, `agentOptions`, `autoFloat`, `floatRect`) were removed with the architecture change and now raise an error.

## Compatibility

| Dependency | Version | Notes |
|---|---|---|
| DeepSeek Harness | **0.2.0-rc.2** | DSH is in developer preview; re-test this plugin after upgrading DSH |
| `@deepseek-ai/cordis` | ~4.0.4 | the host's vendored version |
| Node.js | >= 22.19 | matches the DSH baseline |

## Installation

**npm package page**: https://www.npmjs.com/package/dsh-chat-assistant

```sh
dsh plugin add dsh-chat-assistant                  # from npm (recommended)
dsh plugin add ./dsh-chat-assistant-<version>.tgz  # or from a local tarball
```

The tarball is also attached to [GitHub Releases](https://github.com/serein4444/dsh-chat-assistant/releases). On the desktop app the in-app Plugin Manager behaves identically.

## Local development

```sh
cd chat-assistant
pnpm install
pnpm build         # lib/index.js (host half, a no-op) + lib/client.js (browser half)
pnpm typecheck
```

Loading it into a source build of the web UI (**optional**; requires a DSH checkout matching the baseline):

```sh
# Do not use master HEAD — the interfaces drift. Check out the matching tag.
git clone --depth 1 --branch dsh-v0.2.0-rc.2 https://github.com/deepseek-ai/deepseek-harness
cd deepseek-harness && pnpm install
pnpm dsh web --patch <absolute-path>/chat-assistant/dev.patch.yml --no-open --port 3800
```

- The compatibility baseline is pinned to `dsh-v0.2.0-rc.2` (commit `639ed015397290b3745d163aafe02ffee4aa3f84`); after upgrading DSH, re-check the sidebar tab registration/close hooks and the draft-attachment contract;
- The module registry serves the built `lib/client.js`, not the sources — rebuild before reloading;
- On this machine: port 3080 falls inside a Windows excluded range, hence 3800 in the example; the page and `/api` need the token printed in the startup log; `/plugins` bundle routes match the exact "path + query" string, so any extra parameter turns them into a 404.

## Architecture at a glance

- **Dual-face package**: the host half `lib/index.js` is intentionally empty (everything is orchestrated client-side — `sessions.fork`, rename, selectModel, and archiveSession are all client remotes); the browser half `lib/client.js` is a CJS closure factory (`window.__ModuleLoader__.load`) with type-only imports from `@deepseek-ai/*` and zero runtime dependencies.
- **Parent → child registry**: a fork carries no platform-level parent link, so localStorage `dsh.chat-assistant.registry.v1` records parent → children (label, ordinal, creation time). It drives the numbering, family resolution (acting on the parent's family while inside an aux chat), and lifecycle reconciliation. Corrupted entries are discarded on read.
- **Quotes and constraints** ride the platform's native draft-attachment channel (`createDrafts` + `addAttachments`, uploaded as soon as they are staged) and are serialized natively with the message — no custom draft state involved.

## Known limitations

- An aux chat's context is a **snapshot** taken at fork time; later messages in the main session are not synced.
- Constraints are **prompt-level** (the attachment enters the model context with the first message), not a sandbox.
- Aux chats created before 0.7.1 never got a constraint file retroactively (attach one manually from the `⋯` menu).
- The selection chip uses inline neutral styling and does not follow theme tokens.
- Re-test after DSH upgrades, especially the sidebar tab and attachment contracts.
- **UI copy is Chinese-first**: the registered locale keys (menu items, chip labels) have English translations, but some notices and the in-tab toolbar labels are currently Chinese only.

## License

MIT
