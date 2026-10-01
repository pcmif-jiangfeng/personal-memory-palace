# Task 12E3 — Owner Invite 管理

完成日期：2026-09-26。实现Owner创建、查看、撤销邀请，禁止Collaborator调用本馆管理能力。

## 实现与设计

- `/account` 增加邀请管理入口；`/account/invites` 提供创建表单、邀请状态和分页列表。
- 单次/多次邀请，多次支持正整数上限或不限次；页面支持7天、30天、不设到期时间。API接受规范UTC ISO未来时间或null。
- 使用Node安全随机32字节生成token，SHA-256摘要存储；原始token只在创建成功的响应中返回。
- 完整链接在创建页面内存中显示一次，可选中文字手动复制，兼容普通HTTP访问；刷新/离开后不再显示。列表不提供token/hash，也不重新构造已有链接。
- 链接约定为 `/invite#token=...`，fragment不进入HTTP路径或服务端访问日志。本阶段未实现接受邀请，页面明确说明将在下一阶段开放。
- Owner归属由有效User会话与 `museums.owner_id` 决定，不使用客户端museumId，也不以Membership授予管理权。用户同时是其他馆协作者时仍只管理自己拥有的馆。
- 列表每页20条，按创建时间与ID稳定排序；分页参数校验。
- 撤销只修改本馆指定记录，重复撤销保留原时间；不存在/外馆邀请返回404。没有永久删除邀请。
- API沿用现有错误响应与同源检查；成功响应使用 `private, no-store`。
- 创建请求不支持幂等重放，也不自动重试。响应丢失可能已创建邀请，界面提示先检查列表再决定是否重试；列表不能恢复原token，可撤销后重建。
- 未创建任何Membership，不修改Switcher、邮件或原有照片/回忆权限。

## 文件清单

- `src/domain/invites.ts`：输入与列表类型。
- `src/http/invite-management.ts`：创建字段、分页校验。
- `src/data/invite-management.ts`：安全随机凭证、Owner限定的创建/列表/撤销。
- `src/app/api/invites/route.ts`：GET、POST。
- `src/app/api/invites/[id]/route.ts`：DELETE（撤销）。
- `src/app/account/invites/page.tsx`：Owner页面与分页。
- `src/components/invite-management.tsx`：创建/撤销交互与一次性链接。
- `src/app/account/page.tsx`：入口。
- `tests/invite-management.test.ts`：输入、Owner/协作者边界、跨馆隔离、摘要存储、无凭证列表、分页、重复撤销。
- `tests/same-origin.test.ts`：扩展现有安全检查，识别新User会话与Owner限定服务；不跳过同源或身份检查。

## 验证

- 实现前针对性测试因缺少实现失败；实现后通过。
- `pnpm check`：168项测试全部通过，类型、lint、格式检查通过。
- `pnpm build`：生产构建通过。
- 独立临时数据库、测试账户与隔离Chrome验证：单次创建、链接仅显示一次、刷新后列表保留、撤销持久化、多次限次及永久邀请设置通过。
- HTTP验证：匿名401、协作者403、跨馆撤销404、跨来源变更403、非法分页400，列表无token/hash。
- 320/768/1024/1440宽度无横向溢出，控制台无错误/警告；已查看实际截图。
- DevTools连接不可用，使用已有Playwright和隔离Chrome完成本阶段浏览器验证。临时浏览器、测试服务、数据库、脚本和截图已清理。
- 使用API、前端、安全、测试及代码质量技能完成自查；没有阻断问题，没有新增依赖。

## 剩余范围

接受邀请（读取fragment、校验过期/撤销/次数、原子消费并创建Membership）属于12E4，尚未实现；因此当前链接不能完成入馆。不会自动开始下一阶段。

未提交、推送或部署；未修改真实用户数据。
