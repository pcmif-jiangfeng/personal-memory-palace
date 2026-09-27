# Task 12F4 — Photo / Workspace Scope 验证

日期：2026-09-27。完成新上传及照片工作区的 Museum scope 接入；历史文件物理迁移尚未执行，因此不能宣称所有历史照片都已完成物理隔离。未开始 F5，未提交、推送、部署或修改真实用户数据。

## 修改总结

- Photo API、照片库、Workspace 与 Memory 的照片候选查询使用可信 User session 和服务端 Museum membership。Museum 条件在分页之前进入 SQL；照片使用数量、Memory 标题和 Stage 筛选均限制在本馆。
- 新上传使用 `uploads/museums/<museumId>/optimized/<photoUuid>.webp`，上传日志和照片记录写入相同 Museum。复用现有图片内容检查、WebP 处理和上传恢复机制；异步保存结束后再次检查权限，撤销成员不会留下可访问的照片记录。
- 私有原图、缩略图和预览按实际照片归属授权；Museum 进入 pending_deletion 后不再提供媒体。公开展览和已有分享媒体保持只读行为，但不能绕过照片存在、生命周期和物理路径归属检查。
- 协作者可以上传与归档，照片永久删除仅限 Owner。跨馆 ID、安全检查失败或异常跨馆引用均拒绝；批量删除保留逐项成功/失败语义。删除重试队列也必须属于当前馆，不能用异常队列覆盖已授权照片的删除目标。
- 上传队列启动时固定目标 Museum，避免页面切换导致后台任务投递到其他馆。照片选择、创建 Memory、照片库返回和章节管理链接保留 Museum；界面视觉与上传体验未重写。

## 文件范围

- 新增 `src/storage/photo-storage-key.ts`：Museum 物理键生成与格式约束。
- 新增 `src/data/photo-access.ts`：照片归属、成员权限、归档和媒体可用性检查。
- 新增 `src/application/scoped-photo-upload.ts`：复用上传服务，绑定 Museum 日志、文件键与提交。
- 修改 `src/data/photo-repository.ts`、`src/data/photo-deletion-service.ts`、`src/application/photo-upload-service.ts`、`src/storage/local-image-storage.ts`：查询、上传、删除及预览缓存适配。
- 修改 Photo API、Media Route、Workspace、Memory 创建/详情页、账号馆入口和对应客户端/组件：传递 scope，修正候选分页和后台任务目标。
- `src/data/publication-repository.ts`、`src/data/share-repository.ts` 的本次修改仅加强媒体读取的照片关联检查，不代表完成 Share scope。
- 新增 `tests/scoped-photo.test.ts`；扩展同源检查和 `scripts/verify-memory-scope.mjs`。

## 验证结果

- 7 项 Photo scope 回归测试覆盖查询隔离、归档/删除权限、异常删除队列、媒体生命周期、上传中撤权与恢复、固定任务目标、物理路径约束。异常删除队列测试先复现失败，再通过最小授权修复。
- `pnpm check`：TypeScript、ESLint、207 项测试和格式检查通过。
- `pnpm build`：生产构建成功。
- 最终生产 HTTP 验收：真实图片上传成功；文件落在各自 Museum 目录；原图、缩略图和预览读取正常；非法图片、跨站请求、跨馆上传/归档/删除拒绝；照片库筛选、选照片创建 Memory、使用中照片保护、混合馆批量删除、撤销成员与 pending_deletion 拒绝均通过。
- Chrome 验收：上传图片并显示缩略图，选择照片创建 Memory，协作者永久删除入口禁用，Museum 导航与 Memory/Stage 编辑回归通过；页面及控制台无错误。
- `git diff --check` 通过。验收使用合成账号、临时数据库、独立生产服务及隔离浏览器 context，结束后清理；未新增依赖。

复现：先构建，再执行 `node --experimental-strip-types scripts/verify-memory-scope.mjs`。可通过 `PALACE_TEST_PLAYWRIGHT` 与 `PALACE_TEST_CHROME` 指定已有浏览器测试环境；未指定时只运行 HTTP 验收。

## 代码审查与行为边界

依据 code-review-and-quality 检查正确性、职责、权限、回归与查询成本。修正了导航丢失 Museum 和异常删除队列授权问题。SQL 输入参数绑定；文件键由服务端生成；写授权与数据库写入共享事务；保持现有依赖及恢复机制，无无关重构。

明确行为变化：旧馆长 cookie 不再授予照片管理权；成员使用 User/Museum 权限。私人媒体不再因另一个馆的 Owner 身份而可访问。

历史文件迁移代码已在后续收尾补齐：`scripts/migrate-photo-storage.ts` 默认只检查，显式停写执行时自动备份、复制校验文件并事务更新照片及展品/封面引用。`scripts/backup.mjs` 已改为备份整个 uploads 树，避免遗漏 Museum 文件；新增两个类型声明及 `tests/photo-storage-migration.test.ts`。迁移前回滚和迁移后 Museum 目录备份恢复均在隔离数据上验收。使用方式见 [历史照片迁移指南](PHOTO_STORAGE_MIGRATION.md)。

收尾验证：5 项新增迁移测试通过；完整 `pnpm check` 的 TypeScript、ESLint、212 项测试和格式检查通过；生产构建通过。审查补充了数据库路径验证、符号链接拒绝及原图与优化图的同源 UUID 检查；零待迁移照片不要求图片目录存在。最终 HTTP/Chrome 的上传和 Museum 权限回归也通过。

真实运行边界：历史 `uploads/owner`、`uploads/demo` 文件没有在本地真实数据或腾讯云上自动移动，仍通过数据库归属受控读取。代码和测试支持历史物理迁移，不等同于真实服务器已经迁移。真实迁移后仍保留旧文件作为回滚副本，不在本阶段删除。

F5 的 Trash/Share/Secondary Relations 独立入口尚未处理，本记录不代表整个 Task 12 或全站多租户安全已完成。
