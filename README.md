# dsh-chat-assistant

DeepSeek Harness（DSH）辅助对话插件：在主任务运行（或卡在权限确认）时，`/side` 一条命令打开一个**继承主会话上下文**的辅助对话，以右侧边栏标签自动**浮动为应用内小窗**呈现，不打断主 Agent。

- 对标 ZCode 桌面端「辅助对话」（`/side` / `/btw`，每会话一个，关闭后可恢复）。
- 实现：宿主面注册 `/side`、`/btw` 人命令，通过 `fork` provider 创建 continuable 子代理（种子 = 父会话已完成轮次前缀）；浏览器面装饰裸命令调用并监听子代理目录投影，经内置 `subagentchat` 标签渲染、`float()` 浮动。
- 同一套代码支持 Web 与桌面端。

## 命名说明

DSH 对第三方插件包名没有强制校验，但官方教程（`docs/user/develop/basic/publish.md`）与整个生态一致采用 **`dsh-` 前缀 + kebab-case** 的 npm 包名（如 `dsh-usage-plugin`、`dsh-plugin-preflight`、`dsh-opencode`；官方仓库自身用 `@deepseek-ai/dsh-<name>`，该 scope 保留给官方）。因此：

| 项 | 值 |
|---|---|
| 项目目录 | `chat-assistant`（按用户指定） |
| npm 包名 | `dsh-chat-assistant`（生态规范形式） |
| 宿主面插件名 | `dsh-chat-assistant` |
| 浏览器面插件名 | `dsh-chat-assistant-client` |
| patch 行 | `id: chat-assistant`，`name: dsh-chat-assistant` |

发布到 npm 前若担心重名，可用个人 scope：`@<user>/dsh-chat-assistant`（同时更新 `cordis.patch.yml` 的 `name`）。

## 兼容性

| 依赖 | 版本 | 说明 |
|---|---|---|
| DeepSeek Harness | **0.2.0-rc.2**（精确 pin 于 peerDependencies） | CLI / 桌面端 / 基座 bundle 强制同版本；DSH 处于 developer preview，升级 dsh 后需回归本插件 |
| `@deepseek-ai/cordis` | ~4.0.4 | 宿主 vendored 独立版本 |

## 安装

```sh
dsh plugin add dsh-chat-assistant        # npm（预构建产物）
dsh plugin add ./dsh-chat-assistant-0.1.0.tgz   # 或 tarball
```

桌面端通过应用内 Plugin Manager 安装，行为一致。

## 使用

- `/side` + Enter（或命令面板点选）→ 打开/聚焦**最近使用**的辅助对话小窗（没有则新建）；
- `/side 这个函数是干嘛的` → 把问题投递给最近的辅助对话（没有则创建并作为首问）；
- **多开**：`/side --new` 另开一个新的辅助对话（标题自动编号「辅助对话 2」「辅助对话 3」…），可并存、互不影响；删除后编号释放供复用；
- 划词：在主对话中**左键选中一段文字**，选区旁出现「打开辅助对话」浮条；点击后**打开辅助对话窗口，并把选段以引用格式放进输入框作为草稿**（不自动发送）——自己补上问题再回车；选段超过 4000 字自动截断并在草稿中标注；若辅助对话尚不存在，先安静创建（只发待机提示词，不提选段）再写草稿；
- `/btw` 为同义命令；
- 辅助对话是功能完整的会话（可调工具、改文件、走权限确认、可停止），与主任务并行；
- 关闭小窗不销毁，重启 dsh 后 `/side` 恢复现场；
- **删除**：主会话标题栏「删除辅助对话」按钮（辅助对话存在时显示），或 `/side --close` 删除最近的一个，或在辅助窗口内输 `/side --close` 删除当前这个——删除 = 停止并归档（平台删除语义），编号随之释放；
- 主会话被删除/归档时，其名下的辅助对话自动一并归档清理；
- **不回传主对话**：辅助对话被禁止向主会话发送消息（创建时即剥夺 `send_message` 工具），子代理也不会再收到"回传结果"的指示——主对话保持干净；
- 新辅助对话的首条提示词自动附带**边界提醒**（继承历史仅供参考、不主动续做父任务、未经要求不改工作区）。

### 创建时指定模型与推理强度

子会话的模型在**创建时**固定（平台有意不为子会话提供会话中换模型的能力），因此模型选择发生在创建那一刻：

```text
/side --model deepseek-reasoner 这个证明怎么理解     # 指定模型新建
/side --model deepseek-reasoner --effort high 帮我重构这段
/side --model glm-4.7 --new                        # 另开一个新模型的辅助对话
/side --close                                      # 删除最近的辅助对话
```

- `--model <id>` / `--effort <等级>`：仅对**新建**生效；投递给已有对话时被忽略并在结果里提示。等级名以模型适配器公布为准（如 `low`/`medium`/`high`/`xhigh`）。
- `--new`：**多开**——另开一个新辅助对话，不删除已有的；配合 `--model` 即"用指定模型再开一个"。
- `--close`：删除**最近**的辅助对话（不新建）。删除后若小窗还开着，手动关掉即可。
- 不写旗标时使用配置里的 `agentOptions`（见下），两者都缺省则跟随主会话模型。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖 `chat-assistant` 行（行配置同时作用于宿主面与浏览器面；覆盖需重述全部要改的键）：

