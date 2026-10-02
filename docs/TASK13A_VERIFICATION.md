# Task13A 账号入口与账号管理自检报告

日期：2026-10-01。依据：`任务文件/task13问题总结.md`，第一轮仅执行 13A，等待人工验收，不自动进入 13B。

## 实现与行为

- 导航右侧新增昵称下拉入口，昵称缺失时回退到邮箱；提供账号管理与退出登录。支持键盘打开、Escape 关闭及点击外部关闭。
- 新增 `/account/settings`，账号资料与原 Museum 资料页分离。邮箱只读，显示既有邮箱验证状态；未登录访问跳转 `/account/login`。
- 昵称编辑去首尾空格，不能为空，最多 50 个 UTF-16 代码单元，可重复。保存后通过 `router.refresh()` 重新读取服务端当前用户，同步导航；不引入第二份身份存储。
- 修改密码入口展示「发送六位邮箱验证码 → 验证 → 设置并确认至少 8 位新密码」流程，不要求旧密码。既有邮件能力使用验证链接而非六位验证码，因此遵照任务约束暂不发送验证码、不修改密码，按钮明确标注待接入；正式 EmailCode 体系留待 13B。
- 浏览器检查发现原 `/account` 的两个兄弟表单使用相同 Museum ID 作为 React key；为 profile/slug 分别加前缀，消除警告，保留切换 Museum 时的重置行为。

## 模型、Session、数据库、路由与 API

- 复用现有 User：`id/email/passwordHash/displayName/emailVerified/createdAt/updatedAt`。昵称复用 `users.display_name`，更新时同时写 `updated_at`；无新列、无迁移，不修改邮箱、密码或 Museum 数据。
- 复用 `currentUser()`：由 `memory_palace_user` Cookie 对应数据库中哈希 Session Token，检查有效期与邮箱已验证状态。退出复用现有 `/api/user-auth`，不新增认证体系。
- 新页面：`/account/settings`。
- 新接口：`PATCH /api/account/profile`，仅接受 `{ nickname: string }`；目标 User ID 仅由服务端 Session 决定，拒绝额外 ID/邮箱字段，检查同源，参数化更新仅作用于当前已验证用户。响应只含 nickname。
- 不改变现有多 Museum、协作者、馆长转移、分享或旧认证行为。13B 的单用户单宫殿要求与既有多 Museum 体系不同，必须在后续审计中明确迁移边界，本轮不处理。

## 修改文件

新增：

- `src/app/account/settings/page.tsx`
- `src/app/api/account/profile/route.ts`
- `src/components/account-menu.tsx`
- `src/components/account-profile-form.tsx`
- `src/domain/user-profile.ts`
- `src/http/user-profile.ts`
- `src/data/user-profile.ts`
- `src/styles/account.css`
- `tests/user-profile.test.ts`
- `docs/TASK13A_VERIFICATION.md`

修改：

- `src/app/layout.tsx`：向导航传递最小的昵称/邮箱数据。
- `src/components/site-header.tsx`：新增账号菜单。
- `src/components/user-logout-button.tsx`：允许传入标签及样式，旧用法保持默认行为。
- `src/app/account/page.tsx`：添加账号管理链接及修复重复 key。
- `src/app/globals.css`：引入账号样式。
- `src/i18n/zh-CN.ts`：账号文案。

原有未提交的任务文档与 `next-env.d.ts` 不属于本次实现，不覆盖、不提交。没有新增依赖。

## 验证

- 改动前相关基线测试 7/7 通过，typecheck 通过。
- 新昵称测试先验证缺少实现时失败，再实现并通过；最终 4 个相关文件合计 10/10 通过：
  `pnpm test:file tests/user-profile.test.ts tests/user-auth.test.ts tests/user-repository.test.ts tests/site-navigation.test.ts`。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` 均通过。生产构建包含两个新路由。
- 使用已有 Playwright + Chrome、独立测试账号和独立数据库完成真实浏览器验收，不发送真实邮件、不修改现有账号：登录 → 菜单 → 账号管理 → 保存昵称立即同步 → 刷新后保留 → 退出 → 再访问账号设置跳转登录。
- 验证密码入口为明确标注的待接入流程，无旧密码字段，不存在可执行的临时验证码实现。
- API 验证：伪造目标用户字段 400、跨源请求 403、无登录请求 401。
- 在 320/768/1024/1440 px 宽度无页面横向溢出；桌面及手机截图已人工视觉检查；最终账号流程没有浏览器 pageerror 或 console error/warning。
- 代码审查：会话身份与输入边界分离，SQL 参数化，昵称由 React 文本渲染，不输出密码哈希或 Session，不增加无谓抽象；未发现本轮范围内阻断问题。

## 当前结论

13A 可进入人工验收。密码修改的实际邮件验证码及提交能力未实现，这是文档指定的 13B 接入边界；不能把本轮报告视为 Task13 全部完成。未推送 GitHub、未部署腾讯云。人工验收通过后才开始 13B。
