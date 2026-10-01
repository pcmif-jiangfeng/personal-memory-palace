# Task 12F1 — 统一 Museum 授权 Helper

## 范围与文件

- `src/data/museum-access.ts`：数据库授权规则、MuseumAccess 类型，以及 `requireMuseumAccessInDatabase(database,userId,museumId)` / `requireMuseumOwnerInDatabase(database,userId,museumId)`。
- `src/museum-auth.ts`：面向服务端请求的 `requireMuseumAccess(museumId)` / `requireMuseumOwner(museumId)`，通过 `currentUser()` 获取身份，只允许调用者传目标 Museum ID。
- `tests/museum-access.test.ts`：7 项真实 SQLite 与 User session 集成行为测试。

只新增 helper 和测试；没有修改业务 API、UI、legacy Owner 密码认证、Invite、Audit、schema、迁移或依赖。

## 授权契约

返回 `{ museumId, userId, role, status }`，不包含邮件、密码、session/token、Museum 内容或存储信息。

- Owner 只由 `museums.owner_id` 决定，不依赖 membership 的存在或状态。
- Collaborator 必须是该 Museum 的 active collaborator membership，且 Museum 为 active。
- 未登录或不存在的用户：`USER_REQUIRED` / 401。
- 底层 helper 接收未验证用户时：`EMAIL_VERIFICATION_REQUIRED` / 403。请求包装入口只使用现有 session helper 返回的已验证用户，未验证/过期/无效 session 均按未登录拒绝。
- 非成员、已 revoked、其他 Museum、未知 Museum：统一 `MUSEUM_NOT_FOUND` / 404，不泄露资源存在性。
- 有访问资格的 Collaborator 请求 Owner 权限：`MUSEUM_OWNER_REQUIRED` / 403。
- pending_deletion Museum 只向 Owner 返回生命周期访问资格，返回 status 为 pending_deletion；协作者 404。不认识的 Museum 状态一律拒绝，包括 Owner。

授权 helper 是当前身份和状态检查，不是业务操作许可，也不是可长期保存的授权 token。
后续业务接入必须：从可信 session 获取用户；服务端确定目标 Museum；在该 Museum 内查询资源 ID；按操作检查角色和 status；写入场景将授权检查与资源写入放在同一事务中。尤其 pending_deletion 的 Owner 资格用于生命周期管理，不等于可以继续普通内容写入。
底层 `InDatabase` 参数 userId 只能来自可信服务端代码，不能使用客户端 body/query 中的身份；HTTP 入口优先使用 `src/museum-auth.ts` 包装。

每次调用查询当前数据库，不缓存 Owner 或 Membership 判定；退出、撤销或所有权变化在下一次检查生效。
SQL 使用参数绑定；未知 ID 和注入字符串不会绕过授权。

## 验证（2026-09-26）

- RED：新增测试在 helper 不存在时失败；实现后 7 项通过。
- 测试覆盖：无 membership Owner、revoked Owner membership 不影响权威 Owner、Collaborator 不可提升为 Owner、匿名/未知/未验证用户、非成员/跨馆/未知与注入 ID、退出后的即时失效、pending_deletion、未知状态、所有权变化后的即时判定、真实 hashed User session 有效/过期/未验证身份。
- `pnpm check`：typecheck、lint、184 项测试及 format:check 全通过。
- `pnpm build`：生产构建通过。
- `git diff --check`：通过。
- 自查未发现当前阶段阻塞项：权限来自可信身份与数据库状态，错误不泄露 Museum 信息，返回上下文最小化；无新增依赖、复杂架构或无关修改。

本阶段没有 UI 或业务路由接入；未新增浏览器流程或临时测试服务，也未宣称请求包装已通过业务 API 端到端验收。数据库授权和 session 组合在 Node 测试运行时得到验证，包装入口通过类型检查与构建。

## 交付与后续边界

12F1 完成：统一服务端入口已建立，未一次性改造业务 API。
Memory scope 接入留待 12F2；Stage、Photo、媒体等分别留待其对应阶段。现有接口行为保持不变，完整 Museum 内容隔离尚未完成。
没有修改真实数据；未提交、推送或部署。真实邮件发送继续按此前要求留待验收。
