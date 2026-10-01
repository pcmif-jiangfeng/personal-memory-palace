# Personal Memory Palace 当前架构

本文描述当前代码的实际边界，不是未来路线图，也不表示这些功能已经在生产环境完成部署或验收。产品体验仍是通过照片和文字重新遇见过去的数字人生博物馆。

## 1. 运行结构与请求链路

项目是支持多 User、多 Museum 的单体 Next.js App Router 应用，使用 Node.js、SQLite 和本地图片文件存储。Docker 镜像与持久化数据分离，数据库、上传图片和备份通过宿主机目录挂载保留。当前部署形态是单实例；多用户不等于多进程或微服务。

```text
Browser / Client Component
  -> Client API
  -> Route Handler
  -> Scope / Access Resolution
  -> Application / Use-case Orchestration
  -> Repository / Storage / Email
  -> SQLite / Filesystem / Email API
```

不要求所有请求经过全部层次。复杂跨资源操作使用 Application orchestration；简单查询可在完成授权后直接进入 Repository。Server Components 可以执行授权后的服务端读取，交互写入经 Route Handler 进入服务端用例。

## 2. 代码与运行时边界

- `src/app/`：页面、Route Handler 和受控媒体读取入口。
- `src/components/`：展示和交互；Client Components 不直接操作 SQLite 或文件系统。
- `src/client/`：浏览器请求与响应处理；上传保留自身的任务生命周期，不强行统一为普通 JSON 请求。
- `src/http/`：输入解析、runtime validation 与 HTTP 错误映射。
- `src/application/`：轻量用例编排，协调 Repository、Storage、权限、配额与审计。
- `src/data/`：Schema、版本化迁移、SQL 查询、持久化、row decoding 和事务基础设施；同时仍保留部分 scoped/lifecycle 用例编排。
- `src/security/`、`src/user-auth.ts` 与 `src/data/*-access.ts`：会话、限流、用户身份及馆内资源授权。
- `src/storage/`：图片校验、处理、路径约束、文件读写、复制与清理。
- `src/email/`：验证邮件、找回密码及博物馆通知的事务邮件边界。
- `src/domain/`：共享模型和业务规则。
- `src/config.ts`：数据集、数据目录、会话及平台管理员等运行配置解析；邮件配置由邮件模块解析。

Server Components 只向 Client Components 传递可序列化展示数据，不传递数据库连接或服务端存储对象。交互组件声明 `"use client"`，不得导入仅限服务端的 Data、Storage 或 Security 依赖。后台维护入口位于 `scripts/`，不以普通页面渲染触发迁移或永久清理。

## 3. 身份模型与 Museum scope

### User、Owner、Collaborator 与 Platform Admin

- User 使用邮箱账户和已验证的用户会话。馆内授权会再次检查数据库中的邮箱验证状态。
- Museum 的当前馆长由 `museums.owner_id` 确定，不依赖一条 Owner membership 记录。一馆有一个当前馆长；馆长转移后，同一 User 可以拥有多个 Museum。
- Collaborator 依赖 `museum_memberships` 中有效的协作者关系；撤销、退出或馆状态变化会影响后续授权。Invite 是建立成员关系的机制，不等同于直接取得任意馆内资源权限。
- Platform Admin 是服务器配置指定的单个已验证 User。平台权限用于用户/博物馆元数据和配额管理，不自动授予 Museum membership 或私人内容访问权。
- 旧馆长登录仍作为兼容入口保留。旧 Owner Cookie 与邮箱 User 会话是两套身份，旧登录状态不能替代新版 Museum-scoped 操作需要的 User 授权。

### Scope 与资源绑定

```text
User identity
  -> Museum selection
  -> Current ownership / active membership
  -> Resource bound to the same museum_id
  -> Operation-specific permission and lifecycle state
```

请求 scope 的实际入口是 `src/memory-request-scope.ts`，不是 `src/http/memory-request-scope.ts`。它从当前会话取得 User，解析所选 Museum，并调用 `requireMuseumAccessInDatabase`；未显式选馆时查询该 User 拥有的馆。客户端提交的 `museumId` 只是选择，不是授权证明。

