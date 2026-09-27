# Task 12E6 — Collaborator Leave

## 行为与范围

Collaborator 在已加入 Museum 的简介页阅读明确警告、勾选确认后，可主动退出。
退出将自己的 membership 标记为 revoked，保留原记录和 created_at；更新 updated_at。
不删除照片、Memory、Museum，不修改 Owner，不影响其他成员。
成功后整页返回 `/account`，重新加载基于有效 membership 的切换列表；原 Museum 消失。
旧简介页面在下一次服务端请求时返回 404。

本任务不实现 Owner Remove、Owner Transfer，也不提前修改后续 Phase F 内容权限。
当前 Joined Museum 仍仅开放简介，旧 Memory/Photo/Stage 权限逻辑保持不变。

## 文件与设计

- `src/data/museum-leave.ts`：事务内检查 Museum Owner 和当前用户的成员关系；仅撤销自己的 active membership。已 revoked 的关系返回成功，保留首次失效时间，以支持丢失响应后的安全重试。
- `src/app/api/museums/[id]/leave/route.ts`：同源检查先于登录检查；用户身份来自 session；校验 Museum ID 和显式确认标记；统一错误响应和 private/no-store 成功响应。
- `src/components/museum-leave-form.tsx`：退出后果说明、原生确认复选框、未确认禁用按钮、提交中防重复及失败反馈；成功后整页替换到 Own Museum 页面。
- `src/app/account/museums/[id]/page.tsx`：加入协作者退出表单，沿用现有有效成员关系检查。
- `tests/museum-leave.test.ts`：3 项针对性行为测试。
- `tests/same-origin.test.ts`：新增退出接口安全检查，必须使用 session 中的 user.id，不能依赖请求指定的退出者。

没有新增依赖、表结构、迁移、cookie 或通用权限架构。
保留失效记录而非删除，复用现有 revoked 状态和邀请恢复机制。

## 接口

`POST /api/museums/{id}/leave`

请求为 `{ "confirm": true }`，作用对象仅为当前已登录用户。
成功 200 `{ "ok": true }`，重复退出已有 revoked 关系仍成功。
缺少登录 401；异源/缺少 Origin 403；缺少显式确认 400；Museum ID 非法 400；Owner 自己退出 403；无成员关系或 Museum 不存在 404。
不会接受 userId 参数作为操作用户，不提供退出其他人的功能。

## 验证记录（2026-09-26）

- RED：服务不存在时新增测试失败；实现后针对性 3 项测试通过。
- `pnpm check`：typecheck、lint、177 项测试、format:check 全通过。
- `pnpm build`：生产构建通过，包括 `/api/museums/[id]/leave`。
- 隔离 Chrome、临时数据库、3107 测试服务：警告可见；未确认按钮禁用；勾选后取消不退出；键盘 Space/Enter 完成退出；返回 `/account` 后 switcher 仅剩 Own；旧页面 HTTP 404；重复退出 HTTP 200。
- 实际 HTTP：匿名 401；缺少确认或错误确认类型 400；异源/缺少 Origin 403；Owner 403；非成员携带其他人的 userId 仍 404，目标关系保持 active。
- DB：自身 revoked，其他成员 active，Museum 数量及 Owner 不变；created_at 保留，重复退出不修改失效时间；模拟写入失败后回滚；服务支持退出 pending-deletion Museum 的已有成员关系。
- 页面 320/768/1024/1440 宽度无横向溢出，完整成功流程 console/pageerror 无错误或警告；已检查截图及确认控件的键盘可操作性。
- `git diff --check` 通过；代码质量自查未发现当前阶段阻塞问题。参数化 SQL、事务写入、session 派生用户、权限收缩和接口响应边界符合现有模式。

## 交付状态

12E6 四项行为要求满足；未推进下一阶段。
真实账号和照片数据未修改。临时服务、浏览器、数据库、脚本、截图和补丁已清理。
未提交、推送或部署；不宣称腾讯云已验收。真实邮件发送仍按此前要求留待后续验收。
