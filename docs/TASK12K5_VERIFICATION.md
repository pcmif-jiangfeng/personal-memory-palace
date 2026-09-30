# Task12K5 — 管理员受控访问审计自检报告

日期：2026-09-30。结论：最小受控入口验收通过。管理员后台仍只展示平台元数据，不成为私人内容浏览器。

## 修改与边界

- `src/data/platform-admin-support.ts`、`src/data/migrations.ts`：新增 migration 25 临时许可表；许可绑定当前馆主、配置中的已验证管理员、一座馆和一条 Memory，30 分钟有效。馆主确认、故障处理、安全事件三种用途；授权 / 撤销 / 每次读取均审计。
- `src/http/museum-support-access.ts`：严格白名单参数，不能由请求伪造身份、管理员、期限或事故用途。
- `src/app/api/museums/[id]/support-access/route.ts`：馆主明确授权或撤销的入口；非馆主不能签发。
- `src/app/api/admin/museums/[id]/support-read/route.ts`：管理员持有效许可读取单条 Memory 的标题 / Story 文本快照；POST-only，private/no-store。没有列表、相册导航、照片文件地址、分享凭证或编辑权限。
- `scripts/grant-support-access.ts`、`Dockerfile`：故障 / 安全事件通过服务器维护命令签发，必须提供事件编号与明确确认；没有管理员 HTTP 自批事故许可接口。
- `src/data/museum-owner-transfer.ts`：转移在同一事务撤销旧许可，避免原馆主重新成为馆主后旧许可复活。
- `src/app/account/museums/[id]/audit/page.tsx`：馆主审计页新增中文动作标签。
- `tests/platform-admin-support.test.ts`、`tests/database.test.ts`、`tests/same-origin.test.ts`、`scripts/verify-museum-notifications.mjs`：许可、审计故障、迁移与接口验收。

本阶段不增加管理员私人浏览页面；馆主授权先提供受保护 API，未额外增加前端授权面板。单条文本诊断是必要访问的最小实现，照片 / 追加文字 / 展陈 / 批量内容不在此入口提供。

## 验证

- 最终全量 401 项测试通过，0 失败 / 0 跳过；类型、lint、格式检查通过。
- 8 项 K5 专项测试通过：默认拒绝、必须确认、单馆单 Memory、30 分钟边界、撤销、当前馆主 / 管理员 / 待删除状态变化、每次读取审计、失败关闭、事故用途 / 编号、迁移幂等和实际所有权转移撤销。
- 隔离生产构建与启动通过；K3 / K4 / K5 HTTP 联合验收通过。
- K5 HTTP 实测未登录、非管理员、无许可、跨站、非馆主、伪造事故用途均被拒绝；有效许可返回指定文本且禁止缓存；审计写入失败返回 500 且不泄露正文；撤销后读取返回 403。
- 真实维护命令在合成数据库签发故障处理许可并成功通过受控读取验收。
- 管理员普通 Memory 展示页仍返回 404，平台后台不包含私人标题 / Story；K1 / K2 Chrome 和生产 HTTP 再回归通过，控制台无 error。
- `git diff --check` 通过，构建未改变 `next-env.d.ts`。仅使用可清理的临时数据，未访问真实私人馆、迁移生产数据库、推送或部署。

## 使用契约

需要有效 User session 与同源请求；许可 ID 本身不授予匿名访问能力。

1. 馆主 `POST /api/museums/<museumId>/support-access`，正文 `{"memoryId":"<memoryId>","confirm":true}`；返回 `grantId` 与 `expiresAt`。
2. 管理员 `POST /api/admin/museums/<museumId>/support-read`，正文 `{"memoryId":"<memoryId>","grantId":"<grantId>"}`；不接受查询列表。
3. 馆主 `DELETE /api/museums/<museumId>/support-access`，正文 `{"grantId":"<grantId>","confirm":true}`；重复撤销不会重复审计。
4. 仅在真实、必要的故障或安全事件处理时，服务器运营者运行：`node --experimental-strip-types scripts/grant-support-access.ts <museumId> <memoryId> <fault_handling|security_incident> <caseReference> --confirm`。容器对应路径 `maintenance/grant-support-access.ts`。

事件编号是可追溯的关联记录，不是自动证明真实事故；服务器运营者负责确认事实及必要性。HTTP 管理员无法通过填一个编号自批访问。维护脚本没有在真实生产数据上执行。

## 审查结论

- 权限 / 许可 / 目标绑定 / 审计在同一 SQLite 事务验证，先持久化审计再返回正文。审计不包含私人文本、照片或认证材料。
- 不放宽既有 User / Owner / Collaborator / Visitor / media 权限，不引入可绕过单条许可的后台列表或重用会话角色。
- 无新依赖；只有短小同步事务，无事务内网络 I/O。修复了格式化换行导致的源码安全断言误报，未降低身份校验要求。
- 未发现阻止本阶段交付的问题；不宣称独立第三方安全审计或生产上线已完成。

## 回滚

新迁移只增加许可表，保留现有内容与审计。上线前备份 SQLite；回退应用后保留 migration 25 与许可表即可，不需要删表或回滚 Memory。停用支持读取入口与许可签发维护命令；到期 / 已撤销记录可保留作追溯，不改变馆权限。

## 当前批次剩余项

- task12.md 只定义 K1–K5，未定义 K6；须用户提供 K6 内容，不能自行推断为 J6 或永久删除。
- 真实邮件送达与生产定时发送待后续验收；当前源码未提交 / 推送 / 部署。
