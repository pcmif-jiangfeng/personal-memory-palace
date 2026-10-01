# Task12J6 — 到期永久删除自检与操作说明

日期：2026-10-01。范围：仅永久删除已到期、仍处于 `pending_deletion` 的 Museum。K6 不存在，直接忽略；不删除 User，不新增网页立即永久删除按钮，不自动安装生产清理定时任务。

## 实现及取舍

- `src/data/museum-permanent-deletion.ts` / migration 26：预演与分阶段清理日志。第一事务清理全部 16 类 Museum-owned 数据，包含正文、阶段、关系、照片记录、上传/删除日志、配额台账、Invite、Membership、Share、通知、受控许可和馆属审计；暂留 Museum 与清理日志作为文件清理的归属证据。文件清理成功后第二事务删除 Museum 和日志。
- `src/storage/museum-storage-cleanup.ts`：只清理 `images/uploads/museums/<Museum UUID>` 单馆目录，包含原始图、优化图、缩略图和该命名空间中未引用文件。拒绝路径穿越、符号链接、junction 和特殊文件；不清理整个 images/uploads，不触碰其他馆或共享静态资源。
- `src/application/permanent-museum-deletion.ts`：必须停写、验证备份、复核删除周期，才执行数据/文件清理。保存原备份路径及 SHA-256 指纹；失败后保留日志，重试仍验证同一份原备份，不能用删除后的空馆备份冒充原备份。
- `scripts/finalize-museum-deletion.ts`：默认只读 dry-run；正式执行必须明确 `--apply --quiesced --confirm <Museum UUID> --backup-root <directory>`。自动全量备份、隔离恢复验证、比对数据库数据与上传文件指纹；恢复验证临时目录自动清理，备份保留。互斥锁阻止同一数据目录上的并发正式操作。
- `src/data/museum-deletion.ts`：清理开始后拒绝撤销，返回 `MUSEUM_DELETE_IN_PROGRESS`；不允许恢复只剩部分内容的馆。
- `Dockerfile` / `package.json`：包含维护命令，`pnpm museums:delete-final` 可用于源码环境。

SQLite 与文件系统不能组成同一个原子事务，因此采用 durable journal + staged cleanup，而不是在网页请求中删除大目录或伪称整体可回滚。两个数据库事务都校验其他馆、未归属数据及 User/Session/验证码数据的指纹；异常副作用会在事务内回滚。逐行读取指纹，避免维护时一次加载所有 Story。

## 验证结果

- 全量 425 项测试通过，0 失败、0 跳过；类型、lint、格式检查通过。
- 24 项 J6 专项测试通过：到期边界、只读预演、全部馆属表非空清理、migration 幂等、数据库回滚、跨馆绑定矩阵、未知馆属表拒绝、备份失败/缺图/指纹变化、物理文件与原图/孤儿文件、符号链接/junction 拒绝、文件失败重试、最终事务中断恢复、取消竞态及其他馆/User 保持。
- 隔离磁盘库运行真实维护 CLI，通过备份、恢复验证、最终删除及完整性/外键检查。
- 隔离临时空库生产构建通过；生产启动与 K3/K4/K5 HTTP 回归通过，真实邮件未发送。
- Windows 测试最初暴露备份路径超长及夹具连接未关闭，已缩短操作目录、修复资源释放并通过回归。
- 代码审查未发现阻止 J6 交付的问题；未新增依赖，未访问/迁移/删除真实用户或生产数据。

## 生产前提

1. 部署本版本，确认 migration 26 已应用；先验证正常登录、上传、旧照片和分享。不在旧版本镜像中挂载新脚本混用。
2. 旧 `uploads/owner` / `uploads/demo` 归属照片必须先通过已有照片存储迁移归入 Museum UUID。此命令对此类旧路径拒绝执行，不猜测共享文件归属。
3. 核对服务器容器的实际挂载、端口与数据路径，预留完整备份和隔离恢复所需磁盘空间。下面的路径仅适用于既有 `/opt/personal-memory-palace` 单容器布局。
4. 关闭网站容器、邮件定时任务、文件恢复程序及所有其他 DB/照片写入者；只运行一份维护命令。`--quiesced` 是操作者确认，不是自动停止所有服务。
5. 保留原始备份。生产第一次操作仍须先用真实备份在隔离环境完整演练，不允许直接在生产试跑。

## 预演

填入已到期馆的真实 UUID；以下命令不删除数据。可以在同版本容器中只读预演，但结果是当时快照，正式执行还会重新检查。

```bash
MUSEUM_ID='替换为目标馆的真实UUID'
sudo docker exec personal-memory-palace node --experimental-strip-types \
  /app/maintenance/finalize-museum-deletion.ts /app/data "$MUSEUM_ID"
```

成功返回 `dryRun: true`、删除日期、逐表数量、文件数和字节数。不输出 Story、照片正文、密码或 token。未到期/已取消/归属异常/旧照片路径会拒绝。

## 正式执行（仅在隔离演练与维护前提满足后）

先记录当前同版本镜像并停止主容器；另外暂停已经安装的邮件 cron 和其他维护任务。不要只停浏览器或误以为 `--network none` 会停止主容器。

```bash
DELETION_IMAGE="$(sudo docker inspect personal-memory-palace --format '{{.Image}}')"
sudo docker stop personal-memory-palace
sudo test "$(sudo docker inspect personal-memory-palace --format '{{.State.Running}}')" = false
sudo install -d -m 700 /opt/personal-memory-palace/backups

sudo docker run --rm --network none --entrypoint node \
  --mount type=bind,src=/opt/personal-memory-palace/data,dst=/app/data \
  --mount type=bind,src=/opt/personal-memory-palace/backups,dst=/app/backups \
  "$DELETION_IMAGE" --experimental-strip-types \
  /app/maintenance/finalize-museum-deletion.ts /app/data "$MUSEUM_ID" \
  --apply --quiesced --confirm "$MUSEUM_ID" --backup-root /app/backups
```

只有退出 0 且返回 `deleted: true, verified: true` 才算完成。保留输出中的备份路径/指纹；之后启动原容器、恢复邮件任务，核对目标馆消失、其他馆及其照片/分享仍正常。

## 失败与恢复

- 备份/恢复验证/首次数据库事务失败：内容未进入清理阶段，查明原因后再预演。不删除备份。
- 已有清理日志：保持停写，修复具体的文件权限/异常路径/磁盘问题后用相同参数重试；原备份必须仍存在且指纹不变。不要尝试撤销删除、删除清理日志或使用新空馆备份替代原备份。
- 进程被强制终止可能遗留 `/app/data/.museum-permanent-delete.lock`。仅在确认没有其他清理进程、全部写入者仍停机后，人工移除这一个锁文件；命令不会根据 PID 自动抢锁。
- 若需要放弃清理并恢复：从输出记录的原备份恢复到新空目录，验证后在维护窗口恢复完整 data；参照既有备份恢复 SOP。该备份包含所有馆，不能在其他馆已产生新写入后直接全库覆盖；必须评估并保留新数据。
- 删除的是在线数据库和上传目录中的馆数据，不会自动销毁灾备副本。备份仍含该馆数据，必须限制访问，并由运营者按明确的保留期限处理；不要把“在线永久删除”宣称为“所有历史备份已擦除”。

当前只完成源码和隔离验收，不自动部署、不自动开启生产永久删除。
