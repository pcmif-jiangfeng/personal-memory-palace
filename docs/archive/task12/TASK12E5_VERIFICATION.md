# Task 12E5 — Museum Switcher

## 实现范围

账户与 Museum 简介页面的顶部提供 Museum Switcher，默认为 Own Museum，可以切换到有效加入的 Museum，并明确显示名称与身份。

当前 Memory/Photo/Stage 页面仍为 legacy scope。为遵守本任务禁止修改底层权限 scope 的要求，切换器不在这些旧展览页面显示，也不改变旧页面的内容查询或写入权限。Joined Museum 本阶段仅显示简介；内容隔离属于 Phase F。

## 文件与设计

- `src/data/museum-switcher.ts`：单条参数化查询返回自己的 Museum 与 active membership 对应的 active Joined Museum；Own 排首，Joined 按名称与 ID 排序；不返回 token、用户邮箱、存储配额等字段。
- `src/domain/museum-switcher.ts`：导航元数据类型与基于 pathname 的当前选择；普通账户路由默认 Own，不可用 Museum 路由不伪装为另一座 Museum。
- `src/components/museum-switcher.tsx`：有明确标签的原生 select，名称与 Owner/Collaborator 身份可见；跳转只从服务端提供的候选列表中产生。
- `src/styles/museum-switcher.css`：复用纸色、墨色与边框变量，顶部布局按宽度换行，键盘 focus 可见。
- `src/app/layout.tsx`、`src/components/site-header.tsx`：复用 User session，传递当前用户的切换列表并挂载组件，不修改 legacy Owner 判定。
- `src/app/account/museums/[id]/page.tsx`：已加入 Museum 的简介页；未登录跳转登录，其他用户的 Museum、撤销 membership、Pending Deletion Museum 返回 404；Own ID 路由返回 `/account`。
- `tests/museum-switcher.test.ts`：列表过滤、身份、默认 Own、当前选择、未知选择、无数据及 Own 待删除状态的覆盖。

选择只使用 URL，不新增 cookie、localStorage、数据库字段或切换 API。切换使用整页导航刷新服务端列表，避免记住上一个账号或过期成员关系。Own Museum 待删除仍对 Owner 可见，Joined Museum 仅在 active 状态可见。

## 验证（2026-09-26）

- RED：新增测试因服务尚不存在而失败；实现后针对性测试通过。
- `pnpm check`：typecheck、lint、174 项测试、format:check 通过。
- `pnpm build`：生产构建通过，包含动态 `/account/museums/[id]`。
- 隔离 Chrome + 临时数据库 + 3106 服务：默认 Own、键盘 ArrowDown/Enter 切换 Joined、当前标签、返回 Own、简介页面无管理表单均通过。
- 320/768/1024/1440 宽度页面无横向溢出；切换流程 console/pageerror 无错误或警告；已检查实际页面截图。
- HTTP：Pending Deletion、revoked membership、未加入的 Museum 返回 404；匿名用户 307 到 `/account/login`；撤销测试关系后旧简介请求 404，重新载入列表不再出现该 Museum。
- `git diff --check` 通过。
- 代码质量自查：查询参数化、用户身份来自 session、导航元数据最小化、无新增依赖或权限扩大，未发现当前阶段阻塞项。

## 结论与未覆盖范围

12E5 导航层规则满足。原有照片上传与内容权限、Invite、Audit 未修改。
无数据库迁移或真实数据变更；临时数据库、浏览器、服务、脚本与截图均已清理。
尚未推送、部署或进行公网验收。
主动退出 Museum 属于 12E6；协作者展览内容访问属于 Phase F，本次未实现。
