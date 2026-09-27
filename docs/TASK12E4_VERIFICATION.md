# Task 12E4 — Accept Invite

## 范围与设计

只实现接受 Invite Link 并成为 Collaborator；不实现 12E5 Museum Switcher 或后续内容授权。
复用已有 SQLite membership/invite 表、User session、同源保护及事务工具，无新增依赖或迁移。

- `src/data/invite-acceptance.ts`：验证邮箱、Own Museum、邀请有效性；原子创建/恢复成员关系并增加使用次数。
- `src/app/api/invites/accept/route.ts`：登录和同源检查、token 请求校验及统一错误响应。
- `src/app/invite/page.tsx`、`src/components/accept-invite-form.tsx`：完整邀请链接入口、接受状态及错误提示。
- `src/app/account/invites/page.tsx`：更新邀请使用条件说明。
- `tests/invite-acceptance.test.ts`：5 项接受邀请行为测试。
- `tests/same-origin.test.ts`：接受接口同样必须从 session 推导操作用户。

邀请 token 保持在 URL fragment，只有用户明确点击接受时通过 POST body 提交；不存入 localStorage/sessionStorage，不在服务端保存明文，也不返回 token/hash。成功后清除 fragment。
登录、注册与创建 Own Museum 在新标签页完成，原邀请页保留链接以便返回继续；不新增通用跳转参数或凭证暂存。

## 接口契约

`POST /api/invites/accept`

请求：`{ "token": "43-character-base64url-token" }`，用户身份来自 User session，不能指定 userId 或 role。

成功 200：`{ "museum": { "id": "...", "name": "...", "slug": "..." }, "alreadyMember": false }`。
已是 active Collaborator 时返回 `alreadyMember: true`，不重复创建、不增加次数，即使该链接已用满；过期/撤销/非 active Museum 仍拒绝。

错误沿用 `{ error: "CODE" }`：未登录 401、缺少 Own Museum 或未验证邮箱 403、token 格式错误 400、自己的邀请 409、未知/过期/撤销/用满邀请或非 active Museum 410。
已撤销的成员可通过仍有效且有剩余次数的邀请重新加入；复用原 membership 行，保留 created_at，更新 updated_at，消耗一次邀请次数。

`BEGIN IMMEDIATE` 在有效性检查前取得写锁，成员写入和次数写入同一事务提交或回滚，防止两个用户同时消耗最后一次额度。

## 验证记录（2026-09-26）

- RED：新增测试在接受服务不存在时失败；实现后 5 项针对性测试通过。
- `pnpm check`：typecheck、lint、173 项测试及 format:check 全部通过。
- `pnpm build`：生产构建通过，包括 `/invite` 与 `/api/invites/accept`。
- 隔离 Chrome + 临时 owner 数据库 + 3105 端口：页面成功接受、键盘 Enter 操作、成功清除 fragment；320/768/1024/1440 宽度无横向溢出，浏览器 console/pageerror 无错误或警告。
- 实际 HTTP 检查：未登录 401、异源/缺少 Origin 403、无 Own Museum 403、错误 token 类型 400、重复接受 200 且不重复计数、第二用户接受用满单次邀请 410。
- 数据库测试：过期、撤销、未知链接、非 active Museum、未验证邮箱、自己邀请拒绝；multi-use 多人/额度上限/恢复成员；模拟次数写入失败时两项写入一起回滚。
- 自查：参数化 SQL、服务端前置条件、固定 Collaborator 角色、无 token 日志/响应泄露、范围与现有行为边界保持；未发现当前阶段阻塞项。

未使用或修改真实账号和照片数据，临时测试数据库、测试服务和脚本已清理。
未提交、推送或部署；本阶段不宣称腾讯云已验收，也不进行真实邮件发送验收。

## 验收结论与边界

12E4 前置条件及五项验收标准满足。既有照片/Memory/Stage 和 legacy Owner 授权未改变。
加入成功表示 membership 已建立；Museum 切换和协作者内容访问留给相应后续阶段，当前不提前开放。
