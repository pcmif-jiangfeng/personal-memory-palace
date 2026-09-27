# Task 12F2 — Memory Scope 进度

## 最终状态（2026-09-27）

F2 的 Memory API scope 已完成，以下增量记录仅保留为历史，不再代表当前待办。完整交付与验证见 `TASK12F2_VERIFICATION.md`。Stage、Photo/Upload/Workspace、独立照片库、私有媒体及 Share 的完整多馆隔离仍属于后续阶段，不能据此宣称整个 Task 12 已完成。

## 已确认的产品权限

2026-09-26 用户选择第三种规则：Collaborator 可以创建、编辑、移入回收站和恢复 Memory；永久删除仅限 Owner。Visitor 分享访问仍为只读，不等同于 Collaborator。

## 本次完成的增量

- `src/data/memory-access.ts`：复用 F1 Museum 授权，按 Museum ID 和 Memory ID 联合查询；普通操作要求未进入回收站，恢复和永久删除要求已进入回收站；永久删除额外要求 Owner。
- `tests/memory-access.test.ts`：真实 SQLite 测试，覆盖协作者权限、跨馆/未知/无归属/注入 ID、回收站状态、成员撤销和 pending_deletion Museum。

非成员及已撤销成员使用 F1 的不泄露错误；有馆访问资格但 Memory 不属于该馆时统一 MEMORY_NOT_FOUND。跨馆永久删除先拒绝资源访问，不泄露其角色或状态。写入调用必须在同一事务中完成授权和业务修改，不能将返回上下文作为长期许可。

## 验证

- RED：新增测试因目标模块不存在失败。
- GREEN：3 项新增测试全部通过。
- `pnpm check`：类型检查、lint、187 项测试和格式检查全部通过。
- `pnpm build`：生产构建通过。
- 代码质量自查：复用现有 Museum 授权，无新增依赖或迁移；SQL 参数绑定；资源状态和 Owner 限制按确认规则检查。

## 未完成，不能视为 12F2 验收通过

已接入新的 Museum 创建 API，但旧 Memory API 和页面尚未切换，完整隔离未完成。

后续仍需：

1. 将旧创建入口和客户端切换到 Museum 作用域；新创建 API 已完成归属检查和写入，旧入口暂时保留。
2. 单条 Memory 修改与回收站 Memory 批处理接入上述权限；授权与写入同事务，避免现有仓库函数嵌套 BEGIN。
3. 读取入口、列表、搜索和随机回忆接入 Museum scope；保留既有只读分享契约。
4. User session 与旧馆长认证切换的调用链验证，避免界面仍发旧认证请求而无法编辑。
5. 完成 API 运行时跨馆读写、永久删除 Owner 限制和原功能回归验收。

Stage/Photo 的独立 API 隔离不在本次范围。未修改真实数据，未提交、推送或部署。

## 第二次增量：Museum 创建 API

- 新增 `POST /api/museums/[id]/memories`，从可信 User session 获取 userId，路径提供目标 Museum；客户端 body 的 userId 无效。
- `createMemoryInDatabase` 的 scoped 调用在现有 BEGIN IMMEDIATE 事务中检查当前 membership 和 active Museum，以及 Photo、Stage、相关 Memory 的同馆归属。
- scoped 创建写入 memories、memory_images、memory_relations 的 museum_id；外馆绑定失败时无部分 Memory/图片记录，也不修改照片 used_at。
- 非 scoped 调用保留现有内部及旧入口行为，供后续统一切换；这不是已经完成隔离的声明。
- 新增 `tests/memory-create-scope.test.ts` 3 项；同源检查测试增加新路由的 session 来源约束。
- RED 正确复现缺失归属和外馆绑定未拒绝；实现后局部 6 项通过。`pnpm check` 的 190 项测试、类型/lint/格式全部通过；`pnpm build` 通过。
- 隔离 SQLite + 生产启动 + 真实 HTTP 验证：匿名401、非成员404、跨站403、协作者201、持久化同馆归属、退出后404；未使用真实数据和账号，临时服务/数据/脚本已清理。
- 自查：授权与归属检查在写事务内，无异步间隙；SQL 参数绑定，无新依赖/迁移。未替换旧入口，避免当前客户端与读取链路尚未切换时造成半迁移；旧入口残留是 12F2 必须继续处理的验收阻塞项。
