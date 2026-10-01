# Task12G2 — Stage / Museum settings attribution

完成日期：2026-09-27。仅完成 G2，不包含 Audit 或 optimistic locking。

## 修改与设计

- `src/data/schema.ts`、`src/data/migrations.ts`：迁移 17 给 Stage 增加 nullable `created_by_user_id` / `last_edited_by_user_id`，给 Museum 增加 nullable `last_edited_by_user_id`。外键删除时置空，历史记录不猜测作者，迁移幂等。
- `src/domain/models.ts`、`src/data/memory-repository.ts`：Stage 读取返回归属 ID 和当前 display name；复用现有统一 Stage 查询，避免 N+1，不返回邮箱。
- `src/data/scoped-stage.ts`：创建、详情、封面、公开状态、回收站与恢复操作使用服务端验证 scope 中的 User。创建者不变，业务修改与归属更新在同一事务里，永久删除不保留假记录。旧内部入口和 Demo 不猜测归属。
- `src/data/museum-repository.ts`、`src/data/museum-profile.ts`、`src/data/museum-slug.ts`：名称、简介、封面和地址设置改变时记录服务端登录 Owner；无变化或失败时不更新归属。现有 `ownerId` 仍是所有者，未将其推测为历史编辑者。Museum 新建不被标为“编辑设置”。
- `tests/key-object-attribution.test.ts`：新增 3 项集成测试，覆盖归属、权限、迁移、无变化、失败与原子回滚。
- `tests/database.test.ts`、`tests/memory-attribution.test.ts`、`tests/museum-secondary-relations.test.ts`、`tests/museum-ownership-migration.test.ts`：更新迁移断言和旧夹具；显式列名插入保持原有唯一性检查有效。
- `scripts/verify-memory-scope.mjs`：增加 Stage 创建/编辑及 Museum 设置的 HTTP actor 伪造断言。页面布局和交互不变，本阶段不新增追溯管理界面。

## 验证

- 新归属测试先失败，实现后通过。
- `pnpm check`：225 项测试全部通过；类型、lint、格式检查通过。
- `pnpm build`：通过。
- 隔离数据启动生产服务器，通过真实 HTTP 验证：客户端伪造作者字段被忽略，Stage 创建者保持不变，Owner 编辑和 Museum 设置记录真实 User。
- 真实 Chrome 验证上传、选图创建 Memory、Memory/Stage 编辑和 Museum 导航；无 page/console errors。既有跨 Museum、撤权、Share 生命周期安全矩阵通过。
- 归属更新触发故障时，Stage 标题和编辑者一起回滚；无权限和校验失败不会改写归属。
- `git diff --check`：通过。

## 审查与范围

未发现本阶段正确性、安全、数据完整性或回归阻断问题。使用参数化 SQL 和现有事务/权限边界，新增读取为索引 JOIN，无新依赖或泛化架构。Museum 原有 version 增量行为保持，没有新增版本冲突检查。

未推送或部署，未修改生产数据；临时验收数据和服务器由脚本清理。G2 满足当前任务，停止，不自动进入 G3。
