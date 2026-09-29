# Task 12H1 — AuditLog Schema + Writer 验收记录

## 完成范围

只建立审计基础设施，不接入 Memory、Stage、Photo、邀请、成员或删除操作，不添加审计页面或公开写入 API。已有页面、分享和业务操作行为不变。之前 G5 的未提交改动保留。

主要代码文件：

- `src/data/audit-log-schema.ts`：共用表结构和索引。
- `src/data/audit-log.ts`：内部写入入口 `writeAuditLogInDatabase`。
- `src/data/schema.ts`：新数据库加载审计表。
- `src/data/migrations.ts`：追加 migration 20，不修改历史迁移。

验证文件：`tests/audit-log.test.ts`、`tests/database.test.ts`，以及本文。

## 数据和调用契约

`audit_logs` 保存 `id`、`actor_user_id`、`museum_id`、`action`、`object_type`、`object_id`、`timestamp`、可选 JSON `diff`。时间由服务器生成，ID 为 UUID。提供按博物馆时间及博物馆/对象时间查询的索引。

写入时 actor、museum 和对象标识必须非空；actor、museum 必须存在。对象标识不设置目标外键，以便目标删除后仍可保留事件。用户删除后 actor 外键置空，但事件保留；博物馆外键采用 RESTRICT，未来永久删除流程必须明确清理其审计记录。

diff 仅接受普通 JSON 对象及其 JSON 值，拒绝循环引用、非有限数字、undefined、BigInt、Date、Map 等可能无法保存或静默改变的数据。没有 diff 时保存 SQL NULL。所有写入使用参数绑定。

这是可信服务端的底层入口，不是授权入口：调用者必须从已验证会话获得 actor，并完成博物馆授权，不能直接转发浏览器提供的身份。diff 必须由业务代码显式挑选，不自动采集请求、密码、Cookie、令牌等敏感数据。本步尚无业务调用，普通网站操作不会自动产生记录。

写入入口不启动或提交独立事务。后续业务在现有 `withTransaction` 中传入同一数据库连接，可使内容和审计记录共同提交或回滚；写入失败必须传播，不应被业务忽略。

## 验证结果

- 局部 `tests/audit-log.test.ts` + `tests/database.test.ts`：14 项通过。
- 审查修正非 JSON 对象序列化后，审计专项 6 项通过。
- 最终 `pnpm check`：类型检查、lint、247 项测试、格式检查通过。
- `git diff --check`：通过。
- migration 20 在隔离数据库重复执行仅记录一次，已有记忆内容保留，外键检查通过。
- 覆盖无 diff、嵌套 diff、参数绑定、非法字段/身份、非法 diff、业务/审计失败共同回滚、成功共同提交、删除 actor 保留记录。

按 Task12 小循环规则未运行全站浏览器回归或生产构建；没有提交、推送、部署或访问生产数据库。

## 人工验收路径

1. 使用隔离测试数据库，不直接操作正式站数据；运行 `node --experimental-strip-types --test tests/audit-log.test.ts tests/database.test.ts`，确认全部通过。
2. 查看 `audit-log-schema.ts`，确认指定的 actor、museum、action、对象、timestamp、diff 字段及两组带 museum 的索引存在。
3. 查看专项测试第一项：迁移前已有记忆，重复执行迁移后内容不变，版本 20 只记录一次。
4. 查看写入和非法输入测试：确认普通记录与差异记录正确保存，未知身份及非法 JSON 不产生半条记录。
5. 查看事务测试：业务异常或审计写入异常时，博物馆修改和审计记录一起回滚；成功时一起提交。
6. 确认未新增审计页面、按钮、路由或业务接入；H2 需要在本步验收后另行执行。

## Rollback Plan

1. migration 20 只增加 `audit_logs` 及索引，不修改旧表和业务数据；结构上可以移除新增表及版本 20 的迁移记录。当前没有自动 down migration。
2. 推荐回滚代码至 H1 前、migration 19 的基线，保留新增表和迁移记录即可。旧代码不会访问此表，不必为了回滚代码删除审计数据。
3. 若必须撤销结构，先停用会写审计的新代码，在隔离环境验证并备份 SQLite，再在事务内移除审计表和版本 20 记录。删表会永久删除全部已写入审计事件；只有备份或导出可恢复。本文不实际执行删除。
4. H1 的保留表代码回滚不需要恢复 SQLite backup；若误删审计记录或迁移失败造成额外损坏，才按已验证备份恢复流程处理，避免覆盖备份后新增的业务数据。
5. H1 不操作图片文件，不需要恢复 Photo directory。
6. 此兼容结论仅针对 H1 前的 migration 19 / G5 基线，不代表多用户迁移之前的旧发布版本也兼容。

## 代码质量审查与限制

按 `code-review-and-quality` 检查正确性、可读性、模块边界、安全与性能。修复非 JSON 对象可能静默改变 diff 的问题，并新增回归用例；复查无阻断问题。沿用现有 schema 共用方式和事务模式，无新增依赖，没有顺手重构。

没有审计列表查询/UI、业务集成、字段脱敏策略或防篡改机制；这些不是 H1 已完成的能力。actor 删除后不保存姓名快照，显示历史身份时需明确处理空 actor。授权及允许记录哪些 diff 字段需由后续业务集成实现。

本步完成后 STOP，等待人工验收，不自动进入 H2。
