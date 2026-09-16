# Task01 基础选型

- **Frontend**: Next.js App Router + React + TypeScript。基础路由和响应式 UI 可在同一项目中继续演进。
- **Backend**: Next.js Node.js 服务端。V1 基础阶段不拆分独立 API 服务。
- **Database**: SQLite + 显式 SQL schema。零额外数据库运行时依赖，本地初始化直接。
- **Image Storage**: 独立 `ImageStorage` 边界 + 本地静态文件。当前只满足 Demo 读取，不实现上传。
- **Deployment**: Next.js standalone + Docker。之后可将数据目录挂载到持久卷。
