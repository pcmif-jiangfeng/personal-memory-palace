# Task12G4 — Stage / Museum Profile optimistic lock

完成日期：2026-09-27。仅完成 G4，不自动进入 G5，不增加审计系统。

## 修改总结

- `src/data/schema.ts`、`src/data/migrations.ts`：迁移 19 给 Stage 增加非空、默认 1 的 version；旧章节内容不变，迁移幂等。Museum 沿用现有 version。
- `src/domain/models.ts`、`src/data/memory-repository.ts`：Stage 读取返回版本。
- `src/data/stage-repository.ts`、`src/data/scoped-stage.ts`：Stage 编辑在同一 SQL 中检查版本并递增；冲突返回 `STAGE_VERSION_CONFLICT` / 409。标题、简介、当前表单封面及 actor 在事务中执行，失败全部回滚。公开状态、回收站与恢复递增版本，以使旧编辑草稿识别变化。
- `src/http/schemas.ts`、`src/app/api/stages/[id]/route.ts`：Stage 编辑要求正的安全整数 version；新建 Stage 不要求 version。
- `src/data/museum-profile.ts`、`src/http/museum-profile.ts`：Museum Profile 保存要求加载版本；即使旧值等于当前值，也先检查版本。无变化且版本匹配时维持原有不写入行为。实际更新使用 owner / version 条件并在现有事务内完成。
- `src/app/api/museums/route.ts`：Profile 保存成功返回 version。Museum 地址修改保持现有独立流程及版本递增；该变更会使旧 Profile 草稿冲突。
- `src/client/stage-api.ts`：编辑提交版本并验证返回的新版本。
- `src/components/stage-manager.tsx`：每份 Stage 草稿保留其加载版本，不因其他章节保存或页面数据刷新而升级；成功保存更新该草稿版本，冲突保留未保存输入。
- `src/components/museum-profile-form.tsx`、`src/app/account/page.tsx`：Profile 草稿携带加载版本；成功保存更新版本，冲突保留草稿，确认后重新加载。
- `src/i18n/zh-CN.ts`、`src/styles/forms.css`：增加中文冲突提示，复用 G3 加载确认；Stage 深色提示条内新按钮沿用浅色文本，保持可读。
- `tests/stage-profile-version.test.ts`：4 项新增测试覆盖迁移、版本校验、冲突、封面保护及后续归属写入故障回滚。
- `tests/database.test.ts`、`tests/memory-version.test.ts`、`tests/scoped-stage.test.ts`、`tests/key-object-attribution.test.ts`、`tests/museum-profile.test.ts`：更新相关迁移夹具和保存版本，保留原安全及归属断言。
- `scripts/verify-memory-scope.mjs`：增加 Stage / Profile HTTP 冲突与数据不变断言、真实浏览器冲突、草稿保留、确认加载及连续保存验收。

## 验证结果

- 新冲突测试先失败，实现后通过。
- 最终 `pnpm check`：232 项测试全部通过；typecheck、lint、format check 通过。
- 最终 `pnpm build`：通过；隔离临时生产服务器成功启动。
- HTTP：Stage 旧版本和 Museum Profile 旧版本返回 409，数据及归属不改变；原有跨 Museum、撤权、Share 生命周期与上传安全矩阵通过。
- Chrome：Stage / Museum Profile 冲突时原草稿仍在，显示明确提示；确认加载最新内容后连续保存两次均成功。Memory 的既有冲突及上传、新建、编辑流程继续通过。
- 浏览器无意外 page / console errors；冲突产生的预期 HTTP 409 资源消息单独验证，不吞掉其他错误。
- Stage 冲突不会更换当前封面；后续 actor 写入故障使内容与版本一起回滚。
- 截图检查通过，修正 Stage 重新加载按钮在深色提示条中的文字颜色。临时截图已清理。
- `git diff --check`：通过。

## 审查与范围

代码质量审查未发现本阶段阻断问题。沿用原有 SQLite 事务、服务端权限、请求与错误协议；没有新依赖、通用锁系统或无关重构。Stage 的可信内部低层入口保持兼容并递增版本；公网编辑必须提交版本。Profile 的 Owner-only 权限没有扩大。

本阶段接口增加版本要求，旧编辑页面需要重新加载。未推送、部署或对生产数据执行迁移。测试服务器和数据由隔离验收脚本清理；G4 完成，停止。
