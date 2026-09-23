# Personal Memory Palace V1 架构说明

本文描述当前代码的实际边界，帮助后续维护者判断改动应该放在哪里。它不是未来路线图。

## 1. 运行结构

```text
Browser
  -> Next.js App Router pages / client components
  -> Route Handlers (src/app/api, src/app/media)
  -> repositories (src/data)
  -> SQLite + local image storage
```

V1 是单体 Next.js 应用。页面渲染、写入 API、身份校验和图片读取运行在同一个 Node.js 进程中；数据库使用 SQLite，图片存储在持久化数据目录。Docker 镜像只包含应用，数据库、图片和备份通过宿主机挂载保留。

## 2. 代码边界

- `src/app/`：页面、API 和受控媒体读取入口。
- `src/components/`：交互界面；不直接操作 SQLite 或文件系统。
- `src/http/`：请求解析、输入边界和统一错误响应。
- `src/security/`：可独立测试的会话签名和请求限流逻辑。
- `src/data/`：Schema、查询、事务和领域写入。
- `src/storage/`：图片处理与本地文件存储边界。
- `src/domain/`：共享模型和长度/数量规则。
- `src/config.ts`：环境变量的唯一解析入口。

Route Handler 负责认证、解析输入和选择业务操作；Repository 负责数据约束和持久化。未知内部错误只记录服务端上下文，对客户端统一返回 `INTERNAL_ERROR`。

## 2.1 Components Runtime Boundary

### Server Components

Server Components 可以使用仅限服务端的展示依赖、图片路径解析器等服务端模块，并在需要时读取服务端数据。传给 Client Components 的应是可序列化的展示数据。

写操作由 Route Handler 编排；不要在 Server Components 中承担写操作，也不要把服务端专用依赖或对象传给 Client Components。

### Client Components

交互组件必须声明 `"use client"`。不得直接导入 `data/`、仅限服务端的 `storage/` 或 `security/` 模块。数据操作应经过以下边界：

```text
Client Component
  -> client API
  -> Route Handler
  -> server layers
```

## 3. 身份与分享

Owner 登录成功后获得 HMAC 签名、带到期时间的 HttpOnly Cookie。签名密钥来自独立的 `MEMORY_PALACE_SESSION_SECRET`，不再使用 Owner 密码摘要作为会话令牌。修改 Owner 密码会使已有会话失效。

分享支持链接访问和密码访问。新设置的分享密码使用带随机盐的 `scrypt` 保存；旧 SHA-256 值仅保留读取兼容，以便已有分享继续工作。密码分享通过独立的签名 Cookie 授权。

登录和分享密码入口使用进程内限流。该实现适合当前单实例部署；如果未来运行多个应用实例，需要将限流状态迁移到共享存储。

## 4. 媒体访问

图片只能经 `/media/...` Route Handler 读取：

1. Owner 会话可以访问 Owner 图片；
2. Visitor 必须携带对应分享 token；
3. 服务端确认分享已启用、Memory 未进回收站，并且图片确实属于该 Memory；
4. 密码分享还必须通过该分享的访问 Cookie。

媒体响应使用私有、禁止缓存策略，避免受保护图片被共享缓存长期保存。存储 key 会经过路径约束，不能跳出图片根目录。

界面使用原生 `img` 读取这些已在上传阶段优化过的 WebP。这样浏览器会携带访问 Cookie 直接请求受控媒体路由，避免 Next.js 图片优化代理丢失访问上下文。

## 5. 数据一致性与性能

多表写入使用 `withTransaction`，失败时整体回滚。Schema 为时间轴、Stage、Memory 图片、关联关系、Later Notes 和分享读取建立索引。Stage 书架预览和关联 Memory 使用批量查询，避免按条目重复访问数据库。

数据库和图片目录共同构成用户数据。备份必须同时包含 `palace.sqlite` 与 `images/uploads/owner`，并通过隔离恢复验证。

## 6. 质量门禁

```bash
pnpm check
```

该命令依次执行 TypeScript 检查、ESLint、测试和 Prettier 格式检查。`pnpm build` 仍是发布前必须执行的生产构建验证。

## 7. 当前保留边界

- V1 仍是单 Owner、单实例、本地 SQLite/文件存储。
- 尚未引入独立 Application Service 层；当前规模下由 Route Handler 与 Repository 保持清晰分工。
- 永久删除 Memory 时是否同步删除已上传原图/优化图，涉及数据保留策略，暂不在本轮质量整改中改变。
- 现有项目以幂等 Schema 初始化升级数据库；正式版本化迁移系统留给数据模型发生不兼容变化时处理。