```yaml
- id: chat-assistant
  config:
    commandNames: [side, btw]   # 命令名（防撞名可改，如 [aux]）
    provider: fork              # 子代理 provider；fork = 继承主会话前缀
    label: 辅助对话              # 复用判定与标签页标题（durable）
    autoFloat: true             # 打开后自动浮动为小窗
    selectionChip: true         # 划词"打开辅助对话"浮条开关
    floatRect:                  # 首选浮动位置尺寸（CSS 像素，可省略；
      x: 720                    # 实际会钳制进当前视口，手动拖拽的位置优先于它）
      y: 120
      width: 760
      height: 920
    standbyPrompt: '…'          # 裸打开时的初始提示词
    agentOptions:               # 可选：新建辅助对话的默认模型等（被命令行旗标覆盖）
      model: deepseek-flash
```

配置在加载时强校验（未知键、错误类型、非法命令名都会 fail loud）。

### 浮窗尺寸与位置

默认尺寸 760×920（CSS 像素）。每次浮出时会把目标矩形钳制进当前窗口——位置优先取你手动拖拽后的记忆值（读自侧栏持久化），装不下时自动收回视口内，不会再被窗口边缘截断。`floatRect` 可整体覆盖首选矩形。

## 本地开发

```sh
cd chat-assistant
pnpm install
pnpm build        # 产出 lib/index.js（宿主半）+ lib/client.js（浏览器半）
pnpm typecheck
```

装载进源码版 Web UI：

```sh
cd ../download/deepseek-harness
pnpm dsh web --patch E:/fuzhuduihua_chajian/chat-assistant/dev.patch.yml --no-open --port 3800
```

（模块注册表服务的是 `lib/client.js` 而非源码，改动后需重新 build 再刷新。）

已验证的动态装载结果（2026-10-01，dsh 0.2.0-rc.2 源码版）：

- `--dump-config` 首段即 `# == …dev.patch.yml` 层，行 `id: chat-assistant` 正确组合；
- 页面 HTML 的 `window.__DSH_BOOT__` 启动图含 `dsh-chat-assistant` 条目及其 inject 清单；
- `GET /plugins/??dsh-chat-assistant/client.js&rev=<rev>` 返回 200（9.2 kB 闭包工厂 bundle）。

本机注意事项：3080 端口落在 Windows 保留段（`netsh interface ipv4 show excludedportrange protocol=tcp`），示例改用 3800；页面与 `/api` 需启动日志中 URL 的 token；`/plugins` bundle 路由的匹配键是"路径+查询串"精确串，附加任何额外参数即 404。

## 架构与设计文档的差异记录

相对《技术方案-辅助对话插件.md》v1.0（`../技术方案-辅助对话插件.md`），脚手架阶段按源码复核结果（方案 §10.4 C1-C8）做了以下修正：

1. **单行 patch**：不再拆 `aux-chat-host` / `aux-chat-client` 两行。核实 `dsh-client-modules` 会扫描"已启用 Loader 条目"对应包的 `dsh.client` 声明自动接入浏览器半（ui-commands 即单行双面形态），一行 `chat-assistant` 同时驱动两面，配置同源。
2. **不导出 `Config` schema**：插件 Config 用 zod/schemastery 声明（`@deepseek-ai/schemastery`，vendored）。为保持外部插件零运行时包依赖，改为代码内 `normalizeConfig` 强校验（fail loud 语义不变）。
3. **零运行时依赖**：两面入口对 `@deepseek-ai/*` 全部为 type-only import（构建期擦除）；宿主半仅用 `node:crypto`。peerDependencies 仅声明宿主面注入的服务所属包（cordis、dsh-commands、dsh-subagent）。
4. **客户端 bundle 契约**：浏览器半产物为 CJS 闭包工厂（`window.__ModuleLoader__.load({ id, factory })` + banner/intro/footer 包装），对齐 dsh 的 tsdown preset 产物形态。
5. **命令成功文本**：返回 `aux:<childId>`，浏览器面据此直接开窗（不经自然语言解析）；目录投影监听作为带参路径的兜底。

### 0.1.1 追加

6. **浮窗视口钳制**：浮出时读取侧栏持久化中用户拖拽过的位置，钳制进当前视口后显式传给 `float()`；无记忆时用视口自适应默认矩形（760×920）。持久化键 `dsh.sidebar-right.v1.<sessionId>` 为 ui-sidebar-right 的版本化内部格式，dsh 升级若改格式则静默回退默认矩形。
7. **划词浮条**：插件自有的 DOM 浮条（非注入 Electron 原生右键菜单——`main.ts` 的 `context-menu` 处理器是壳写死的，插件无法贡献菜单项）。
8. **`--model/--effort/--new` 旗标**：模型在子会话创建时固定是平台设计（ui-model-selection README 明示"subagent 继续执行也有意不公开独立的模型选择约定"），故模型选择落在创建通道上。

## 已知限制（v1）

- 辅助对话上下文是创建时的**快照**（fork 种子），主会话后续消息不自动同步（与 ZCode 行为一致）。
- 裸打开即触发一轮待机轮（standbyPrompt 极简抑制成本；带参 `/side 问题` 零浪费；`agentOptions` 可路由到更快模型）。
- 极端时序下（页面加载完成前立即带参 `/side`），自动开窗可能让位给命令面板重试；裸 `/side` 路径不受影响。
- 改 `label` 配置后，已有旧 label 的辅助对话不再被复用判定命中（会新建一个）。
- 子会话**会话中不可换模型**（平台限制）：换模型用 `/side --model X --new` 另开一个，旧对话内容不迁移。
- 划词浮条样式为中性深色内联样式，未接主题 token（外部插件无样式管线；后续可加 CSS Modules）。
- 删除/停止辅助对话时，主对话会出现一条一行结算通报（"Background subagent … was stopped"）——这是运行时所有者的行为，插件无法去除；除此之外辅助对话不再向主对话回传任何内容。

## License

MIT
