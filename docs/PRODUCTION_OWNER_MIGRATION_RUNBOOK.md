# Task 12C4：Legacy Owner 生产迁移 Runbook

**状态：仅供审查，尚未执行。** 本文面向当前腾讯云 Ubuntu + 单容器部署，操作路径固定为 `/opt/personal-memory-palace`。执行者须在维护窗口逐段运行并核对结果，不要把全文一次粘贴进 Shell。任何校验失败就保持应用停止，按回滚段处理；不要猜测归属、跳过备份或重复执行迁移。

这次迁移只把旧 Owner 建为首个 User，并将现有 Memory、Stage、Photo、照片库、工作台、分享、回收站、关联、后来笔记、封面及其他 Museum-owned 记录归属到其 Museum。它不切换网站认证方式：旧 Owner 密码仍用于现有登录，新 User 的邮箱初始为**未验证**，不能把迁移成功误认为新 User 登录已可用。

## 0. 硬性前提与维护窗口

1. 预约低流量维护窗口，通知使用者届时暂停上传、编辑、删除和分享操作。安排至少一名执行者持续看守终端；使用 `tmux` 或腾讯云托管终端。
2. 先完成本地 `pnpm check`、`pnpm build` 和 Task 12C3 的隔离验证。用于迁移的 Git checkout 必须包含 `scripts/migrate-legacy-owner.ts` 与对应 `src/`；当前 Dockerfile **没有**把迁移脚本复制进运行镜像，所以以下命令会只读挂载同一 checkout 的脚本。不得拿旧镜像搭配新脚本。
3. 确认现有容器名、80 端口、数据卷和配置文件与 [部署文档](DEPLOYMENT.md)一致；若容器有额外挂载、网络或启动参数，先记录并调整回滚命令，不能照搬。
4. 确认 `data/palace.sqlite`、`config/app.env`、足够容纳“备份 + 隔离恢复 + 失败现场”的磁盘空间。配置及备份含密码/密钥，只准管理员访问，不上传 Git。
5. 确认生产库尚无 User/Museum，且旧数据 `museum_id` 尚未归属。迁移脚本遇到已有 User/Museum 或已归属记录会拒绝执行；此时需要另行制定归属方案，不要改脚本强行通过。

在维护窗口前，从**已经审查并冻结的同一代码版本**构建迁移镜像；构建不会接触生产数据。不要覆盖当前运行容器使用的镜像标识。

```bash
cd /opt/personal-memory-palace/app
test -z "$(git status --porcelain)"
test -f scripts/migrate-legacy-owner.ts
sudo test -f /opt/personal-memory-palace/data/palace.sqlite
sudo test -f /opt/personal-memory-palace/config/app.env
OLD_IMAGE_ID="$(sudo docker inspect personal-memory-palace --format '{{.Image}}')"
MIGRATION_IMAGE="personal-memory-palace:migration-$(git rev-parse --short HEAD)"
sudo docker build -t "$MIGRATION_IMAGE" .
sudo docker image inspect "$MIGRATION_IMAGE" >/dev/null
printf 'Old image: %s\nMigration image: %s\n' "$OLD_IMAGE_ID" "$MIGRATION_IMAGE"
```

若 checkout 有未提交改动、构建失败、`OLD_IMAGE_ID` 为空、镜像与脚本不是同一代码版本，**停止**。记录 `OLD_IMAGE_ID`、`MIGRATION_IMAGE` 和当前容器 `sudo docker inspect personal-memory-palace` 的挂载/端口/重启策略，供回滚使用。邮箱由执行者输入，不能替他人猜测：

```bash
read -rp '首个 User 的邮箱：' LEGACY_OWNER_EMAIL
test -n "$LEGACY_OWNER_EMAIL"
```

Owner 密码从服务器 `config/app.env` 传入容器；不要写入命令历史、屏幕输出或报告。

## 1. 停止应用写入并制作备份

先停止主容器，再备份。此刻起维持维护窗口，直到“重启与烟测”通过。不要设置失败后自动重启的 trap。

