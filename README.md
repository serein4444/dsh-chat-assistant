# dsh-chat-assistant

[English](README.en.md) | 中文

[![npm version](https://img.shields.io/npm/v/dsh-chat-assistant.svg)](https://www.npmjs.com/package/dsh-chat-assistant)
[![npm downloads](https://img.shields.io/npm/dm/dsh-chat-assistant.svg)](https://www.npmjs.com/package/dsh-chat-assistant)
[![License](https://img.shields.io/npm/l/dsh-chat-assistant.svg)](https://github.com/serein4444/dsh-chat-assistant/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/serein4444/dsh-chat-assistant.svg)](https://github.com/serein4444/dsh-chat-assistant/releases)

DeepSeek Harness（DSH）第三方插件：**辅助对话**。从主会话 fork 出一个普通会话，以 `auxchat` 标签**停靠在右侧栏**打开——继承完整历史、可多开、独立选模型；划词引用打包为附件芯片；**关闭标签即自动归档**。

在平台第三方能力内做了两处增强：约束随附可删（删除芯片即解除约束）、关闭即归档（不留孤儿会话）。

发布渠道：[npm](https://www.npmjs.com/package/dsh-chat-assistant) · [GitHub Releases](https://github.com/serein4444/dsh-chat-assistant/releases) · [源码仓库](https://github.com/serein4444/dsh-chat-assistant)

## 功能

| 能力 | 说明 |
|---|---|
| 停靠侧栏 | 辅助对话以专属标签类型停靠右侧栏；支持分栏、全屏、折叠（`keepMounted` 常挂载，切走不丢现场） |
| 完整历史 | fork 继承主会话已完成轮次前缀，转录可滚动回看 |
| 多开 | 「辅助对话 N」自动编号，删除后编号释放复用；重复打开幂等聚焦；同一父会话创建单飞（双击不会 fork 出两个） |
| 模型 | 创建时可按模型目录另开；fork 是普通会话，窗口内 `/model` 随时可切 |
| 划词引用 | 选区旁浮条两键：「打开辅助对话」（并入最近的）/「新开辅助对话」。引文打包为 `.md` **附件芯片**，不占输入框正文；多选合并为一颗（≤8 条、总量 ≤16000 字、同文去重），随下一条消息原生发送 |
| 约束文件 | fork 诞生时自动附上《对话约束.md》：历史仅供参考 / 不自动续做父任务 / 明确要求才改工作区 / 修改留记录。**删除芯片 = 解除约束**；窗口内可随时重新附加 |
| 关闭即归档 | 显式关闭标签（×、菜单、快捷键、被替换）自动归档该会话；折叠侧栏不算关闭 |
| 生命周期联动 | 会话目录对账：辅助对话在任何地方被归档 → 残留标签自动关闭；主会话被归档 → 名下辅助对话全部自动归档 |

## 入口

- **主会话 header「辅助对话 ▾」菜单**：打开/聚焦 · 另开一个 · 按模型另开 · 附加约束文件 · 删除；
- **辅助对话窗口右上 ⋯ 工具条**（窗口内自足，全屏模式可用）：附加约束文件 · 删除本对话 · 另开一个；
- **划词浮条**：选中文字即现；
- **斜杠命令**：`/side`（默认另有 `/btw` 同义），打开/聚焦当前会话的辅助对话。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖 `chat-assistant` 行（覆盖需重述全部要改的键）：

```yaml
- insert:
    - id: chat-assistant
      name: dsh-chat-assistant
      config:
        commandNames: [side, btw]   # 斜杠命令名（全部注册）
        selectionChip: true         # 划词浮条开关
```

配置强校验：未知键、错误类型、非法命令名都会在加载时显式报错。0.1.x 的 `provider` / `label` / `standbyPrompt` / `agentOptions` / `autoFloat` / `floatRect` 已随架构移除，携带旧键会报错提示。

## 兼容性

| 依赖 | 版本 | 说明 |
|---|---|---|
| DeepSeek Harness | **0.2.0-rc.2** | DSH 处于 developer preview，升级 dsh 后需回归本插件 |
| `@deepseek-ai/cordis` | ~4.0.4 | 宿主 vendored 独立版本 |
| Node.js | >= 22.19 | 与 DSH 基线一致 |

## 安装

**npm 包页**：https://www.npmjs.com/package/dsh-chat-assistant

```sh
dsh plugin add dsh-chat-assistant                  # 从 npm 安装（推荐）
dsh plugin add ./dsh-chat-assistant-<version>.tgz  # 或本地 tarball
```

tarball 也可从 [GitHub Releases](https://github.com/serein4444/dsh-chat-assistant/releases) 下载；桌面端通过应用内 Plugin Manager 安装，行为一致。

## 本地开发

```sh
cd chat-assistant
pnpm install
pnpm build         # lib/index.js（宿主半，空操作）+ lib/client.js（浏览器半）
pnpm typecheck
```

装载进源码版 Web UI（**可选**，需要一份与目标版本一致的 DSH 源码检出）：

```sh
# 不要用 master HEAD：接口会漂移；按 tag 取与兼容基线一致的版本
git clone --depth 1 --branch dsh-v0.2.0-rc.2 https://github.com/deepseek-ai/deepseek-harness
cd deepseek-harness && pnpm install
pnpm dsh web --patch <绝对路径>/chat-assistant/dev.patch.yml --no-open --port 3800
```

- 兼容基线锁定 `dsh-v0.2.0-rc.2`（commit `639ed015397290b3745d163aafe02ffee4aa3f84`）；升级 DSH 后需回归右栏 tab 注册/关闭钩子与草稿附件契约；
- 模块注册表服务 `lib/client.js` 而非源码，改动后需重新 build 再刷新；
- 本机注意：3080 端口落在 Windows 保留段，示例用 3800；页面与 `/api` 需启动日志中 URL 的 token；`/plugins` bundle 路由按「路径+查询串」精确匹配，附加额外参数即 404。

## 架构速览

- **双面包体**：宿主面 `lib/index.js` 有意为空（全部客户端编排——`sessions.fork`、rename、selectModel、archiveSession 都是客户端远端）；浏览器面 `lib/client.js` 为 CJS 闭包工厂（`window.__ModuleLoader__.load`），对 `@deepseek-ai/*` 全部 type-only import，零运行时依赖。
- **父→子注册表**：fork 无平台级父子链，localStorage `dsh.chat-assistant.registry.v1` 记录 parent→children（标签、编号、创建时间），驱动多开编号、家族解析（在辅助对话内操作主会话家族）与生命周期对账。
- **引用与约束**走平台原生草稿附件通道（`createDrafts` + `addAttachments`，选中即上传），随消息原生序列化，不经自绘状态。

## 已知限制

- 辅助对话上下文是 fork 时的**快照**，主会话后续消息不同步。
- 约束为**提示词级**（附件随首条消息进入模型上下文），非沙箱强制。
- 0.7.1 之前创建的旧辅助对话不会追溯补挂约束（用 ⋯ 菜单手动附加）。
- 划词浮条为内联中性样式，未接主题 token。
- DSH 升级（尤其右栏 tab/附件契约）后需回归。

## License

MIT
