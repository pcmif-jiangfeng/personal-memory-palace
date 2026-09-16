# Personal Memory Palace V1

Task01 建立的项目基础：Next.js、TypeScript、SQLite、独立 Demo 数据和基础页面路由。

Task02 已接通照片创建闭环：批量上传、WebP 浏览版、可选原图、照片整理台、Memory Editor、Stage 管理和持久化保存。

Task03 已完成人生长廊浏览体验：现代博物馆首页、Stage 收藏册书架、三图悬停预览、Stage View、完整 Memory Exhibition 与响应式画廊。

Task04/05 已接通随机回忆、搜索、Later Notes、回收站，以及单用户 Owner 保护和 Visitor 分享链接。

## 本地启动

```bash
pnpm install
pnpm db:init
pnpm dev
```

访问 `http://localhost:3000`。默认使用独立的 `data/demo.sqlite`，首次初始化会写入 Demo 数据。

## 数据集

- `MEMORY_PALACE_DATASET=demo`：使用 Demo 库并加载演示内容（默认）。
- `MEMORY_PALACE_DATASET=owner`：使用空白的 `data/palace.sqlite`，不会混入 Demo 数据。
- `pnpm db:demo:reset`：删除并重建 Demo 库。

可用 `MEMORY_PALACE_DATA_DIR` 指定持久化目录。公网部署时应把该目录挂载到持久卷。

公网或局域网部署前请设置 `MEMORY_PALACE_OWNER_PASSWORD`（见 `.env.example`）。编辑入口和写入 API 需要馆长登录；Visitor 通过 Owner 生成的 `/share/<token>` 链接访问。Docker 镜像已包含 standalone 启动方式，数据库和图片目录需要映射到持久卷。

生产部署采用腾讯云轻量应用服务器、Docker 和宿主机 `/opt/personal-memory-palace/data` 持久目录。Task07 的首次部署、容器重建、备份及隔离恢复步骤见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

优化图片和可选原图保存在 `data/images/uploads/<dataset>/` 对应的数据集中，不会提交到版本库。