```bash
sudo docker stop personal-memory-palace
sudo test "$(sudo docker inspect personal-memory-palace --format '{{.State.Running}}')" = false
sudo install -d -m 700 /opt/personal-memory-palace/backups
sudo install -d -m 700 /opt/personal-memory-palace/restore-tests

sudo docker run --rm --network none --entrypoint node \
  -e MEMORY_PALACE_APP_VERSION="$OLD_IMAGE_ID" \
  --mount type=bind,src=/opt/personal-memory-palace/data,dst=/app/data,readonly \
  --mount type=bind,src=/opt/personal-memory-palace/config/app.env,dst=/app/config/app.env,readonly \
  --mount type=bind,src=/opt/personal-memory-palace/backups,dst=/app/backups \
  "$MIGRATION_IMAGE" \
  /app/maintenance/backup.mjs /app/data /app/backups --quiesced --config-file /app/config/app.env
```

命令必须退出 0 并输出 `Backup created`。从输出中核对备份名，再选定该**本次**备份目录，不可仅凭“最新”二字继续：

```bash
BACKUP_DIR=/opt/personal-memory-palace/backups/backup-YYYYMMDD-HHMMSS
sudo test -s "$BACKUP_DIR/database/palace.sqlite"
sudo test -s "$BACKUP_DIR/manifest.txt"
sudo test -s "$BACKUP_DIR/config/app.env"
sudo test -d "$BACKUP_DIR/uploads/owner"
```

按 [备份与隔离恢复 SOP](MIGRATION_BACKUP_SOP.md) 检查 manifest、照片数量与权限。备份失败时不要迁移；若确认生产 `data/` 未被改动，可重新启动原容器并结束维护窗口。

## 2. 隔离恢复及 dry-run（必须先通过）

将备份恢复到**新的空目录**，不写生产 `data/`：

```bash
RESTORE_DIR="/opt/personal-memory-palace/restore-tests/preflight-$(date +%Y%m%d-%H%M%S)"
sudo install -d -m 700 "$RESTORE_DIR"
sudo docker run --rm --network none --entrypoint node \
  --mount type=bind,src="$BACKUP_DIR",dst=/app/backup,readonly \
  --mount type=bind,src="$RESTORE_DIR",dst=/app/restore \
  "$MIGRATION_IMAGE" \
  /app/maintenance/restore-backup.mjs /app/backup /app/restore
sudo test -s "$RESTORE_DIR/palace.sqlite"
```

必须看到 `Restore prepared` 且退出 0。随后对**只读挂载的隔离恢复库**运行 C2 dry-run。脚本只改容器 `/tmp` 中的临时副本，输出 JSON；它不会对传入数据库执行正式迁移。

```bash
sudo docker run --rm --network none --entrypoint node \
  --env-file /opt/personal-memory-palace/config/app.env \
  --mount type=bind,src="$RESTORE_DIR",dst=/app/data,readonly \
  --mount type=bind,src=/opt/personal-memory-palace/app/scripts/migrate-legacy-owner.ts,dst=/app/maintenance/migrate-legacy-owner.ts,readonly \
  "$MIGRATION_IMAGE" \
  --experimental-strip-types /app/maintenance/migrate-legacy-owner.ts \
  /app/data/palace.sqlite /app/data/images "$LEGACY_OWNER_EMAIL"
```

**继续门槛：**命令退出 0；`before` 与 `after` 中 Memory、Stage、Photo 及其他 10 张归属表的数量逐项一致；`after.users=1`、`after.museums=1`；`orphanCount=0`、`missingFileCount=0`。保存不含密钥的 JSON 输出及人工核对结果。若旧库已有 User/Museum、文件缺失或任何数量异常，**停止并调查**，不进入正式迁移。

另从隔离恢复库记录分享和回收站的基线数量，供第 4 节与烟测比较：

```bash
sudo docker run --rm --network none --entrypoint node \
  --mount type=bind,src="$RESTORE_DIR",dst=/app/data,readonly \
  "$MIGRATION_IMAGE" --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync("/app/data/palace.sqlite", { readOnly: true });
    try { console.log(JSON.stringify({
      trashedMemories: db.prepare("SELECT COUNT(*) AS n FROM memories WHERE trashed_at IS NOT NULL").get().n,
      trashedStages: db.prepare("SELECT COUNT(*) AS n FROM stages WHERE trashed_at IS NOT NULL").get().n,
      enabledShares: db.prepare("SELECT COUNT(*) AS n FROM share_configs WHERE enabled = 1").get().n,
    })); } finally { db.close(); }
  '
```

