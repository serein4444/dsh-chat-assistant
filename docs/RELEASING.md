# 发布流程（维护者）

本插件有两个并行的分发通道，**长期只用第一个**。

## 1. npm Trusted Publishing（OIDC）— 推荐

无需任何令牌：npm 通过 GitHub Actions 的 OIDC 身份校验"这次发布确实来自本仓库的这个工作流"。

### 一次性配置

1. 打开 https://www.npmjs.com/package/dsh-chat-assistant/settings
2. 找到 **Trusted Publisher**（发布访问/受信发布者）→ 选 **GitHub Actions**
3. 填写：

   | 字段 | 值 |
   |---|---|
   | Organization or user | `serein4444` |
   | Repository | `dsh-chat-assistant` |
   | Workflow filename | `release.yml` |
   | Environment name | 留空 |
   | Allowed actions | 允许 `npm publish`（若表单有此列） |

4. 保存。

### 每次发版

```sh
# 1. 提版本号（语义化版本）
#    编辑 package.json 的 version，例如 1.1.0

# 2. 提交
git add -A
git commit -m "chore: release 1.1.0"

# 3. 打 tag 并推送（tag 必须与 version 一致，工作流会校验）
git tag v1.1.0
git push origin main --tags
```

工作流 [release.yml](../.github/workflows/release.yml) 会自动：

- 安装依赖 + 类型检查 + 校验 tag 与 `package.json` 版本一致；
- `npm publish --provenance`（带 GitHub 来源证明，npm 页面显示"Built and signed on GitHub Actions"）；
- `pnpm pack` 并把 tarball 挂到同名 GitHub Release（Release 说明自动生成）。

## 2. 首次发布 / 手动兜底（不推荐长期使用）

包首次发布时还没有 Trusted Publisher 可配，只能用一次性令牌：

1. https://www.npmjs.com/settings/<用户名>/tokens → Generate New Token → **Granular Access Token**
2. 勾选 **Bypass two-factor authentication**，Permissions 选 **Read and write (publish and stage)**，Packages 选 **All packages**
3. 本地发布：

   ```sh
   npm publish --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken=npm_xxxx
   ```

4. **发布后立刻删除该令牌**。

> npm 正在收紧绕过 2FA 的令牌（见 GitHub Changelog：2026-07-08 GAT bypass2fa 弃用、2026-07-31 限制 bypass-2FA GAT），该通道仅作兜底。

## 本地校验

```sh
cd chat-assistant
pnpm install
pnpm run typecheck      # 必须通过
pnpm pack               # 产物：dsh-chat-assistant-<版本>.tgz
```

发布前确认：

- `package.json` 的 `version` 与要打的 tag 一致；
- README 面向使用者、内容与当前行为一致；
- tarball 内**不含** `node_modules`、`*.tgz`、任何令牌或本地路径。
