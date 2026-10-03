# 发布流程（维护者）

工作流 [release.yml](../.github/workflows/release.yml) 支持两条通道，按仓库是否配置了 `NPM_TOKEN` 密钥自动选择。

## 通道 A：npm Trusted Publishing（OIDC）— 最优

无需任何令牌：npm 通过 GitHub Actions 的 OIDC 身份校验"这次发布确实来自本仓库的这个工作流"。

### 一次性配置

1. 打开 https://www.npmjs.com/package/dsh-chat-assistant/settings
2. 找到 **Trusted Publisher**（受信发布者）→ 选 **GitHub Actions**
3. 填写：

   | 字段 | 值 |
   |---|---|
   | Organization or user | `serein4444` |
   | Repository | `dsh-chat-assistant` |
   | Workflow filename | `release.yml` |
   | Environment name | 留空 |
   | Allowed actions | `npm publish`（若表单有此列） |

4. 保存（该操作需要一次 2FA 断言；无通行密钥/硬件密钥时可能无法完成，改用通道 B）。

## 通道 B：仓库密钥里的 npm 令牌 — 兜底（无需 2FA 交互）

适用于无法完成 2FA 断言的环境：npm 创建"绕过 2FA"的细粒度令牌**不需要** 2FA 确认。

1. https://www.npmjs.com/settings/<用户名>/tokens → **Generate New Token** → Granular Access Token
2. 勾 **Bypass two-factor authentication**；Permissions = **Read and write (publish and stage)**；Packages = **All packages**；Expiration 选最长（**90 天**）
3. 生成后复制令牌（只显示一次）
4. 到 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**：
   - Name: `NPM_TOKEN`
   - Secret: 粘贴令牌
5. 此后工作流自动走该通道发布（不再带 provenance 证明）

> **轮换**：令牌最长 90 天。到期前重复第 1–4 步换一个新的即可。npm 正在收紧绕过 2FA 的令牌（GitHub Changelog 2026-07-08 / 2026-07-31），因此这是过渡方案；条件允许时建议配置通道 A 或添加一枚硬件安全密钥。

## 每次发版（两条通道通用）

```sh
# 1. 提版本号（语义化版本），编辑 package.json 的 version，例如 1.1.0

# 2. 提交
git add -A
git commit -m "chore: release 1.1.0"

# 3. 打 tag 并推送（tag 必须与 version 一致，工作流会校验）
git tag v1.1.0
git push origin main --tags
```

工作流会自动：安装依赖 → 类型检查 → 校验 tag 与版本一致 → 发布到 npm → `pnpm pack` 并把 tarball 挂到同名 GitHub Release（说明自动生成）。

## 本地手动发布（极端兜底）

```sh
npm publish --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken=npm_xxxx
```

发布后**立刻删除**该令牌。

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
