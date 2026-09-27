# Task 12F6 — IDOR / Cross-Museum Security Tests

完成日期：2026-09-27。仅新增测试和验收文档，没有生产代码、产品行为、数据库 schema 或依赖修改。未开始 G1，未提交、推送、部署或修改真实用户数据。

## 修改文件

- `tests/cross-museum-security.test.ts`：4 组真实 SQLite 安全矩阵，分别验证本馆 Owner、同时加入两个馆的协作者、非成员和被移除成员。
- `scripts/verify-memory-scope.mjs`：扩展现有隔离生产服务验收，在真实 HTTP 路由上运行同一权限矩阵，并测试伪造请求体身份、分享 token 篡改及数据快照不变。
- 本文档：记录范围、证据和访客授权边界。

## 验收覆盖

| 边界 | 拒绝操作及验证 |
| --- | --- |
| Memory ID | 读取、更新详情、追加 Later Note、移入 Trash 的外馆 ID 拒绝 |
| Stage ID | 读取、更新/公开状态及删除的外馆 ID 拒绝 |
| Photo ID | 外馆归档及永久删除拒绝，存储删除函数不能被调用 |
| Share resource | 配置或关闭分享时替换 Memory ID 拒绝；伪造分享 token 的页面404、密码访问401 |
| Trash resource | 对外馆真实已删除 Memory/Stage 执行恢复或永久删除无成功项；非成员/被移除成员直接404 |
| 非成员与撤权 | 对本馆真实存在且状态匹配的资源拒绝，而不是只用不存在的 ID 证明404 |
| 双馆成员 | 同时有两个馆的 membership，也不能在 Museum A 的管理请求中操作 Museum B 的资源 |
| 伪造身份 | 请求体声称目标馆 Owner 的 userId 和目标 museumId，不能覆盖真实 session 与 URL scope |
| 数据完整性 | 所有拒绝请求前后比较两馆10张业务表；内容、照片、分享、关联和文件任务队列完全不变 |

测试使用真实 schema、用户、Museum、membership、资源和现有授权函数，没有 mock 权限判断。断言要求 ApiError 的403/404或明确 HTTP 状态，普通异常不能满足拒绝条件。API 批处理返回200时另行检查 succeededIds 为空及逐项错误，不把200误当成授权成功。

## 验证结果

- 新增4组 SQLite 矩阵通过；当前实现没有触发需修复的新业务漏洞，因此没有为了制造 RED 而改坏生产代码。
- `pnpm check`：TypeScript、ESLint、220 项测试和格式检查全部通过。
- 最终脚本局部 ESLint、格式整理与 `git diff --check` 通过。
- 真实 HTTP 安全矩阵通过，包含完整业务表快照比较；伪造 Owner/目标 Museum 请求体不能越权，未知分享 token 被拒绝。
- Chrome 回归通过：图片上传、缩略图、选照片创建 Memory、Memory/Stage 编辑与 Museum 导航正常，页面及控制台无错误。
- 生产服务启动成功。复用 F5 已通过的生产构建；本轮生产源码和依赖没有变化，没有重复构建。
- 验收使用临时数据库、合成账号、独立端口和隔离浏览器 context，结束后清理服务和数据。新单元测试使用内存 SQLite，结束后关闭数据库。

复现：`node --experimental-strip-types --test tests/cross-museum-security.test.ts`；真实接口验收在有当前生产构建后执行 `node --experimental-strip-types scripts/verify-memory-scope.mjs`。浏览器模式复用 PALACE_TEST_PLAYWRIGHT / PALACE_TEST_CHROME；未指定时仅执行 HTTP。

## 审查结论与边界

依据 test-driven-development 的仓库测试约定及 code-review-and-quality 核对断言、正负访问边界、真实状态、重复运行和清理。F6 要求的未授权跨馆管理与私人内容访问均被服务端拒绝；未发现阻断项，产品行为没有变化。

合法访客授权不等于管理权：有效的公开分享链接保持原有访客访问行为，不应因访问者不是成员就判为 IDOR。双馆成员能凭其 Museum B 的有效成员身份读取 B 的私人媒体，这是合法授权；测试要求 A 的管理 scope 不能替代 B 的资源 scope。被移除成员仍不能管理或读取私人内容，但有效公开分享不会因某个成员退出自动关闭。

未完成事项不在本阶段范围：G1 及后续阶段未开始；真实历史照片物理迁移仍需按 F4 指南停写执行，未自动执行；没有将本次矩阵通过表述为整个项目或所有未来入口都已完成安全验收。
