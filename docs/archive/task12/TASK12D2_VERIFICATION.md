# Task 12D2 — Slug 管理

## 修改文件

- `src/app/account/page.tsx`：在 Own Museum 页面提供馆址修改入口。
- `src/components/museum-slug-form.tsx`：保存状态、成功提示、馆址冲突提示与无障碍标签。
- `src/app/api/museums/route.ts`：新增 `PATCH /api/museums`，只更新登录 User 的 Own Museum。
- `src/http/museum-slug.ts`：创建和修改共用的馆址校验，以及修改请求解析。
- `src/http/museum-onboarding.ts`：复用馆址校验，不改变原有建馆范围。
- `src/data/museum-slug.ts`：按会话所有者更新馆址，保留 Museum ID 及所有关联。
- `tests/museum-slug.test.ts`：输入、冲突、权限边界、无变化请求及关联完整性回归测试。

## 设计与契约

- 馆址为 1–64 个字符，仅小写英文字母、数字和分隔单词的单个连字符；例如 `my-memory-palace`。
- 现有 SQLite 大小写不敏感唯一约束仍是全局唯一性的最终保障，无数据库迁移。
- PATCH 请求仅接受 `slug` 的修改；客户端传入的 `museumId`、`ownerId` 不参与授权。
- 成功返回 `{ id, slug }`；非法输入 400、未登录 401、跨站 403、未建馆 404、馆址冲突 409。
- 修改仅更新 `slug`、`version` 与 `updated_at`；提交相同馆址为无变化操作。
- 不新增旧馆址 redirect、自定义域名、公开 Museum 路由、名称/简介/封面设置、协作或邀请功能。

## 验证（2026-09-26）

- 新测试在实现前失败，实现后通过。
- `pnpm check` 通过：157 项测试全部成功，typecheck、lint、格式检查通过。
- `pnpm build` 通过，隔离生产服务器启动成功。
- 最终补充关系测试后，5 项馆址/建馆针对性测试以及 typecheck、lint 再次通过。
- 修改前后，10 张 Museum 关联表的行完全相同，`PRAGMA foreign_key_check` 无异常；历史大写馆址也阻止大小写冲突。
- 隔离 HTTP 测试验证 401/403/400/404/409，并确认伪造另一 Museum ID 不会修改对方。
- 隔离 Chrome 验证登录、保存、刷新持久化、冲突提示及失败后原馆址不变；无未捕获异常，成功流程无控制台错误/警告，冲突请求的 409 为预期结果。
- 320/768/1024/1440 宽度无横向溢出；输入框到保存按钮的键盘焦点顺序通过，截图已检查。
- 测试数据库与服务器由临时脚本自动清理；临时脚本、补丁和截图已移除，没有使用生产数据。

## 自查结论

本次改动满足 12D2：全局唯一、可修改、内部关系继续使用 Museum ID、修改不影响关联数据。SQL 参数化，所有者由现有验证会话确定，错误响应不泄露内部信息，无新增依赖或本次改动的阻断问题。到此停止，12D3 未开始。
