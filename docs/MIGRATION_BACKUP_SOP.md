# Task 12C1：生产迁移前备份 SOP

本流程只制作和验证迁移前备份，不执行数据迁移。开始后到备份完成前，网站会短暂停止写入。请在腾讯云 Ubuntu 服务器上使用 `tmux` 或控制台托管终端运行，避免 SSH 断开中断操作。

备份包含 SQLite `palace.sqlite`、`data/images/uploads/owner` 下的照片，以及 `/opt/personal-memory-palace/config/app.env`。配置含密码和密钥；不要打印其内容、上传到 Git 或分享备份目录。

## 1. 前提检查

```bash
sudo test -f /opt/personal-memory-palace/data/palace.sqlite
sudo test -f /opt/personal-memory-palace/config/app.env
sudo install -d -m 700 /opt/personal-memory-palace/backups
sudo install -d -m 700 /opt/personal-memory-palace/restore-tests
sudo docker image inspect personal-memory-palace:current >/dev/null
```

确认数据卷、配置文件和当前镜像都存在，且备份盘有足够空间。镜像必须包含本次更新后的备份与恢复脚本；本地改动尚未部署到服务器时，不要在旧镜像上执行以下命令。不要对 `data/` 直接运行迁移脚本。

## 2. 停止写入并生成备份

```bash
set -e
umask 077
APP_VERSION="$(sudo docker image inspect personal-memory-palace:current --format '{{.Id}}')"
STOPPED=0
trap 'if [ "$STOPPED" -eq 1 ]; then sudo docker start personal-memory-palace >/dev/null; fi' EXIT
sudo docker stop personal-memory-palace
STOPPED=1

sudo docker run --rm \
  --entrypoint node \
  -e MEMORY_PALACE_APP_VERSION="$APP_VERSION" \
  -v /opt/personal-memory-palace/data:/app/data:ro \
  -v /opt/personal-memory-palace/config/app.env:/app/config/app.env:ro \
  -v /opt/personal-memory-palace/backups:/app/backups \
  personal-memory-palace:current \
  /app/maintenance/backup.mjs /app/data /app/backups --quiesced --config-file /app/config/app.env

sudo docker start personal-memory-palace
STOPPED=0
trap - EXIT
```

`--quiesced` 只声明应用写入已停止，脚本不会自行验证停写状态。若备份失败，退出 trap 会尝试重启主容器；先确认服务恢复，再排查错误，不要继续迁移。

## 3. 隔离恢复与验收

```bash
BACKUP_DIR="$(sudo find /opt/personal-memory-palace/backups -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | sort | tail -n 1)"
test -n "$BACKUP_DIR"
RESTORE_DIR="/opt/personal-memory-palace/restore-tests/restore-$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 700 "$RESTORE_DIR"

sudo docker run --rm \
  --entrypoint node \
  -v "$BACKUP_DIR":/app/backup:ro \
  -v "$RESTORE_DIR":/app/restore \
  personal-memory-palace:current \
  /app/maintenance/restore-backup.mjs /app/backup /app/restore

sudo test -s "$RESTORE_DIR/palace.sqlite"
sudo test -s "$RESTORE_DIR/.migration-config/app.env"
sudo test -f "$BACKUP_DIR/manifest.txt"
sudo find "$BACKUP_DIR/uploads/owner" -type f | wc -l
```

恢复工具拒绝非空目标目录，检查备份库的 `PRAGMA integrity_check` 和数据库引用的照片，再复制到隔离目录，并对**恢复后的** SQLite 再运行 `PRAGMA integrity_check`。命令退出码为 0 且输出 `Restore prepared`，上述文件检查均通过，才算验收成功。恢复的配置位于 `.migration-config/app.env`，不会覆盖生产配置；不要把它提交到仓库。

## 4. 失败处理与保留

- 任一步失败时，不执行下一阶段迁移；确认主容器已运行，保留已完成的备份及隔离恢复目录用于排查。
- 备份目录必须留在生产 `data/` 之外，且仅授权管理员访问。迁移前不要删除最后一个已验收的备份。
- 需要真正回滚时，先停止应用，并在另一个维护窗口按已验收备份恢复；本 SOP 不会自动覆盖生产数据。

本地回归验证：`node --experimental-strip-types --test tests/backup.test.ts tests/migration-backup.test.ts`。