Museum-scoped 访问必须同时检查用户身份、馆访问资格和资源绑定，不能只凭资源 ID。`memory-access.ts` 按 `id + museum_id` 检查 Memory；`photo-access.ts` 检查照片记录及物理存储 key。关联 Stage、Photo、Later Note 和 Memory relation 也必须保持相同馆归属。

Owner 和 Collaborator 可按现有规则编辑、移入回收站和恢复 Memory；永久删除 Memory 仅限 Owner。处于 `pending_deletion` 的馆长保留生命周期管理资格，但不能继续普通内容写入。权限结果不是可长期复用的授权令牌：写入事务内、异步文件操作后的提交前都需要按当前状态重新校验。

## 4. 轻量 Application Layer 与现有编排

项目已存在轻量 Application Layer，不使用统一 BaseService、DI Container 或强制所有 CRUD 经过 Service 的体系。

当前用例包括：

- `src/application/photo-upload-service.ts`：协调优化图校验、上传任务登记、文件保存与照片记录提交。
- `src/application/scoped-photo-upload.ts`：在上传流程中接入 Museum 授权、容量预留、落盘计量、提交时重新授权及审计。
- `src/application/cross-museum-photo-copy.ts`：协调源/目标馆权限、独立目标文件、配额、任务日志、照片记录和审计。
- `src/application/cross-museum-memory-copy.ts`：复用照片复制生命周期，并在最终事务中创建目标 Memory、展品和后记，检查源 Memory 版本。
- `src/application/permanent-museum-deletion.ts`：协调停止写入、备份验证、删除日志、物理文件清理及数据库收尾。

`src/data/scoped-memory.ts` 等文件当前也包含权限、多个持久化操作、版本冲突处理及审计的业务编排。这是现有实现事实，不意味着 Data 层只有原始 SQL，也不要求为了目录一致性立即搬文件。新增或实质修改跨 Repository / Storage / Audit / Access 的用例时，应评估 Application 边界；简单查询和单一持久化操作不需要额外包装。

### Application / Data 归属规则

本节是层间归属规则的唯一维护入口，开发约束引用它，不另建重复的 Boundary 文档。

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Application | 跨 Repository / Museum 编排，Access + Mutation + Audit，DB + Storage 协调，复制、转移、迁移、永久删除及复杂事务用例 | 强制包装单表 CRUD；建立通用 Service 框架 |
| Data | SQL、Repository 查询、单一聚合持久化、Primitive Mutation、Row Decoding、Read Model、事务原语 | 为新增跨资源用例隐式承担无边界的编排 |
| HTTP | Request Parsing、Runtime Validation、Same-Origin / CSRF / Auth 入口、HTTP Response Mapping | 把请求中的资源 ID 当作授权结果；编排文件系统生命周期 |
| Security / Access | Identity、Museum Access、Resource Authorization、Role Checks | 替代 Repository 持久化或 Application 用例 |

`scoped-memory.ts`、`museum-owner-transfer.ts`、`museum-deletion.ts`、`museum-permanent-deletion.ts` 不立即移动。下次真正修改这些用例时，结合独立变化原因和事务归属再判断迁移；迁移必须减少理解成本，而不是只换目录。当前热点及触发条件见 [编排边界盘点](refactor/application-boundary-inventory.md)。

## 5. 一致性、审计、配额与清理

数据库事务由 `withTransaction` 提供：顶层使用 `BEGIN IMMEDIATE`，嵌套操作使用 savepoint；失败时回滚对应数据库修改。Memory 写入把资源权限、版本比较、关联变更与审计放在同一事务中，旧版本提交会返回冲突而非覆盖新内容。

文件系统和邮件 API 不属于 SQLite 事务，不能把数据库回滚视为文件或邮件回滚。上传和复制使用 `pending_uploads` 记录未完成文件操作；照片删除使用 `photo_deletion_jobs` 保留可重试清理任务。失败后的恢复由维护入口处理，不能通过直接清空任务表假装完成。

