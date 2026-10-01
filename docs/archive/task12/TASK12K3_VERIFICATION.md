# Task12K3 — 协作事务邮件自检报告

日期：2026-09-30。结论：代码验收通过；真实收件与线上调度待部署后验收。

## 修改与设计

- `src/data/museum-notifications.ts`、`src/data/migrations.ts`：新增 migration 24 通知表。业务事件、审计和待发送通知一同提交；只保存相关馆元数据与通知内容，不保存 Story、照片、密码或邀请 token。
- `src/data/invite-acceptance.ts`、`museum-leave.ts`、`museum-collaborators.ts`、`museum-owner-transfer.ts`：实际状态变化通知当前馆主与当事人；转移通知新旧馆主；幂等重试不制造重复事件。
- `src/email/museum-notifications.ts`、`after-museum-notifications.ts`：复用原邮件发送器、HTML 转义、短时领取锁、失败退避重试、稳定发送幂等键；响应后尝试发送，不阻塞业务响应。
- 四个协作 API Route：业务提交后安排通知；原响应格式与授权语义保持不变。
- `scripts/send-museum-notifications.ts`、`package.json`、`Dockerfile`：提供通知补发入口，容器包含维护脚本。
- `tests/museum-notifications.test.ts`、`tests/database.test.ts`、`tests/same-origin.test.ts`、`scripts/verify-museum-notifications.mjs`：新增行为验收，同步新增表 / 迁移清单，保留身份与同源检查。
- 未修改账号邮件或删除邮件功能。

## 验证

- 7 项新测试通过；全量 `pnpm check` 389 项测试通过，类型 / lint / 格式通过。
- 隔离数据目录的生产构建通过。
- 生产服务启动与 HTTP 验收通过：拒绝未登录 / 跨站 / 无权限操作，四种协作动作产生正确收件人，重复请求不重复通知，未配置发送时保留待发记录，模拟邮件服务成功补发 12 条。
- 覆盖迁移升级与幂等、通知写入失败业务整体回滚、发送失败不回滚业务、并发领取、过期领取锁恢复、HTML 转义与发送后不重复。
- 审查未发现阻止交付的问题；无新第三方依赖。没有向真实邮箱发送邮件，没有迁移真实用户数据库。
- 自我修正记录：源码安全断言原先仅接受内联数据库获取；更新为允许已验证来源的变量。旧数据库表 / 迁移清单同步更新；迁移测试改为 finally 关闭连接，避免断言失败时遮盖原错误。

## 运维与边界

- 继续使用 `RESEND_API_KEY` 与 `MEMORY_PALACE_EMAIL_FROM`。未配置时业务正常提交，通知保持待发。
- 本地仓库：`pnpm emails:send`；容器：`docker exec personal-memory-palace node --experimental-strip-types maintenance/send-museum-notifications.ts`。
- 部署后需由服务器定时任务每分钟调用维护脚本；此处提供入口，未擅自修改服务器或创建调度。失败输出只含数量，不含收件地址或密钥。
- 提供至少一次可恢复发送，不承诺无限期严格 exactly-once。Resend 的发送幂等键有效期为 24 小时，跨该窗口的模糊失败存在重复收件可能。[官方说明](https://resend.com/docs/dashboard/emails/idempotency-keys)。发件配置在处理同批重试期间应保持稳定。
- 已发送不代表真实邮箱收件，送达 / 退信仍需后续验收。生产邮件配额与调度未验证。

## 回滚

新增表的加法迁移不改原业务表。未对真实数据库执行；上线前备份 SQLite。回退旧应用可保留新增表和 migration 24，不需要删表、删除记录或回滚协作关系；回退期间停止通知维护任务，保留待发记录。