## 3. 正式迁移（仅在维护窗口内执行一次）

再次确认主容器仍为 stopped、备份与 dry-run 均通过。下列命令不是 C2 的 CLI dry-run：它显式调用已在 C3 隔离测试通过的 `migrateLegacyOwnerInDatabase`，使用读写挂载，**会修改生产 SQLite**。不要在当前 Task 中运行。

```bash
sudo test "$(sudo docker inspect personal-memory-palace --format '{{.State.Running}}')" = false
sudo docker run --rm --network none --entrypoint node \
  --env-file /opt/personal-memory-palace/config/app.env \
  -e LEGACY_OWNER_EMAIL="$LEGACY_OWNER_EMAIL" \
  --mount type=bind,src=/opt/personal-memory-palace/data,dst=/app/data \
  --mount type=bind,src=/opt/personal-memory-palace/app/scripts/migrate-legacy-owner.ts,dst=/app/maintenance/migrate-legacy-owner.ts,readonly \
  "$MIGRATION_IMAGE" \
  --experimental-strip-types --input-type=module -e '
    import { initializeDatabase } from "/app/src/data/database.ts";
    import { migrateLegacyOwnerInDatabase } from "/app/maintenance/migrate-legacy-owner.ts";
    const email = process.env.LEGACY_OWNER_EMAIL;
    const password = process.env.MEMORY_PALACE_OWNER_PASSWORD?.trim();
    if (!email || !password) throw new Error("Owner identity is missing");
    const database = initializeDatabase("/app/data/palace.sqlite", false);
    try {
      const result = migrateLegacyOwnerInDatabase(database, {
        email, password, displayName: "馆长",
        museumName: "人生博物馆", museumSlug: "legacy-owner",
      });
      console.log(JSON.stringify({ userId: result.userId, museumId: result.museumId }));
    } finally { database.close(); }
  '
```

命令必须退出 0，并仅输出新 User/Museum ID，不输出密码或密码哈希。若返回非零，**不要重试**：先保留错误输出并检查只读状态；必要时按第 6 节回滚。脚本会拒绝第二次归属，不能通过清理 User/Museum 表来“重新执行”。

## 4. 停机状态下只读校验

使用同一镜像打开只读数据库，检查完整性、外键、归属和关键数量。把输出与第 2 节 dry-run 的 `before` 数量逐项比较。

```bash
sudo docker run --rm --network none --entrypoint node \
  --mount type=bind,src=/opt/personal-memory-palace/data,dst=/app/data,readonly \
  "$MIGRATION_IMAGE" --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync("/app/data/palace.sqlite", { readOnly: true });
    try {
      const tables = ["stages", "memories", "uploaded_photos", "stage_covers",
        "memory_images", "memory_relations", "later_notes", "share_configs",
        "photo_deletion_jobs", "pending_uploads"];
      const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
      const orphans = db.prepare("PRAGMA foreign_key_check").all().length;
      const museum = db.prepare("SELECT id FROM museums LIMIT 1").get()?.id;
      const counts = Object.fromEntries(tables.map(t => [t, {
        total: db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n,
        assigned: db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE museum_id = ?`).get(museum).n,
      }]));
      const report = { integrity, orphans, users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
        museums: db.prepare("SELECT COUNT(*) AS n FROM museums").get().n,
        trashedMemories: db.prepare("SELECT COUNT(*) AS n FROM memories WHERE trashed_at IS NOT NULL").get().n,
        trashedStages: db.prepare("SELECT COUNT(*) AS n FROM stages WHERE trashed_at IS NOT NULL").get().n,
        enabledShares: db.prepare("SELECT COUNT(*) AS n FROM share_configs WHERE enabled = 1").get().n,
        counts };
      console.log(JSON.stringify(report, null, 2));
      if (integrity !== "ok" || orphans !== 0 || report.users !== 1 || report.museums !== 1 ||
          Object.values(counts).some(x => x.total !== x.assigned)) process.exitCode = 1;
    } finally { db.close(); }
  '
