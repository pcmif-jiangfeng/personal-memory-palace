# Task 12F3 — Stage API Scope 验证

完成日期：2026-09-27。仅完成 F3，未开始 F4；未提交、推送、部署或修改真实用户数据。

## 实现范围

- Stage read/create/update/delete/restore 接入 Museum scope，沿用 F2 的可信 User session、默认 Own Museum 和显式 museumId 选择规则。客户端 body 的 userId 不参与授权。
- 协作者可以创建、编辑、设置公开状态、移入回收站和恢复；永久删除仅限 Owner。所有写操作先检查同源，授权和资源写入在同一事务内完成。
- 跨馆、无归属、未知及错误状态的 Stage ID 均拒绝访问；退出协作或 Museum 进入 pending_deletion 后，后续内容请求被拒绝。
- Stage 封面必须来自本馆，stage_covers 写入本馆归属。错误归属的封面不通过成员或旧公开读取路径返回；已有外馆封面或 Memory 绑定会阻止修改，避免连带更新或删除外馆资源。
- 删除 Stage 仍保留原行为：本馆 Memory 留存并变成未归类；私人 Stage 下的 Memory 不会因删除章节意外变成公开。
- Stage 管理页、详情、回收站与首页章节链接接入选中 Museum；页面不再使用旧馆长 cookie 获取 Stage 编辑权。
- Stage 封面候选仅查询本馆照片，避免逐张额外查询。该只读候选接线不等同于完成 Photo/Upload/Workspace 的迁移。

## 修改文件

- 新增 `src/data/scoped-stage.ts`：Stage 权限、资源状态及绑定检查，复用原仓库操作。
- `src/data/stage-repository.ts`：注入数据库及 Museum 归属，保留现有输入规则与内部默认调用。
- `src/data/memory-repository.ts`：新增 scoped Stage 查询、注入式详情查询；统一 Stage 封面归属读取规则。
- `src/data/photo-repository.ts`：照片候选查询增加可选 Museum 条件，原有调用默认行为不变。
- `src/app/api/stages/route.ts`、`src/app/api/stages/[id]/route.ts`、`src/app/api/stages/[id]/publication/route.ts`：Stage 读写路由授权接入。
- `src/app/api/trash/route.ts`：Stage 批处理接入 scope，保留逐项成功/失败返回格式。
- Stage 页面、首页、Trash 页面，Stage 客户端、章节卡片、删除入口及 TrashManager：传递 Museum 目标和永久删除权限。
- 新增 `tests/scoped-stage.test.ts`；更新 `tests/same-origin.test.ts` 与 `scripts/verify-memory-scope.mjs`。

## 验证结果

- RED：新增 Stage scope 测试先因模块缺失失败；公开读取的外馆封面回归测试正确复现问题。
- GREEN：4 项 Stage SQLite 测试全部通过，包括生命周期、跨馆拒绝、封面归属、权限撤销、错误关联无写入、保留 Memory 和安全照片删除队列。
- `pnpm check`：TypeScript、ESLint、200 项测试、格式检查全部通过。
- `pnpm build`：生产构建成功。
- 真实生产接口验收通过：匿名401、非成员404、跨馆404、跨站403、错误封面400、创建201并写入归属、编辑与公开状态、回收站恢复、混合馆批处理、Owner-only 永久删除、旧馆长 cookie 无法越权、成员撤销及 pending_deletion 拒绝。F2 Memory 接口回归也通过。
- Chrome 验收通过：协作者保存 Stage 标题，数据库内容持久化；从首页点击章节卡片进入正确 Museum 的详情，页面及控制台无错误。截图已检查，原有展厅视觉保持。
- 运行时脚本使用临时 SQLite、合成账号和 session、独立端口、生产启动及隔离 Chrome context；结束后清理临时服务和数据，无新依赖。
- 最终局部 Memory/Stage 10 项测试及最终构建的 HTTP/Chrome 验收再次通过，`git diff --check` 通过。

复现：构建后执行 `node --experimental-strip-types scripts/verify-memory-scope.mjs`。浏览器检查可通过 PALACE_TEST_PLAYWRIGHT 和 PALACE_TEST_CHROME 指定已有 Playwright 模块与 Chrome 路径；不设时仅执行 HTTP 验收。

## 代码审查结论

F3 范围内未发现未解决的阻断项。SQL 参数绑定；Museum 身份来自服务端 session；写权限与业务修改共享事务，复用 F2 的嵌套 savepoint；封面和 Memory 的错误归属先拒绝，不自动重新归属或删除。未新增迁移或依赖，未重写 Stage 交互。

## 后续边界

- Photo/Upload/Workspace、照片物理路径隔离和私有媒体的用户权限适配属于 F4，本次未验收上传或私有图片显示。
- Share 及其他独立次级入口属于后续阶段；不能把 F3 通过视作整个 Task 12 或全站多租户安全完成。
- 公开访客保持现有只读展览行为；已登录成员操作切换为 User/Museum 权限。旧数据必须完成既定归属迁移，未迁移 Stage 不暴露给成员接口。
- 旧内部仓库调用仍保留，未用于 Stage HTTP 授权；真实历史数据中的错误跨馆绑定需独立调查修复，本阶段安全拒绝，不自动清洗。
