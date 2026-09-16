# Personal Memory Palace V1 部署说明

## Deployment Decision

- **Platform:** Render Web Service
- **Reason:** 原生支持 Dockerfile 和单实例 Persistent Disk；适合当前 SQLite + 本地图片文件结构。持久磁盘会保留重启和重新部署后的数据，并提供每日快照。
- **Build Method:** 仓库根目录 `Dockerfile`，Next.js standalone 多阶段构建。
- **Start Command:** `node server.js`（由 Dockerfile `CMD` 提供）。
- **Persistent Storage:** Render Disk，挂载到 `/app/data`，初始 1 GB。SQLite 和上传图片必须都写入此目录。
- **Environment Variables:** `NODE_ENV=production`、`PORT=10000`、`MEMORY_PALACE_DATASET=owner`、`MEMORY_PALACE_DATA_DIR=/app/data`、`MEMORY_PALACE_OWNER_PASSWORD=<secret>`。

Render 的持久磁盘只允许单个服务实例使用，因此本项目保持单实例运行。这也符合 V1 的 Single Owner 定位和 SQLite 的使用方式。

## 当前架构

```text
Frontend:      Next.js App Router + React
Backend:       Next.js Node.js Route Handlers
Database:      SQLite (/app/data/palace.sqlite)
Image Storage: Local filesystem (/app/data/images)
Hosting:       Render Docker Web Service
Persistence:   Render Persistent Disk mounted at /app/data
```

## 首次部署

1. 将项目推送到一个 Git 仓库。不要提交 `.env.local`、SQLite 文件或 `data/images`。
2. 在 Render Dashboard 选择 **New > Blueprint**，连接该仓库。Render 会读取根目录的 `render.yaml`。
3. 在创建过程中设置 `MEMORY_PALACE_OWNER_PASSWORD`。使用只用于本网站的长密码；不要写进代码或 `render.yaml`。
4. 确认服务使用 Docker、区域为 Singapore、磁盘挂载路径为 `/app/data`。
5. 创建 Blueprint。首次启动时应用会在持久卷中自动创建 `/app/data/palace.sqlite` 和图片目录。
6. 打开 Render 提供的 `https://<service-name>.onrender.com` 地址，访问 `/login` 并用 Owner 密码登录。

持久磁盘不支持 Render Free Web Service，因此必须选择可挂载磁盘的付费实例。不要在没有磁盘的临时实例中录入真实记忆。

## 更新与重新部署

1. 在本地完成并测试修改。
2. 推送到已连接的 Git 分支；Render 自动重新构建 Docker 镜像并部署。
3. 部署完成后检查 `/login`、首页、图片和分享链接。
4. 不要删除、改名或更换 `/app/data` 磁盘，除非已经完成备份与恢复演练。

代码部署与数据卷相互独立：新镜像不会覆盖 `/app/data` 中的 SQLite 和图片。

## 修改环境变量

在 Render Dashboard 的 **Environment** 页面修改变量并保存。修改会触发服务重启。

- `MEMORY_PALACE_OWNER_PASSWORD`：Owner 登录密码。修改后旧 Owner Cookie 自动失效。
- `MEMORY_PALACE_DATASET`：生产固定为 `owner`。
- `MEMORY_PALACE_DATA_DIR`：生产固定为 `/app/data`。
- `PORT`：保持 `10000`，与 Render Web Service 端口一致。

## 数据与备份

持久卷内容：

```text
/app/data/
├── palace.sqlite
├── palace.sqlite-shm
├── palace.sqlite-wal
└── images/
    └── uploads/owner/
        ├── optimized/
        └── original/
```

Render 对持久磁盘提供每日快照。仍建议定期创建应用级一致性备份：先使用 SQLite backup 命令或短暂停止写入，再复制 `palace.sqlite` 及其 WAL/SHM 文件和整个 `images` 目录。不要只复制数据库而遗漏图片。

恢复时应先停止服务写入，将数据库和图片恢复到同一个 `/app/data` 卷，再重启并检查图片路径。

## 部署后验证

### Owner

- 未登录访问 `/`、`/workspace`、`/stages`、`/trash` 会跳转 `/login`。
- 正确密码可以登录；错误密码返回拒绝。
- 上传 JPG/PNG/WebP，创建包含 Story 的 Memory，刷新后内容和图片仍存在。
- 测试 Later Note、Search、Time Gear、删除到回收站与恢复。
- 在 Render Dashboard 重启服务，再次确认 Memory 和图片仍存在。

### Visitor

- 创建一条无密码分享链接，并用无痕窗口打开。
- 创建一条密码分享链接，验证错误密码被拒绝、正确密码可访问。
- 无痕窗口不能打开 Owner 页面，不能调用 POST/PUT/DELETE 写入 API。
- private Memory 的直接 URL 不应向未登录访客展示内容。

### Desktop / Mobile

- 分别检查首页、Stage、Memory Exhibition、Time Gear、Search 和分享链接。
- 检查窄屏下无横向溢出，图片加载成功，表单按钮可操作。

## 运维

### 查看日志

在 Render 服务的 **Logs** 页面查看构建日志和运行日志。重点关注 Docker 构建失败、SQLite 无法打开、磁盘权限和图片处理错误。

### 重启

在 Render Dashboard 使用 **Manual Deploy > Restart service**。重启后先验证已有 Memory 和图片仍在，再进行写入操作。

### 常见问题

- **重启后数据消失：** 检查磁盘是否挂载到 `/app/data`，以及 `MEMORY_PALACE_DATA_DIR` 是否完全一致。
- **页面可开但无法登录：** 检查 `MEMORY_PALACE_OWNER_PASSWORD` 是否已设置，修改后重新登录。
- **图片上传失败：** 检查磁盘剩余空间、挂载权限和日志中的 Sharp 错误。
- **出现 Demo 内容：** 检查 `MEMORY_PALACE_DATASET` 必须为 `owner`。
- **部署后 502：** 检查服务是否读取 `PORT=10000`，并确认启动命令为 `node server.js`。

## 官方参考

- [Render Docker 部署](https://render.com/docs/docker)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Blueprint 规范](https://render.com/docs/blueprint-spec)
