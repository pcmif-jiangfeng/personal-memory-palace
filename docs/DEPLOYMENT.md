# Personal Memory Palace V1 — 腾讯云生产部署

本文覆盖当前 V1 的腾讯云单 Owner 部署，并包含数据持久化、更新、备份和隔离恢复流程。域名、反向代理与 HTTPS 等备案条件满足后再处理。

## 1. 已确认的生产结构

```text
Application:     Next.js standalone / Node.js
Database:        /app/data/palace.sqlite
Optimized image: /app/data/images/uploads/owner/optimized/
Original image:  /app/data/images/uploads/owner/original/
Backup root:     /app/backups/
```

数据库、上传记录、Stage、Memory、Later Notes、关联关系和分享设置均在 `palace.sqlite`。优化图不能重新生成，因为原图是可选保存，所以数据库和整个 `images/uploads/owner` 都属于核心备份。

推荐宿主机结构：

```text
/opt/personal-memory-palace/
├── app/        # Git 仓库和 Docker build context
├── data/       # palace.sqlite 与 images/
├── backups/    # backup-YYYYMMDD-HHMMSS/
├── config/     # 生产 env file
└── restore-tests/
```

代码、数据、备份和 Secret 彼此分离。重新拉取代码或构建镜像不得删除 `data/`。

## 2. 生产环境变量

| 变量 | 公网 IP 阶段 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 使用生产模式 |
| `PORT` | `3000` | 容器内部端口 |
| `MEMORY_PALACE_DATASET` | `owner` | 使用真实 Owner 数据库 |
| `MEMORY_PALACE_DATA_DIR` | `/app/data` | 数据持久化挂载点 |
| `MEMORY_PALACE_OWNER_PASSWORD` | 服务器私密值 | 不能提交 Git |
| `MEMORY_PALACE_SESSION_SECRET` | 服务器随机私密值 | 独立签名会话和分享访问 Cookie；至少 32 个字符 |
| `MEMORY_PALACE_SECURE_COOKIES` | `false` | 仅为 HTTP/IP 验证；HTTPS 后改为 `true` |

Owner 会话和密码分享访问值由独立 Session Secret 签名。Owner 密码和 Session Secret 都不能进入 Git、镜像或日志。

## 3. 首次部署（腾讯云网页终端）

### 3.1 创建目录并拉取代码

```bash
sudo mkdir -p /opt/personal-memory-palace/app
sudo mkdir -p /opt/personal-memory-palace/data
sudo mkdir -p /opt/personal-memory-palace/backups
sudo mkdir -p /opt/personal-memory-palace/config
sudo mkdir -p /opt/personal-memory-palace/restore-tests
sudo chown -R ubuntu:ubuntu /opt/personal-memory-palace

git clone https://github.com/pcmif-jiangfeng/personal-memory-palace.git /opt/personal-memory-palace/app
cd /opt/personal-memory-palace/app
```

### 3.2 创建仅服务器可读的环境文件

下面的命令会隐藏密码输入。不要把密码写到命令、截图或 Git 中。

```bash
umask 077
read -rsp '设置主人密码：' OWNER_PASSWORD
printf '\n'
SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
printf 'NODE_ENV=production\nPORT=3000\nMEMORY_PALACE_DATASET=owner\nMEMORY_PALACE_DATA_DIR=/app/data\nMEMORY_PALACE_OWNER_PASSWORD=%s\nMEMORY_PALACE_SESSION_SECRET=%s\nMEMORY_PALACE_SECURE_COOKIES=false\n' "$OWNER_PASSWORD" "$SESSION_SECRET" > /opt/personal-memory-palace/config/app.env
unset OWNER_PASSWORD
unset SESSION_SECRET
chmod 600 /opt/personal-memory-palace/config/app.env
```

### 3.3 构建并启动

```bash
cd /opt/personal-memory-palace/app
docker build -t personal-memory-palace:current .

docker run -d \
  --name personal-memory-palace \
  --restart unless-stopped \
  --env-file /opt/personal-memory-palace/config/app.env \
  -v /opt/personal-memory-palace/data:/app/data \
  -v /opt/personal-memory-palace/backups:/app/backups \
  -p 80:3000 \
  personal-memory-palace:current

docker ps --filter name=personal-memory-palace
docker logs --tail 100 personal-memory-palace
curl -I http://127.0.0.1/login
```

在腾讯云防火墙中放行 TCP 80 后访问：

```text
http://82.156.172.124
```

## 4. Production Smoke Test

在浏览器中逐项验证：

1. 未登录打开首页会进入登录页。
2. 错误密码被拒绝，正确密码可以登录。
3. 首页、人生长廊、Stage、Memory Detail 和 Search 可访问。
4. 创建 Stage：`Production Verification`。
5. 上传一张测试图片，创建 Memory，Story 使用唯一文字：`Production persistence verification record.`
6. 刷新 Memory、Stage 页面，确认图片继续显示。
7. 创建一条无密码分享和一条密码分享，用无痕窗口验证 Visitor 只读。

## 5. 持久化验证

每一步完成后都检查测试 Stage、Memory、图片和分享设置。

