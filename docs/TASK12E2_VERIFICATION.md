# Task 12E2 — InviteLink Schema

完成日期：2026-09-26。本阶段仅实现邀请链接数据模型。

## 模型与语义

新增 `invite_links`：

- `id`：非空主键。
- `museum_id`：非空Museum外键；Museum真正删除时清理邀请记录。
- `token_hash`：唯一、非空的64位小写十六进制SHA-256摘要；没有明文邀请token字段。
- `use_mode`：`single-use` 或 `multi-use`，默认单次。
- `expires_at`：可空；null表示不设到期时间。
- `revoked_at`：可空；null表示未撤销，非null保存撤销时间。
- `usage_count`：非负整数，默认0。
- `max_uses`：正整数或null；单次必须为1，多次可设置正整数上限或null（不限次）。默认1，避免遗漏配置时意外创建不限次邀请。
- `created_at`：必填创建时间。
- 使用计数不能超过非空上限。按Museum/创建时间建立索引，token摘要唯一索引支持定位邀请。

数据库只存储以上状态，不自动判断过期、消费token或创建Membership。日期规范校验、过期/撤销拒绝、使用计数并发更新及安全随机token生成属于后续业务阶段，尚未实现。摘要格式约束不能证明写入方使用了安全随机token；后续必须通过安全随机方案生成原始凭证。

## 修改文件

- `src/data/invite-link-schema.ts`：邀请模型SQL。
- `src/data/schema.ts`：新数据库初始化接入。
- `src/data/migrations.ts`：新增事务迁移15，与初始化复用同一SQL，避免约束漂移。
- `tests/invite-link-schema.test.ts`：4项模型与迁移测试。
- `tests/database.test.ts`：更新新增表与迁移版本断言。

## 验证

- 实现前4项测试因缺少模型失败；实现后全部通过。
- 单次默认值、nullable时间、限次与不限次、负数/小数/超限计数、重复/非法摘要、非法模式、空主键、外键及Museum删除清理均通过。
- 迁移重复执行不会重复记录版本或清空邀请；已有Museum与真实测试成员关系完整保留。
- `pnpm check`：166项测试全部通过，typecheck、lint、格式检查通过。
- `pnpm build`：生产构建通过。
- 补强成员保留测试后，针对性测试、typecheck、lint再次通过。
- 使用增量实现、测试驱动、安全与代码质量技能自查，无阻断问题；无新增依赖、页面或接口。
- 测试使用隔离数据库；无真实邀请、邮件、成员创建业务、生产部署或浏览器全量验收。

已满足12E2范围。未实现Owner邀请管理、接受邀请UI或邮件；停止在本阶段。未提交、推送或部署。
