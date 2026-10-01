# Task 12F2 — Memory API Scope 验证

完成日期：2026-09-27。仅完成 F2，未开始 F3，未提交、推送或部署；未修改真实用户数据。

## 完成内容

- Memory API 使用可信 User session 和明确的 Museum scope。未指定 Museum 时默认用户自己的 Museum；客户端传入的 userId 不参与授权。
- 创建、读取、列表、搜索、随机回忆、编辑、回收站及恢复接入 scope；跨馆或无归属 Memory ID 返回 404，不使用 ID 反推权限。
- Collaborator 可以创建、编辑、移入回收站和恢复；永久删除仅限 Owner。旧馆长 cookie 不能绕过 Memory 的 User session 授权。
- 写入授权、成员状态检查及业务修改在同一事务中执行；现有仓库函数通过 savepoint 嵌套，不提前提交外层事务。
- Memory 绑定的 Stage、Photo、关联 Memory 必须同馆；读取隐藏错误归属的附属记录，写入拒绝已有跨馆绑定，不重新归属外馆数据。
- 批处理保留原有逐项成功/失败结果，外馆 ID 不会修改外馆数据。
- Memory 页面和相关客户端请求保留所选 museumId；成员退出或被移除后，下次请求立即被拒绝。

## 主要文件

- 授权与业务：`src/data/memory-access.ts`、`src/data/scoped-memory.ts`、`src/memory-request-scope.ts`、`src/memory-page-scope.ts`。
- 数据读写与事务：`src/data/memory-repository.ts`、`src/data/memory-write-repository.ts`、`src/data/management-repository.ts`、`src/data/transaction.ts`。
- HTTP：Memory 路由、Museum 下的 Memory 创建路由、Recall 和 Trash 的 Memory 分支。
- 界面接线：首页、Memory 详情/创建、搜索、回收站、Museum 入口、相关 Memory 客户端及卡片组件。
- 回归测试：`tests/memory-access.test.ts`、`tests/memory-create-scope.test.ts`、`tests/scoped-memory.test.ts`、`tests/same-origin.test.ts`。
- 运行时验收：`scripts/verify-memory-scope.mjs`。

## 验证结果

- `pnpm check`：TypeScript、ESLint、196 项测试及格式检查全部通过。
- `pnpm build`：生产构建成功。
- 最终构建上的真实 HTTP 验收通过：匿名、非成员、跨馆 ID、跨站写入、旧馆长 cookie、创建绑定、读写/搜索/随机回忆、混合馆批处理、协作者恢复、Owner 永久删除、权限撤销及待删除 Museum。
- Chrome 验收通过：协作者打开选中 Museum 的 Memory，修改标题并保存；实际请求成功、数据持久化，页面及控制台无错误。
- 验收脚本使用临时 SQLite、合成账号与 session、独立端口和生产服务，结束后清理临时服务及数据。可在构建后运行 `node --experimental-strip-types scripts/verify-memory-scope.mjs`；浏览器验收需通过 PALACE_TEST_PLAYWRIGHT 和 PALACE_TEST_CHROME 指定现有运行环境，不新增项目依赖。
- `git diff --check` 通过。代码审查未发现 F2 Memory API 验收范围内的未解决阻断项；SQL 使用参数绑定，动态表名来自固定集合，没有新增依赖或迁移。

## 范围边界与后续事项

- F2 验收标准“跨 Museum 的 Memory ID 访问失败”已满足。公开展览的既有访客只读行为保留，不等同于成员 API 授权。
- Stage 的独立 API 尚未切换（F3）；Photo/Upload/Workspace、独立照片库及私有媒体访问尚未完整切换（F4）；Share 与其他次级关系的独立入口属于后续阶段。
- Memory 编辑器的照片库分页/筛选仍依赖旧 Photo API；用户 session 的协作者照片选择与私有图片显示尚不能视为完整可用。本次浏览器验收为文字 Memory，不包含照片上传或私有媒体验收。
- 现有照片库关联元数据仍使用旧查询链路，需在 Photo scope 阶段统一处理，不将 F2 通过当作全站多租户安全完成。
- 生产内容须完成既定归属迁移后使用新的成员授权；未迁移的无归属 Memory 不通过成员 API 暴露。
