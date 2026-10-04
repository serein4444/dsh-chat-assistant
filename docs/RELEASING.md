# 发布流程（维护者）

> 文档分工：[`README.md`](../README.md) 面向使用者；本文只写**发版操作**；
> 账号、2FA、DSH 升级适配见工作区根目录的 `HANDOFF.md`（不在本仓库内）。
>
> 发布由 [.github/workflows/release.yml](../.github/workflows/release.yml) 自动完成，
> 走 **npm Trusted Publishing（OIDC）**：无需任何令牌。
> 注意：本包的发布策略已设为「禁用绕过 2FA 的令牌」——因此**绕过令牌的发布方式对本包无效**，
> 应急路径见文末「CI 不可用时」。

## 日常发版（标准流程）

```sh
# 1. 功能/修复已完成：更新 CHANGELOG.md 与 package.json 的 version（语义化版本）

# 2. 本地验证
pnpm run typecheck
pnpm pack          # 产物 dsh-chat-assistant-<版本>.tgz，可本地装一次冒烟

# 3. 提交并打 tag（tag 必须与 version 一致，工作流会校验）
git add -A && git commit -m "chore: release <版本>"
git tag v<版本>
git push origin main --tags
```

工作流自动完成：装依赖 → 类型检查 → 校验 tag 与版本一致 → `npm publish --provenance`
（npm 包页显示 "Built and signed on GitHub Actions"）→ `pnpm pack` 并把 tarball 挂到同名
GitHub Release（说明自动生成）。

发布后自检（防本机代理缓存假象）：带随机参数访问
`https://registry.npmjs.org/-/package/dsh-chat-assistant/dist-tags`，确认 `latest` 已是新版本。

## 发布前检查清单

- [ ] `CHANGELOG.md` 已补充本版本条目；
- [ ] `package.json` 的 `version` 已更新（与将要打的 tag 一致）；
- [ ] `pnpm run typecheck` 通过；
- [ ] README 的兼容性表与实际基线一致（DSH 版本变化时）；
- [ ] `pnpm pack` 抽查：tarball 内无 `node_modules`、无令牌、无本地路径。

## 应急：CI 不可用时的手动发布

包策略当前为「禁用绕过 2FA 的令牌」，因此**绕过令牌的手动发布对本包无效**。
若 Actions 短期不可用，两条应急路径：

1. **临时放宽**：包设置页（Publishing access）把策略临时切回
   「Require two-factor authentication or a granular access token with bypass 2fa enabled」
   → 按 npm 文档创建绕过 2FA 的细粒度令牌 → 本地
   `npm publish --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken=npm_xxxx`
   → **发布后立刻切回最严策略并撤销令牌**；
2. **等待 Actions 恢复（推荐）**：GitHub Actions 的故障通常是短暂的，历史运行可在
   Actions 页面查看并 Re-run failed jobs。

## 历史备注

早期发布（1.0.0 – 1.0.2）曾使用「绕过 2FA 的细粒度令牌」通道（写入仓库密钥 `NPM_TOKEN`，
工作流按密钥是否存在自动选择通道）。包策略切换为最严后该通道对本包失效，相关步骤仅作
历史参考；npm 亦在收紧绕过 2FA 的令牌（GitHub Changelog 2026-07-08 / 2026-07-31）。