### 5.1 Container restart

```bash
docker restart personal-memory-palace
docker ps --filter name=personal-memory-palace
```

### 5.2 Container recreate

```bash
docker stop personal-memory-palace
docker rm personal-memory-palace

docker run -d \
  --name personal-memory-palace \
  --restart unless-stopped \
  --env-file /opt/personal-memory-palace/config/app.env \
  -v /opt/personal-memory-palace/data:/app/data \
  -v /opt/personal-memory-palace/backups:/app/backups \
  -p 80:3000 \
  personal-memory-palace:current
```

删除的是容器，不是宿主机 `/opt/personal-memory-palace/data`，因此真实数据应继续存在。

### 5.3 Image rebuild 后 recreate

```bash
cd /opt/personal-memory-palace/app
git pull --ff-only
docker build -t personal-memory-palace:current .
docker stop personal-memory-palace
docker rm personal-memory-palace
```

然后重复 5.2 的 `docker run`，再次验证旧数据。

### 5.4 Server reboot

从腾讯云控制台重启实例。恢复后执行：

```bash
docker ps --filter name=personal-memory-palace
curl -I http://127.0.0.1/login
```

`--restart unless-stopped` 应保证 Docker daemon 启动后容器自动恢复。

## 6. 手动一致性备份

备份脚本使用 Node SQLite Backup API 创建数据库快照，随后复制 Owner 上传目录、运行 `PRAGMA integrity_check` 并写入 manifest。为了让数据库和图片属于同一个稳定快照，执行时必须短暂停止应用写入。

```bash
cd /opt/personal-memory-palace/app
APP_VERSION="$(git rev-parse --short HEAD)"
docker stop personal-memory-palace

docker run --rm \
  --entrypoint node \
  -e MEMORY_PALACE_APP_VERSION="$APP_VERSION" \
  -v /opt/personal-memory-palace/data:/app/data:ro \
  -v /opt/personal-memory-palace/backups:/app/backups \
  personal-memory-palace:current \
  /app/maintenance/backup.mjs /app/data /app/backups

docker start personal-memory-palace
find /opt/personal-memory-palace/backups -maxdepth 2 -type f -print
```

输出目录示例：

```text
backup-20260916-210000/
├── database/
│   └── palace.sqlite
├── uploads/
│   └── owner/
└── manifest.txt
```

如果备份命令失败，先重新启动主容器，再检查错误；脚本只会发布完整备份，失败的临时目录会被清理。

## 7. 隔离恢复测试

恢复工具拒绝写入非空目录，并会先检查 SQLite 完整性及所有数据库引用的上传文件。它不会覆盖生产数据。

```bash
LATEST_BACKUP="$(find /opt/personal-memory-palace/backups -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | sort | tail -n 1)"
RESTORE_DIR="/opt/personal-memory-palace/restore-tests/restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESTORE_DIR"

docker run --rm \
  --entrypoint node \
  -v "$LATEST_BACKUP":/app/backup:ro \
  -v "$RESTORE_DIR":/app/restore \
  personal-memory-palace:current \
  /app/maintenance/restore-backup.mjs /app/backup /app/restore

docker run -d \
  --name memory-palace-restore-test \
  --env-file /opt/personal-memory-palace/config/app.env \
  -v "$RESTORE_DIR":/app/data \
  -p 127.0.0.1:8081:3000 \
  personal-memory-palace:current

curl -I http://127.0.0.1:8081/login
docker logs --tail 100 memory-palace-restore-test
```

恢复工具会输出 Stage、Memory 和引用图片数量。测试实例真实启动且 `/login` 返回成功后，停止并移除测试容器：

```bash
docker stop memory-palace-restore-test
docker rm memory-palace-restore-test
```

保留本次 `restore-tests/restore-...` 目录，直到人工确认备份有效；不要用恢复测试覆盖唯一生产数据。

## 8. 更新部署

```bash
cd /opt/personal-memory-palace/app
git pull --ff-only
docker build -t personal-memory-palace:current .
```

先按第 6 节备份，再按第 5.2 节重建容器。代码更新不会覆盖宿主机 data。

## 9. 磁盘与运行检查

```bash
df -h
du -sh /opt/personal-memory-palace/data
du -sh /opt/personal-memory-palace/backups
docker system df
```

V1 不增加后台监控页面。发现磁盘紧张时先确认备份可恢复，再处理明确无用的旧镜像或备份，不得执行针对 data 的递归删除。

## 10. 上传可靠性边界

- 支持 JPEG、PNG、WebP。
- 单文件上限 20MB。
- 单批最多 20 个文件，原始数据总量最多 100MB。
- 图片按顺序处理，适配 2GB 内存服务器。
- 每个文件先写临时文件再原子重命名。
- 图片处理中途失败会删除本次已写文件；数据库批量写入失败也会回滚并清理文件。

## 11. Phase 2 停止点

公网 IP 基线完成后停止。域名条件满足后再把 `MEMORY_PALACE_SECURE_COOKIES` 改为 `true`，并选择一种反向代理配置 HTTPS、HTTP 跳转及分享链接复测。本 Task 不实施 Phase 2。
