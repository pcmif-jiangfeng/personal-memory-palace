# 协作恢复：迁移、调度与回滚

适用于本地候选版本，目标 schema 36。未执行生产迁移、GitHub推送或腾讯云部署。先在生产备份的隔离副本执行以下流程，确认真实归属后再授权上线。

## 迁移前

1. 停止 web、邮件、上传、恢复、清理及其他所有数据库/文件写入者；`--quiesced`只是确认，不会自动停服务。
2. 运行只读清单：`node --experimental-strip-types scripts/audit-collaboration-migration.ts --database <data>/palace.sqlite`。结果含馆长邮箱，仅运维保存，不发布。
3. 解决未归属数据、未完成文件操作、数据库完整性问题。历史作者和旧昵称保持未知；历史待删除没有截止时间时不得猜测期限。
4. 多宫殿类型或账号额度不明时，明确映射。额度是账号统一额度，不求和旧馆额度。映射不能更改已经确立的宫殿类型或重置已分配额度。

映射文件结构：

```json
{"palaceTypes":{"<palace-id>":"shared"},"ownerQuotaBytes":{"<owner-user-id>":1073741824}}
```

没有需要显式映射的项目可以使用空对象。旧库尚无类型列时，一旦提供类型映射，必须覆盖全部宫殿；单一旧宫殿的无歧义默认由迁移保留。

## 副本与正式迁移

```sh
node --experimental-strip-types scripts/migrate-collaboration.ts <data-directory> <mapping.json>
node --experimental-strip-types scripts/migrate-collaboration.ts <data-directory> <mapping.json> --apply --quiesced --backup-root=<existing-external-backup-directory>
```

第一条只修改一次性副本，源文件保持不变。第二条要求外部备份目录，先创建备份，隔离恢复并比对完整数据库和上传文件指纹，再在事务内核对源库未变并应用映射/迁移。失败不切换候选版本；已生成备份保留。旧成员与旧邀请在迁移29隔离，不通过重跑迁移恢复权限。先运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和 `node --experimental-strip-types scripts/collaboration-smoke.mjs`。

迁移工具不负责复制服务器环境配置；另行备份 app.env 和旧镜像，保持密钥不入Git。候选版本启动后验证登录、旧照片、成员隔离、上传、分享、撤权、转让、截止冻结；真实验证码和邀请邮件以实际收件为准。

## 到期清理维护窗口

```sh
node --experimental-strip-types scripts/run-museum-deletion-worker.ts <data-directory> --limit 5
node --experimental-strip-types scripts/run-museum-deletion-worker.ts <data-directory> --limit 5 --apply --quiesced --backup-root <external-backup-directory>
```

默认只读，每轮1–20座到期共同宫殿。正式调度必须先停所有写入者，执行后检查退出码/结果，再启动服务；不得把在线web定时调用当作停写维护。建议每天维护窗口执行一轮，失败保留冻结、备份和清理日志，下轮满足一小时退避后重试；本轮失败不继续处理其他宫殿。此文档不安装计划任务。部署时运维需配置真正的重复执行；单次运行不是自动调度。

失败状态只公开尝试次数与下次重试时间；原始异常由维护人员在受控终端查看。先修复缺失文件、非法路径或备份问题，不删除清理日志、不随意改截止时间、不清空目录。重试复用原已验证备份，物理文件全部清理前保持额度占用。未知历史期限不自动清理，私人宫殿不整馆删除。

## 回滚

停止所有写入者，保留失败现场、当前数据与候选镜像。使用 `scripts/restore-backup.mjs` 恢复到新的空目录，核对数据库、上传文件与配置，验证后切换旧镜像及其对应旧数据；不在线覆盖当前数据库，不将旧镜像连接新schema。恢复的旧库若含历史active成员，只能配合原停用协作的旧版本，不能用它启动已恢复协作的新版本。再次升级必须重新隔离旧授权。永久删除截止后备份是运维恢复证据，不提供用户撤销能力。

## 仍需生产证据

生产库类型/额度映射、未完成操作清单、真实备份恢复、停写/调度、候选域名运行、真实邮件送达均未在本次本地执行。不得据此宣称部署成功。