以下能力已经属于当前系统，而不是未来规划：

- **Audit**：记录操作者、Museum、操作对象和必要差异；关键数据库变更与对应审计在同一事务内提交。
- **Storage quota**：按 Museum 管理配额、实际文件用量和上传预留；上传与跨馆复制都需要检查目标馆容量。0 配额不是无限容量，旧馆接管历史文件后还需完成用量重算。
- **Cross-Museum copy**：同时检查源馆和目标馆，创建目标馆自己的文件与记录，不直接复用另一馆的物理 key。
- **Permanent deletion**：Memory/照片永久删除与整馆删除是不同生命周期。整馆永久删除要求停止所有写入者、创建并验证备份、保留可重试删除日志，再协调物理清理和数据库收尾。
- **Storage cleanup / notification**：清理失败保留任务；生命周期通知经邮件边界发送，不将外部邮件调用当作数据库原子操作。

## 6. 图片存储与访问

新馆照片以 Museum 隔离，优化图采用 `images/uploads/museums/<museumId>/optimized/<photoId>.webp`；可选原图使用同馆 `original/` 目录。历史 `uploads/owner/` 和 `uploads/demo/` 路径仍有兼容读取与独立迁移入口，不表示所有线上文件已经完成物理迁移。

图片经受控 `/media/...` 入口读取，不直接把持久化图片目录暴露为静态公共目录。用户读取需要馆内及照片资源授权；访客通过现有公开/分享规则取得有限读取资格，不因此获得协作者或写入权限。分享令牌、密码访问 Cookie 与 User 登录会话是不同授权上下文。

存储 key 必须满足路径约束并与资源馆归属匹配。界面使用原生 `img` 读取受控图片，以保留浏览器的访问 Cookie；优化图是上传资产，派生缓存不是原始用户数据的替代品。

## 7. 版本化迁移、备份与恢复

`src/data/database.ts` 先执行基础 Schema 初始化，再调用 `runDatabaseMigrations`。当前已使用 `schema_migrations` 驱动的版本化迁移，`src/data/migrations.ts` 包含版本 1–26：

1. 按数组中的递增版本顺序检查迁移，跳过已记录的版本。
2. 每个迁移及其 `version / applied_at` 记录在同一个事务内提交。
3. 迁移失败时回滚该版本，不能留下已成功应用的假记录。
4. 后续 Schema 变化追加新版本，不修改已经执行过的历史迁移。

Schema 迁移不会自动猜测旧 Owner 内容归属，也不自动完成照片物理路径迁移。旧数据接管、历史文件迁移和容量重算有各自的维护步骤，必须结合一致性备份与隔离恢复检查。

数据库和实际上传文件共同构成用户数据。备份必须覆盖 `palace.sqlite` 与整个 `images/uploads/`，包括各 Museum 文件、仍保留的 legacy 文件和可选原图，不能只备份 `images/uploads/owner/`。含密钥的配置也需要按私密备份流程保留。

正式操作遵循 [部署说明](DEPLOYMENT.md)、[备份与隔离恢复 SOP](MIGRATION_BACKUP_SOP.md) 和 [Legacy Owner 归属迁移 runbook](PRODUCTION_OWNER_MIGRATION_RUNBOOK.md)。当前迁移实现没有通用自动降级机制；回退应用镜像不能代替数据库和文件的恢复，回滚前还需评估备份之后的新写入。

## 8. 验证与维护边界

`pnpm check` 是现有综合门禁，包含 TypeScript、ESLint、测试与格式检查；`pnpm build` 用于生产构建验证。日常窄范围维护按任务选择相关测试与 typecheck，不因文档修改运行全量测试、浏览器或构建。

当前架构不引入 ORM、通用 CRUD 框架或微服务。已存在的 Application 编排和 Data 层混合用例按真实业务变化维护，不按文件行数批量拆分；稳定交互组件不因文档同步继续重构。
