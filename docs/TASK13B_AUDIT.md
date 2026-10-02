# Task13B 实施前审计与迁移设计

日期：2026-10-01。用户已授权继续 13B；保留 13A 改动和原有任务文档，不提交或部署。

## 现状

1. User：唯一 `users` 表；email 为 COLLATE NOCASE UNIQUE，display_name 不唯一；密码 scrypt 哈希；email_verified 布尔值。复用现有字段，不另建用户表。
2. 登录：`/account/login` → `/api/user-auth`，错误提示通用；但未验证邮箱返回 403，不创建会话。注册已有昵称/邮箱/密码，需补确认密码及统一六位验证码。
3. Session：`memory_palace_user` HttpOnly Cookie，随机 32 字节令牌，数据库仅保存 SHA256 哈希，7 天有效，支持服务端撤销。复用该体系，增加受限状态识别。
4. 登录入口：正式邮箱密码 `/account/login`，旧馆长密码 `/login` → `/api/auth`。旧 `memory_palace_owner` 使用签名令牌；13B 必须停止接受该凭证并移除网站旧入口。
5. 旧身份：`src/auth.ts`、`src/security/owner-session.ts`、`MEMORY_PALACE_OWNER_PASSWORD`、首页/layout 导航控制及原迁移脚本使用。历史迁移密码不能继续作为线上特殊登录凭证。
6. Share：`share_configs` 通过 memory_id/museum_id 追溯 owner；安全随机 token，支持链接/密码模式与撤销。当前分享额外依赖 is_public，并通过完整详情函数获取关联记忆；需与普通公开读取解耦，仅投影被授权内容，显示馆长昵称而非邮箱。
7. 核心表：memories/stages/uploaded_photos，以及 memory_images/stage_covers/memory_relations/later_notes/share_configs/photo_deletion_jobs/pending_uploads。Trash 使用 trashed_at；Gallery 是照片与 Memory 的投影；未发现独立 Tag/Review/Export 业务表，不为这些概念新建功能。
8. 所有权：现有 `museum_id → museums.owner_id → users.id` 已能表达归属；必须保证父子资源同馆校验，普通私有访问仅限 owner。此前 active collaborator 权限与任务的新规则冲突，不能继续作为读取他人私人数据的旁路。
9. 历史迁移：复用既有归属与文件迁移，不重建/删除记录。已有 owner/Museum 绑定保持不变。只对未归属记录制定显式原馆长目标的事务性回填；部署前要求备份、dry-run、外键及计数检查。遇到一人多馆或来源不明，拒绝自动合并。migration 22 曾取消一人一馆约束；恢复前必须检查冲突，转移流程也不得制造第二个宫殿。
10. 邮件：统一 `sendTransactionalEmail` 调 Resend，已有配置校验与超时；验证/重置各有链接 token 表和发送包装。替换为统一 purpose=REGISTER/RESET_PASSWORD/CHANGE_PASSWORD 的代码能力，旧链接不再作为新登录路径使用。
11. 可复用：SQLite migration/transaction、User/session、scrypt、same-origin 校验、API error、requestJson、现有速率限制、表单/样式、Museum scope/access、Share token 和邮件 provider。
12. 预计文件：user-auth/user-repository、新增 email-code schema/service/tests、migrations、register/verify/resend/password-reset/account-password API 与表单；private page scope/account access、museum-access/onboarding/transfer、share-repository/share page/media/recall、auth/login/layout/header、迁移脚本与配置示例、验收报告。只按实际依赖修改。

## 本地只读审计

默认目录只有 `data/demo.sqlite`，未发现 `data/palace.sqlite`。demo 有 1 User/1 Museum、0 memberships；6 Memory、3 Stage、2 uploaded photo、1 Share 未归属。这是 demo 数据，不能把它自动当作线上原馆长历史数据；不能根据本地统计声称腾讯云已迁移或无冲突。

## 实施顺序与验收边界

1. 关闭匿名普通业务读取与旧身份入口，保留受控 Share。
2. 单用户单宫殿/owner 私有权限及可审查迁移。
3. 统一六位 EmailCode：10 分钟、60 秒冷却、替换失效、一次性、连续错误 5 次失效；哈希存储及安全随机生成。
4. 注册/受限会话/邮箱验证/找回与修改密码；修改密码保持当前设备会话。
5. 全量测试、类型/lint/build、真实浏览器安全场景。
6. 真正 QQ/163/126/Outlook/Gmail 投递须用户提供可检查收件地址，记录送达时间及垃圾箱；模拟发送和 HTTP 200 均不等于邮件实际送达。生产数据迁移同样需要腾讯云备份和 dry-run 结果。
