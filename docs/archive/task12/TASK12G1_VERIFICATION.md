# Task12G1 — Memory 创建者 / 最后编辑者

完成日期：2026-09-27。仅完成 G1，不包含 Audit、Stage attribution 或 optimistic locking。

## 实现

- `src/data/schema.ts`、`src/data/migrations.ts`：增加两个 nullable User 外键，迁移版本 16；历史记录不推测作者，迁移可重复执行。
- `src/domain/models.ts`、`src/data/memory-repository.ts`：返回创建者、最后编辑者 ID 和当前 display name；沿用现有查询，通过 JOIN 解析名字，不额外逐条查询，也不展示邮箱。
- `src/data/memory-write-repository.ts`：新 Memory 的创建者和最后编辑者都取自服务端已验证的登录 User。
- `src/data/scoped-memory.ts`、`src/data/scoped-share.ts`：明确的 Memory 修改与最后编辑者写入在同一事务中执行。创建者不变，失败或无权限请求不改写归属。
- `src/components/memory-attribution.tsx`、`src/components/memory-exhibition.tsx`、`src/app/memories/[id]/page.tsx`：复用现有辅助文字样式显示作者；历史记录显示“创建者未记录 / 最后编辑者未记录”。
- `tests/memory-attribution.test.ts`：创建、跨用户编辑、失败、撤权、分享配置和迁移回归测试。
- `tests/database.test.ts`、`tests/museum-secondary-relations.test.ts`：更新迁移版本断言、补齐旧迁移测试夹具所需的核心表。
- `scripts/verify-memory-scope.mjs`：加入 HTTP 作者伪造、浏览器新建/编辑显示及分享访客显示断言。

## 行为边界

ID 来自服务端 scope，客户端提交同名字段不会覆盖它。只存当前最后编辑者，不生成编辑历史。名字跟随 User 当前 display name；删除 User 时外键置空。无明确 User 的旧内部入口、历史记录和系统级关联变更不猜测归属；本阶段不为 Stage 操作新增 actor 字段。不改变已有 `updated_at` 语义。

## 验证

- 新增归属测试先失败、实现后通过。
- `pnpm check`：通过，222 项测试全部通过，typecheck、lint、format check 通过。
- `pnpm build`：通过。
- 隔离临时数据库与会话启动生产服务器，通过 HTTP 与真实 Chrome 验证上传照片、选图创建 Memory、编辑 Memory、作者显示和既有 Museum / Share 安全矩阵；无浏览器 page/console errors。
- HTTP 创建 / 修改请求伪造 actor ID 被忽略；既有跨 Museum 与撤权拒绝请求保持领域数据快照不变。
- 分享访客页面显示未知历史创建者和真实最后编辑者；截图检查新增文字与原展厅布局一致。
- 代码质量自查：未发现本阶段阻断问题；参数化 SQL、事务原子性、React 文本转义和权限边界保持。无新增依赖、无无关重构。

## 交付边界

未提交、推送或部署；未对生产数据执行迁移。测试临时服务器、数据库及本次临时截图已清理。G1 满足验收，停止，不自动进入 G2。
