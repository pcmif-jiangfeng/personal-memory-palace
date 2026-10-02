# Task13B 上线前操作与真实验收

本文件是操作说明，不表示腾讯云已执行。2026-10-02 代码与说明提交到 GitHub，不代表已部署到腾讯云；生产数据未修改。代码验证使用隔离数据库和模拟投递。

## 历史数据迁移

使用 Node 24，在**包含此次代码的目录**运行。先在完整生产备份的恢复副本上演练，之后才能考虑停写迁移。不要先启动新网站：migration 28 遇到历史一人多馆会拒绝启动，不会自动合并或删除。

原馆长必须是现有已验证 User，且已有且仅有一个 active Museum。指定原馆长邮箱（历史确认的邮箱是 `jiangfengchoumian@gmail.com`，仍需以生产只读审计确认）。脚本不创建替代账号、不改密码、不自动采用 demo 数据。

只读预演（`<恢复副本的数据目录>` 中需有 palace.sqlite 和 images/uploads）：

```bash
node --experimental-strip-types scripts/migrate-task13-owner.ts <恢复副本的数据目录> jiangfengchoumian@gmail.com
```

输出应为 `mode: dry-run`、before/after 所有表计数一致、missingFiles 为 0。原始数据库未修改。发现以下情况立即停止：多馆冲突、跨 owner 父子关联或作者、未知的可空所有权表、缺失/不安全图片、未完成上传/删除工作。

完成审计和恢复演练后，停止**网站和所有维护写入进程**。确认已有且位于数据目录外的备份目录；提供配置文件，以便一并备份。正式回填需显式确认邮箱：

```bash
node --experimental-strip-types scripts/migrate-task13-owner.ts /opt/personal-memory-palace/data jiangfengchoumian@gmail.com --apply --quiesced --confirm=jiangfengchoumian@gmail.com --backup-root=/opt/personal-memory-palace/backups --config-file=/opt/personal-memory-palace/config/app.env
```

以上命令仅适用于该代码可访问这些路径的运行环境；Docker 内路径须按实际挂载修改，不要原样混用宿主机与容器路径。

脚本先在临时数据库预演，再备份、独立恢复校验，最后事务性回填和运行数据库迁移。备份期间任何受审计内容变更都拒绝写入。只修改 NULL museum_id；User/密码、已有 Museum 归属、ID、正文、回收站、关系、分享 token 和文件不重建、不删除。

照片仍使用 `uploads/owner/...` 时，继续复用既有文件命名空间迁移。它保留旧文件、校验新旧文件哈希、事务性修改引用。先预演，再在停写状态执行；两步均成功后才启动新版本：

```bash
node --experimental-strip-types scripts/migrate-photo-storage.ts /opt/personal-memory-palace/data
node --experimental-strip-types scripts/migrate-photo-storage.ts /opt/personal-memory-palace/data /opt/personal-memory-palace/backups --apply --quiesced
```

不得为了消除报错清空 pending_uploads、photo_deletion_jobs、成员表或业务数据。须使用现有恢复入口修复真实文件操作，不能只删除日志。多馆归属冲突必须逐项人工决定，当前脚本不提供自动合并。

### 回退

保留脚本输出的迁移前备份与旧镜像。恢复到一个新的空目录，不覆盖正在使用的数据：

```bash
node scripts/restore-backup.mjs <迁移前备份目录> <新的空恢复目录>
```

恢复检查成功后，再停写切换到恢复目录与旧版本，保留失败现场。不可只换旧镜像而继续使用已经迁移的数据。自动测试已验证备份可恢复、原数据/图片一致；这不是生产恢复演练的替代。

## 邮件真实收件验收

保持现有服务端配置 `RESEND_API_KEY`、`MEMORY_PALACE_EMAIL_FROM`，不在网页或 Git 中保存密钥。须提供自己控制的 QQ/163/126/Outlook/Gmail 测试收件地址；不需要邮箱密码。最多五封，显式 `--send` 才发送：

```bash
node --env-file=.env.local --experimental-strip-types scripts/test-email-delivery.ts --send <你的QQ邮箱> <你的163邮箱> <你的126邮箱> <你的Outlook邮箱> <你的Gmail邮箱>
```

也可仅提供已有的部分地址，缺失邮箱类型保留待验收。脚本复用正式验证码模板；测试码不绑定账号、不能用于验证或登录。控制台只记录域名、发送/接受时间和安全的 request/message ID，不打印 API Key、完整收件地址或验证码。

`accepted` **只代表供应商接收请求**。去对应邮箱检查收件箱及垃圾箱，按实际观察填写下表；供应商显示 Delivered 也不等于用户看到邮件。先完成五类投递，再分别人工操作注册验证、忘记密码、修改密码，确认正式验证码也可收到和使用。

| 邮箱类型 | 实际到达 | 收到时间/耗时 | 是否垃圾邮件 | 六位验证码可读 |
| --- | --- | --- | --- | --- |
| QQ | 待验收 | 待记录 | 待检查 | 待检查 |
| 163 | 待验收 | 待记录 | 待检查 | 待检查 |
| 126 | 待验收 | 待记录 | 待检查 | 待检查 |
| Outlook | 待验收 | 待记录 | 待检查 | 待检查 |
| Gmail | 待验收 | 待记录 | 待检查 | 待检查 |

失败时用服务端 `[email-delivery]` 的 status、providerCode、requestId（以及存在且合法的 providerRequestId）定位，不把供应商原始文本、邮件正文、验证码、凭证或栈返回给用户。

## 已退役代码

5 个无引用的旧表单按用户确认删除，可从 Git 历史恢复。旧登录和链接邮件 API 仅保留退役响应；正式入口统一 EmailCode。历史 owner-session、链接 token 数据与离线维护测试保留，不被在线认证使用，暂不删除历史表或数据。
