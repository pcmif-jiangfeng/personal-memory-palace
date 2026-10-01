# Task12G3 — Memory optimistic lock

完成日期：2026-09-27。本阶段保护 Memory 基本信息（标题、Original Story、所属章节）的保存；不进入 G4 / G5，不新增审计。

## 修改文件与设计

- `src/data/schema.ts`、`src/data/migrations.ts`：迁移 18 增加 Memory `version`，默认 1、非空且至少 1。旧记录保留原内容，迁移可重复执行。
- `src/domain/models.ts`、`src/data/memory-repository.ts`：Memory 列表、详情、新建结果返回版本。
- `src/http/schemas.ts`、`src/data/scoped-memory.ts`：基本信息保存必须携带正的安全整数版本；权限仍先在服务端验证，客户端不能省略版本绕过保护。
- `src/data/management-repository.ts`：SQL 在同一 UPDATE 中检查旧版本、写入内容并递增版本，未匹配返回 `MEMORY_VERSION_CONFLICT` / HTTP 409。内容、版本、作者写入在现有事务内执行，任何后续失败都回滚。
- `src/data/scoped-memory.ts`、`src/data/scoped-share.ts`：其他已有的 scoped Memory / Share 修改递增 Memory 版本，使旧基本信息草稿能发现数据已变化；这些操作本阶段不增加各自的冲突协议。照片、关系、封面、排序的冲突保护仍属于 G5。
- `src/app/api/memories/[id]/route.ts`、`src/client/memory-api.ts`：基本信息保存成功返回新版本，客户端验证后使用。
- `src/components/memory-management.tsx`、`src/i18n/zh-CN.ts`：草稿保持其加载版本，不能因其他控件刷新页面数据而静默升级。冲突提示保留草稿，不自动重试。重新加载前确认草稿丢弃；成功保存仅更新本次草稿版本。
- `tests/memory-version.test.ts`：新增迁移、双用户冲突、失败原子回滚、输入版本校验测试。
- `tests/scoped-memory.test.ts`、`tests/cross-museum-security.test.ts`、`tests/memory-attribution.test.ts`：既有请求补充版本，保持原验证意图。
- `tests/database.test.ts`、`tests/key-object-attribution.test.ts`：更新迁移版本与旧数据库夹具。
- `scripts/verify-memory-scope.mjs`：加入真实 HTTP 和双用户 Chrome 的冲突、草稿保留、取消/确认加载、加载后再次保存验收。

## 验证结果

- 新测试在实现前失败，实现后通过。
- `pnpm check`：228 项测试全部通过，typecheck、lint、format check 通过。
- `pnpm build`：通过。
- HTTP：两人读取 version 5，Owner 保存返回 version 6，协作者提交 version 5 返回 409；内容、版本和作者保持 Owner 保存的结果。
- Chrome：独立 Owner / Collaborator 会话同时打开 Memory；旧页面保存冲突，输入框仍保留草稿且显示明确提示。取消重新加载保留草稿，确认重新加载显示最新内容，再次保存成功。
- 既有上传、选图创建 Memory、Stage 编辑、Museum 导航、跨 Museum / 撤权 / Share 生命周期回归通过。
- 浏览器无意外 page/console errors。冲突请求会产生预期 HTTP 409 的浏览器资源错误，验收明确识别该条错误而非忽略其他错误。
- 最后补充的归属故障回滚断言与浏览器恢复流程通过针对性测试；本阶段截图已检查并清理。
- `git diff --check`：通过。

## 审查与交付边界

未发现本阶段阻断问题。复用现有 SQLite 事务、服务端权限、错误协议和辅助文字样式；无新依赖或无关重构。基本信息保存接口现在要求版本，旧页面需要重新加载。原有仅供可信内部调用的低层无版本入口保留，仍递增版本；它不是公网保存入口。

Stage / Museum settings 及关系类对象的独立冲突保护仍按 G4 / G5 分阶段实现。未推送、部署或执行生产数据迁移。隔离验收服务器和数据已清理；G3 满足当前验收，停止。
