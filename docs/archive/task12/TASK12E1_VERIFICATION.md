# Task 12E1 — MuseumMembership Schema

## 模型

`museum_memberships` 表记录 User 与 Museum 的协作者关系。

- `(museum_id, user_id)` 是联合主键：同一用户在同一馆只能有一条关系，撤销后也不能重复插入。
- `role` 仅允许 `collaborator`，默认值相同。Owner 身份仍由 `museums.owner_id` 决定，不依赖成员表，不自动生成 Owner 成员记录。
- `status` 仅允许 `active`（有效关系）或 `revoked`（已撤销关系），默认 `active`。重新加入应更新同一条关系，而非新增重复记录。
- `created_at`、`updated_at` 必填，由后续写入逻辑负责维护。
- 外键要求 Museum/User 存在；真正删除 Museum/User 时自动清理其关系，不删除馆内内容或其他成员。
- 联合主键支持按馆查询，`(user_id,status)` 索引支持按用户与状态查询。
- 本阶段仅保存关系，不接入任何访问控制，因此 active 成员记录本身尚不授予权限。

## 实现范围

- `src/data/museum-membership-schema.ts`：集中定义成员表与索引SQL，使全新初始化和已有数据库迁移使用相同约束。
- `src/data/schema.ts`：接入新模型。
- `src/data/migrations.ts`：新增事务迁移14；不改写以前的迁移。
- `tests/museum-membership-schema.test.ts`：新增3项模型及迁移测试。
- `tests/database.test.ts`：更新新增表及迁移版本的明确断言。

没有 Invite、Switcher、Permission API、成员创建接口或UI；没有修改现有Owner授权逻辑。

## 验证结果（2026-09-26）

- 红绿测试：实现前3项测试因缺少表失败；实现后全部通过。
- 默认角色/状态、重复及撤销后重复、非法角色/状态、非空约束、缺失外键、删除User/Museum的关系清理均通过。
- 已有数据库升级、迁移重复执行、迁移版本只记录一次、已有Museum数据保持不变均通过。
- `pnpm check`：162项测试全部通过，typecheck、lint、format检查通过。
- `pnpm build`：生产构建通过。
- 数据库运行时验证使用隔离测试数据库。本阶段无页面改动，不做全量浏览器验收或生产部署。
- 根据增量实现、测试驱动、安全及代码质量技能完成自查；没有发现阻断问题，没有新增依赖。

## 后续范围

成员邀请、加入/撤销流程、切馆与权限判定留给各自后续Task。本阶段已满足12E1要求并停止；未提交、推送或部署。