```

**继续门槛：**退出 0，Memory/Stage/Photo 数量与 dry-run `before` 完全相同，每张表 `total=assigned`，User/Museum 各 1，`integrity=ok`、`orphans=0`。再次核对照片目录未被移动；分享配置和回收站记录数量与迁移前一致。任何不符先回滚，不能靠修改 SQL 数字让检查通过。

## 5. 重启与无写入烟测

只在第 4 节全部通过后重启**原容器**，确认旧版本仍能读取扩展后的数据库：

```bash
sudo docker start personal-memory-palace
sudo docker ps --filter name=personal-memory-palace
curl -fsSI http://127.0.0.1/login
sudo docker logs --tail 50 personal-memory-palace
```

执行者随后用现有 Owner 密码登录，人工确认首页、旧 Stage、旧 Memory 详情、照片、搜索、照片库和回收站均可读取；用无痕窗口检查现有分享链接与分享照片。此阶段先**不要**上传或编辑新数据。若发现 5xx、图片 404、旧记录缺失、分享失效或异常日志，立即停止主容器并按第 6 节回滚。全部通过后解除维护窗口，再恢复写入。

## 6. 回滚（保留失败现场）

回滚触发条件：正式迁移失败、只读校验失败、烟测失败或数据归属不明。以下流程会恢复到第 1 节备份时点；如果维护窗口已解除且产生了新写入，**先停机并评估这些新数据的损失**，不可直接覆盖。不要仅回退代码而保留已经迁移的数据库。

1. `sudo docker stop personal-memory-palace`，确认已停止；不要再放行写入。
2. 使用第 1 节**同一个** `BACKUP_DIR`，按第 2 节的恢复命令恢复到新的空目录 `ROLLBACK_DIR=/opt/personal-memory-palace/restore-tests/rollback-时间戳`；要求 `Restore prepared`、数据库和照片检查全部通过。
3. 逐项确认下列路径均为预期的 `/opt/personal-memory-palace` 子目录，且 `ROLLBACK_DIR` 是刚恢复的新目录、`FAILED_DIR` 不存在。然后停机、移走失败现场、移入恢复目录；不删除失败现场。括号内的 `set -e` 只终止该组命令，不会退出 SSH Shell：

```bash
ROOT=/opt/personal-memory-palace
ROLLBACK_DIR="$ROOT/restore-tests/rollback-YYYYMMDD-HHMMSS"
FAILED_DIR="$ROOT/data-failed-$(date +%Y%m%d-%H%M%S)"
(
  set -e
  sudo test -s "$ROLLBACK_DIR/palace.sqlite"
  test "$(sudo realpath -e "$ROLLBACK_DIR")" = "$ROLLBACK_DIR"
  sudo test -d "$ROOT/data"
  sudo test ! -e "$FAILED_DIR"
  sudo docker stop personal-memory-palace
  sudo docker rm personal-memory-palace
  sudo mv "$ROOT/data" "$FAILED_DIR"
  sudo test ! -e "$ROOT/data"
  sudo mv "$ROLLBACK_DIR" "$ROOT/data"
)
```

如果第二次 `mv` 失败，不要启动容器；先将 `FAILED_DIR` 移回 `data`，查明原因。容器需要按部署文档的**原有**挂载和端口重新创建，镜像使用第 0 节记录的 `OLD_IMAGE_ID`，不要使用迁移镜像代替原版本：

```bash
sudo docker run -d \
  --name personal-memory-palace \
  --restart unless-stopped \
  --env-file /opt/personal-memory-palace/config/app.env \
  -v /opt/personal-memory-palace/data:/app/data \
  -v /opt/personal-memory-palace/backups:/app/backups \
  -p 80:3000 \
  "$OLD_IMAGE_ID"
curl -fsSI http://127.0.0.1/login
sudo docker logs --tail 50 personal-memory-palace
```

再用 Owner 登录，核对备份时点的 Memory、Stage、图片、分享和回收站；保持 `FAILED_DIR` 与备份供排查，未经单独确认不要删除。若现场部署不是上述 `docker run` 形态，必须依据第 0 节保存的 `docker inspect` 还原原配置。

## 本 Task 的执行边界

本文只给出未来维护窗口的操作顺序与停止条件。Task 12C4 **没有**在腾讯云构建镜像、停止服务、制作生产备份、运行 dry-run、迁移数据或执行回滚。真实 Owner 数据尚未参与 Task 12C3 的隔离验证；拿到真实备份后，应先在隔离环境重复第 2 节与页面验收，才能决定是否打开生产迁移窗口。
