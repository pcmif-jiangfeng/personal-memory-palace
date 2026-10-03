# 协作恢复实施任务

状态：用户已批准实施；A–E及检查点A/B/C/D/E当前通过，F及后续任务未完成；G1继续观察测试波动，已复现的旧转让夹具问题已修正。依据 plan.md，完成每项输出自检报告。

通用验证：每项针对性测试、改动文件格式检查与自查；非平凡实现质量审查；检查点执行 pnpm typecheck、pnpm lint、pnpm test、pnpm build。所有命令在仓库根目录运行。括号中的“新增”文件是计划，不表示已经存在。S=1–2个主要文件，M=3–5个；超出先拆分。

## A. 数据与安全基础

- [x] A1 旧数据映射审计（S；无依赖）
  - 验收：只读输出宫殿/owner/成员/邀请/配额/未完成文件作业；未知类型、作者和额度不猜测。
  - 验证：pnpm test:file tests/collaboration-migration.test.ts（新增），证明审计不写入。
  - 文件：scripts/audit-collaboration-migration.ts（新增）、tests/collaboration-migration.test.ts（新增）。
  - 自检：[COLLABORATION_A1_VERIFICATION.md](../docs/COLLABORATION_A1_VERIFICATION.md)，5 项新增测试与 461 项全量测试通过；未迁移真实数据。
- [x] A2 类型与旧授权迁移（M；依赖A1）
  - 验收：私人类型owner唯一、共同馆可多座；旧成员与旧邀请不生效；幂等且保留内容/ID/存储键。
  - 验证：pnpm test:file tests/collaboration-migration.test.ts tests/museum-membership-schema.test.ts。
  - 文件：src/data/schema.ts、migrations.ts、museum-membership-schema.ts、tests/collaboration-migration.test.ts、museum-membership-schema.test.ts。
  - 自检：[COLLABORATION_A2_VERIFICATION.md](../docs/COLLABORATION_A2_VERIFICATION.md)，464项全量测试通过；歧义回滚和迁移前副本恢复通过。
- [x] A3 私人整馆删除边界（M；依赖A2）
  - 验收：私人整馆写入口关闭、注销不开放；共同馆不借旧流程误开放；历史数据保留。
  - 验证：pnpm test:file tests/museum-deletion.test.ts，另检查页面/API。
  - 文件：src/data/museum-deletion.ts、src/app/api/museums/[id]/deletion/route.ts、src/app/account/museums/[id]/deletion/page.tsx、src/app/account/deletion/page.tsx、tests/museum-deletion.test.ts。
  - 拆分：服务及维护私人保护 → 页面/旧API关闭 → 隔离浏览器回归；增加永久删除脚本入口保护，不改历史状态。
  - 自检：[COLLABORATION_A3_VERIFICATION.md](../docs/COLLABORATION_A3_VERIFICATION.md)，466项全量测试、类型/静态检查、构建及真实Chrome隔离验证通过。

### 检查点A

- [x] 全量检查、升级旧成员/旧token不能授权及迁移副本完整性通过，不开放生产协作。

## B. 统一配额与共同宫殿创建

- [x] B1 账号额度与跨馆预留（M；依赖A2）
  - 验收：单馆原额度原值迁移，多馆冲突明确映射；聚合used/reserved，跨馆并发不超額；账本按馆保留。
  - 验证：pnpm test:file tests/photo-storage-quota.test.ts tests/collaboration-migration.test.ts，两连接并发。
  - 文件：src/data/schema.ts、migrations.ts、photo-storage-quota.ts、tests/photo-storage-quota.test.ts、collaboration-migration.test.ts。
  - 拆分：额度迁移/首馆初始化 → 跨馆上传预留 → 只读审计及旧测试基线联动。
  - 自检：[COLLABORATION_B1_VERIFICATION.md](../docs/COLLABORATION_B1_VERIFICATION.md)，迁移/配额25项针对性检查通过；联动B2后473项全量通过。
- [x] B2 运维额度目标（M；依赖B1）
  - 验收：调整账号总额度，仍仅管理员且有审计；新馆不获赠额度，不新增套餐。
  - 验证：pnpm test:file tests/platform-admin-quota.test.ts。
  - 文件：src/data/platform-admin-quota.ts、src/http/platform-admin-quota.ts、src/app/api/admin/museums/[id]/quota/route.ts、src/components/admin-quota-form.tsx、tests/platform-admin-quota.test.ts。
  - 拆分：账号调整服务/请求契约 → 元数据/管理界面及运行验证。
  - 自检：[COLLABORATION_B2_VERIFICATION.md](../docs/COLLABORATION_B2_VERIFICATION.md)，8项管理员测试及真实Chrome表单保存/旧owner拒绝通过；473项全量、构建通过。
- [x] B3 共同创建与私人默认服务（M；依赖B1）
  - 验收：私人仅一座，共同可多座且不重复赠额；默认查私人类型，不按最早館猜测；无新增创建数限制。
  - 验证：pnpm test:file tests/museum-onboarding.test.ts tests/museum-repository.test.ts。
  - 文件：src/data/museum-repository.ts、museum-onboarding.ts、src/app/api/museums/route.ts、tests/museum-onboarding.test.ts、museum-repository.test.ts。
  - 拆分：类型/默认服务 → POST边界/权限测试；删除状态复用type DTO。
  - 自检：[COLLABORATION_B3_VERIFICATION.md](../docs/COLLABORATION_B3_VERIFICATION.md)，475项全量及类型/lint通过；UI/浏览器在B4。
- [x] B4 创建与额度界面（M；依赖B3）
  - 验收：界面区分私人/共同，创建可进入目标馆；仅展示当前馆占用和馆长账号剩余，不显示其他馆明细。
  - 验证：pnpm test:file tests/museum-switcher.test.ts tests/museum-storage-usage.test.ts，浏览器创建/额度检查。
  - 文件：src/components/museum-onboarding-form.tsx、src/app/account/museums/[id]/page.tsx、src/data/museum-storage-usage.ts、tests/museum-storage-usage.test.ts、museum-switcher.test.ts。
  - 自检：[COLLABORATION_B4_VERIFICATION.md](../docs/COLLABORATION_B4_VERIFICATION.md)，477项全量、类型/lint/构建、真实Chrome创建/目标/额度/重复馆址及多宽度检查通过；实际复用account/page.tsx，不新增重复设置页。

### 检查点B

- [x] 全量检查、账号额度保护及私人馆唯一约束通过。

## C. 指定邮箱邀请与成员

- [x] C1 邀请写入与撤销服务（M；依赖A2）
  - 验收：标准化指定邮箱、7天、一份有效邀请、重复不续期；已经成员不可邀请，旧bearer不复用。
  - 验证：pnpm test:file tests/invite-management.test.ts tests/invite-link-schema.test.ts。
  - 文件：src/data/invite-link-schema.ts、migrations.ts、invite-management.ts、tests/invite-management.test.ts、invite-link-schema.test.ts。
  - 实际拆分：email-invite-schema.ts、email-invites.ts 与 tests/email-invites.test.ts 独立承载邮箱状态模型；不复用旧bearer字段。新表同步纳入永久删除白名单及夹具，旧测试不移除。
  - 自检：[COLLABORATION_C1_VERIFICATION.md](../docs/COLLABORATION_C1_VERIFICATION.md)，5项新增/40项联动与482项全量通过，类型/lint/构建通过；C2/C3尚未开放。
- [x] C2 接受与通知（M；依赖C1、B3）
  - 验收：已验证目标账号主动接受；非目标拒绝；接受/撤销竞态一致；复用邮件服务，失败可重试不扩大权限。
  - 验证：pnpm test:file tests/invite-acceptance.test.ts，未注册后注册、过期、发送失败场景。
  - 文件：src/data/invite-acceptance.ts、src/app/api/invites/route.ts、src/app/api/invites/accept/route.ts、src/email/collaboration-invites.ts（新增）、tests/invite-acceptance.test.ts。
  - 实际拆分：新email-invite-acceptance.ts与历史bearer接受服务分离；添加application/collaboration-invites.ts负责提交后发送、http/email-invites.ts负责新请求契约；保留旧安全测试。
  - 自检：[COLLABORATION_C2_VERIFICATION.md](../docs/COLLABORATION_C2_VERIFICATION.md)，491项全量、类型/lint/构建及隔离Chrome HTTP通过；两独立连接接受/撤销竞态、投递失败重试通过，真实收件尚未验收。
- [x] C3 邀请查看管理界面（M；依赖C2）
  - 验收：馆长管理邀请，目标账号查看接受；过期撤销明确；普通分享没有加入授权。
  - 验证：pnpm test:file tests/invite-management.test.ts tests/invite-acceptance.test.ts，双账号浏览器。
  - 文件：src/components/invite-management.tsx、accept-invite-form.tsx、src/app/account/invites/page.tsx、src/app/invite/page.tsx、src/app/api/invites/[id]/route.ts。
  - 实际拆分：新增email-invite-inbox.ts与测试，账号菜单/设置添加入口；旧/invite#token继续关闭，新邮件定位账号邀请页。数据读取与渲染分离。
  - 自检：[COLLABORATION_C3_VERIFICATION.md](../docs/COLLABORATION_C3_VERIFICATION.md)，492项全量、类型/lint/构建、真实Chrome双账号发送/接受/撤销/过期重邀、多宽度及键盘验证通过。
- [x] C4 移除与退出路径（M；依赖C2）
  - 验收：仅馆长移除、成员自退、馆长不得退出；保留贡献；待删除拒绝管理；转让失效联动由F1补。
  - 验证：pnpm test:file tests/museum-collaborators.test.ts tests/museum-leave.test.ts。
  - 文件：src/data/museum-collaborators.ts、museum-leave.ts、src/app/api/museums/[id]/collaborators/[userId]/route.ts、src/app/api/museums/[id]/leave/route.ts、tests/museum-leave.test.ts。
  - 自检：[COLLABORATION_C4_VERIFICATION.md](../docs/COLLABORATION_C4_VERIFICATION.md)，修复旧pending退出/未验证旁路，29项针对性、两轮493项全量、类型/lint/构建及隔离HTTP通过；转让失效依F1补。

### 检查点C

- [x] 当前全量检查、旧邀请和转发邀请不可授权、成员贡献完整；新表纳入维护清单。一次未复现测试波动保留为G1跟踪项，不视为已修复。

## D. 内容、媒体与成员界面

- [x] D1 页面和请求范围（M；依赖C4）
  - 验收：新有效成员可进入、旧成员不能；验证邮箱限制保留；每次检查目标，pending只允许生命周期管理。
  - 验证：pnpm test:file tests/museum-access.test.ts tests/task13-private-boundaries.test.ts tests/memory-create-scope.test.ts。
  - 文件：src/memory-page-scope.ts、memory-request-scope.ts、src/data/museum-access.ts、tests/museum-access.test.ts、task13-private-boundaries.test.ts。
  - 自检：[COLLABORATION_D1_VERIFICATION.md](../docs/COLLABORATION_D1_VERIFICATION.md)，495项全量及真实Chrome新成员/目标歧义/旧成员/冻结/撤权通过；D2 publication限制提前作为安全前置。
- [x] D2 媒体与内容动作权限（M；依赖D1）
  - 验收：同馆成员媒体/普通编辑可用，永久删除/分享管理仅馆长；publication不成为公开旁路，token不授予成员。
  - 验证：pnpm test:file tests/task13-private-boundaries.test.ts tests/scoped-memory.test.ts tests/scoped-stage.test.ts tests/scoped-share.test.ts。
  - 文件：src/data/photo-access.ts、scoped-memory.ts、scoped-stage.ts、tests/task13-private-boundaries.test.ts、scoped-memory.test.ts。
  - 自检：[COLLABORATION_D2_VERIFICATION.md](../docs/COLLABORATION_D2_VERIFICATION.md)，495项全量、类型/lint/构建及真实Chrome成员上传/创建/媒体/馆长限定/撤权通过。
- [x] D3 选择和成员界面（M；依赖D2）
  - 验收：可选自有/有效加入馆；成员管理分权，不能透传名册邮箱；不同标签页明确目标。
  - 验证：pnpm test:file tests/museum-switcher.test.ts tests/museum-collaborators.test.ts，双馆浏览器。
  - 文件：src/data/museum-switcher.ts、src/components/museum-switcher.tsx、museum-remove-collaborator-form.tsx、museum-leave-form.tsx、src/app/account/museums/[id]/collaborators/page.tsx。
  - 自检：[COLLABORATION_D3_VERIFICATION.md](../docs/COLLABORATION_D3_VERIFICATION.md)，495项全量、类型/lint/构建、真实Chrome分权设置/成员列表/切换/双标签页/键盘退出移除/四宽度检查通过。
- [x] D4 编辑冲突与分享提示（M；依赖D2）
  - 验收：双账号冲突不覆盖、保留输入；已分享内容同步更新且提示；重新提交不能绕过移除。
  - 验证：pnpm test:file tests/scoped-memory.test.ts tests/scoped-share.test.ts，双页面保存冲突。
  - 文件：src/components/memory-management.tsx、memory-exhibit-editor-panel.tsx、share-manager.tsx、src/i18n/zh-CN.ts、tests/scoped-memory.test.ts。

### 检查点D

- [x] 全量检查、匿名/未验证/旧成员/移除成员HTTP和媒体矩阵通过；跨馆复制继续停用。
  - 自检：[COLLABORATION_D4_VERIFICATION.md](../docs/COLLABORATION_D4_VERIFICATION.md)，496项全量、类型/lint/构建及Chrome双人冲突/草稿保留/分享更新通过。

## E. 作者、Note、照片回收站与日志

- [x] E1 Note作者和状态服务（M；依赖D2）
  - 自检：[COLLABORATION_E1_VERIFICATION.md](../docs/COLLABORATION_E1_VERIFICATION.md)，新增权限/迁移/回滚5项及501项全量通过。
  - 验收：新Note真实作者、历史未知不猜；作者编辑，作者/馆长移入和恢复，馆长永久删除，退出后无操作权。
  - 验证：pnpm test:file tests/later-note-permissions.test.ts（新增）。
  - 文件：src/data/schema.ts、migrations.ts、scoped-later-note.ts（新增）、management-repository.ts、tests/later-note-permissions.test.ts（新增）。
- [x] E2 Note接口投影与界面（M；依赖E1）
  - 自检：[COLLABORATION_E2_VERIFICATION.md](../docs/COLLABORATION_E2_VERIFICATION.md)，503项全量、类型/lint/构建、Chrome作者/馆长/冲突/回收站/分享及窄屏验证通过。
  - 验收：安全作者/状态投影，页面按钮与服务端权限一致，Story与追加Note独立，分享不暴露回收站Note。
  - 验证：pnpm test:file tests/later-note-permissions.test.ts tests/scoped-share.test.ts，作者/馆长运行时。
  - 文件：src/data/memory-repository.ts、src/domain/models.ts、src/app/api/later-notes/[id]/route.ts（新增）、src/components/memory-management.tsx、later-note-controls.tsx（新增）。
- [x] E3 照片软删除服务（M；依赖D2）
  - 自检：[COLLABORATION_E3_VERIFICATION.md](../docs/COLLABORATION_E3_VERIFICATION.md)，迁移/状态/文件引用与额度保留/授权/回滚5项及508项全量通过。
  - 验收：软删除可恢复、保留文件/占用/引用；归档不同于回收站；永久删除仍馆长且保留在用/文件恢复保护。
  - 验证：pnpm test:file tests/photo-trash.test.ts tests/photo-deletion.test.ts（photo-trash新增）。
  - 文件：src/data/schema.ts、migrations.ts、photo-trash.ts（新增）、photo-deletion-service.ts、tests/photo-trash.test.ts（新增）。
- [x] E4 照片回收站路径（M；依赖E3）
  - 自检：[COLLABORATION_E4_VERIFICATION.md](../docs/COLLABORATION_E4_VERIFICATION.md)，510项全量、类型/lint/构建、Chrome整理台/角色/恢复/在用保护/分享媒体/窄屏通过。
  - 验收：整理台与回收站区分状态、可恢复；成员不能永久删除，分享不得绕过删除状态。
  - 验证：pnpm test:file tests/photo-trash.test.ts tests/photo-api.test.ts，浏览器删除恢复。
  - 文件：src/app/api/trash/route.ts、src/components/trash-manager.tsx、photo-workspace.tsx、src/data/photo-repository.ts、photo-access.ts。
- [x] E5 昵称快照与删除摘要（M；依赖E1、E3）
  - 自检：[COLLABORATION_E5_VERIFICATION.md](../docs/COLLABORATION_E5_VERIFICATION.md)，日志快照/删除清理/迁移隔离/事务回滚通过，512项全量及两项补充回归通过。
  - 验收：新日志当时昵称、旧日志未知不伪造；永久删除后不保留标题/正文/照片副本，只留规定摘要。
  - 验证：pnpm test:file tests/audit-log.test.ts tests/content-audit.test.ts，改昵称与删除。
  - 文件：src/data/audit-log-schema.ts、audit-log.ts、migrations.ts、audit-content-redaction.ts（新增）、tests/audit-log.test.ts。
- [x] E6 日志与作者展示（M；依赖E5、E2）
  - 自检：[COLLABORATION_E6_VERIFICATION.md](../docs/COLLABORATION_E6_VERIFICATION.md)，515项全量、类型/lint/构建及Chrome成员日志/匿名/冻结/退出/窄屏验证通过。
  - 验收：成员读同馆安全记录、访客不可；创建者不随编辑变更；pending不可读业务日志。
  - 验证：pnpm test:file tests/owner-audit.test.ts tests/museum-activity.test.ts，角色投影。
  - 文件：src/data/audit-log-reader.ts、museum-activity.ts、src/app/account/museums/[id]/audit/page.tsx、src/app/account/museums/[id]/activity/page.tsx、src/components/memory-management.tsx。

### 检查点E

- [x] 全量检查、Note例外权限、照片恢复/清理、历史未知作者及日志快照通过。

## F. 转让与共同宫殿生命周期

- [x] F1 转让申请状态机（M；依赖B1、C4）
  - 自检：[COLLABORATION_F1_VERIFICATION.md](../docs/COLLABORATION_F1_VERIFICATION.md)，8项状态/额度/双连接/回滚测试，修复维护清单后523项全量连续两次通过。
  - 验收：共同馆一份申请、7天、撤回/拒绝/移除失效；接任事务检查身份/状态/额度；原馆长固定成为成员。
  - 验证：pnpm test:file tests/owner-transfer-requests.test.ts，两连接上传/转让竞态。
  - 文件：src/data/migrations.ts、owner-transfer-requests.ts、owner-transfer-request-schema.ts、museum-collaborators.ts、museum-leave.ts、tests/owner-transfer-requests.test.ts。
- [x] F2 转让双方入口（M；依赖F1）
  - 自检：[COLLABORATION_F2_VERIFICATION.md](../docs/COLLABORATION_F2_VERIFICATION.md)，524项全量、类型/lint/构建及Chrome双方发起/拒绝/撤回/额度失败/接受/窄屏通过。
  - 验收：发起不即时转让，接任主动接受；无原馆长leave选项；失败保持原归属/配额。
  - 验证：pnpm test:file tests/owner-transfer-http.test.ts，双方发起/接受/拒绝浏览器。
  - 文件：src/app/api/museums/[id]/transfer/route.ts、src/app/account/museums/[id]/transfer/page.tsx、src/components/owner-transfer-controls.tsx、src/http/owner-transfer-request.ts、scripts/collaboration-transfer-smoke.mjs。
- [x] F3 删除排期和冻结（M；依赖F1、A3）
  - 自检：[COLLABORATION_F3_VERIFICATION.md](../docs/COLLABORATION_F3_VERIFICATION.md)，525项全量及Chrome通过；加入F4回归后528项全量通过。
  - 验收：共同馆有成员可排期；冻结全部业务管理，转让失效；30×24小时准确，到期不能撤销；撤销不恢复关闭分享/转让。
  - 验证：pnpm test:file tests/museum-deletion.test.ts tests/museum-deletion-cancel.test.ts tests/scoped-share.test.ts。
  - 文件：src/data/museum-deletion.ts、museum-owner-transfer.ts、src/components/museum-deletion-form.tsx、tests/museum-deletion.test.ts、museum-deletion-cancel.test.ts。
- [x] F4 后台删除与失败状态（M；依赖F3、E5）
  - 自检：[COLLABORATION_F4_VERIFICATION.md](../docs/COLLABORATION_F4_VERIFICATION.md)，528项全量、类型/lint/构建、Chrome和隔离失败重试通过。
  - 验收：受控停写、备份恢复校验、重试及馆长状态反馈；新表完整清理且不触他馆；不提前释放物理文件额度。
  - 验证：pnpm test:file tests/museum-permanent-deletion.test.ts tests/museum-permanent-deletion-maintenance.test.ts，失败和重启注入。
  - 文件：src/data/museum-permanent-deletion.ts、src/application/permanent-museum-deletion.ts、scripts/finalize-museum-deletion.ts、run-museum-deletion-worker.ts（新增）、tests/museum-permanent-deletion-maintenance.test.ts。

### 检查点F

- [x] 全量检查、截止边界/竞态/删除重试/共享配额通过；调度仅在隔离环境，不安装生产任务。

## G. 最终回归与上线准备

- [x] G1 逐条规格与端到端验收（M；依赖A–F）
  - 自检：[COLLABORATION_G1_VERIFICATION.md](../docs/COLLABORATION_G1_VERIFICATION.md)，32条本地证据、532项全量及Chrome通过，超时观察保留。
  - 新跟踪：F2一次完整浏览器运行在旧邀请重新邀请后等待POST响应超时，之后完整重跑通过；原因未定位，最终需继续捕获证据，不加自动重试掩盖。
  - 跟踪：D2复现UUID波动并定位旧转让夹具制造同owner双private；现改为共同馆转让并保留唯一约束，495项通过。C4原失败没有位置不能断言完全同源；最终仍观察其他波动，不放宽安全断言。
  - 验收：规格32条逐条证据，旧权限不复活、跨馆复制停用，登录/邮箱不回归，保留所有历史安全断言。
  - 验证：全量检查与 node scripts/collaboration-smoke.mjs（新增），真实浏览器双账号/分享/退出/冲突；真实邮件另需收件证据。
  - 文件：scripts/collaboration-smoke.mjs（新增）、tests/collaboration-routes.test.ts（新增）、src/data/museum-permanent-deletion.ts、docs/COLLABORATION_VERIFICATION.md（新增）、任务文件/COLLABORATION_SPEC.md（只记录验收）。
- [x] G2 隔离迁移与部署说明（M；依赖G1）
  - 自检：[COLLABORATION_G2_VERIFICATION.md](../docs/COLLABORATION_G2_VERIFICATION.md)，显式映射/只读/原备份恢复/旧授权隔离通过；author_user_id识别已修复。
  - 验收：旧版副本迁移/恢复证据、明确映射、停写/调度/回滚完整；生产输入缺失如实报告，不声称上线。
  - 验证：隔离迁移恢复测试、部署脚本语法与故障注入，不执行生产。
  - 文件：scripts/migrate-collaboration.ts（新增）、tests/collaboration-migration.test.ts、docs/COLLABORATION_OPERATIONS.md（新增）、docs/COLLABORATION_VERIFICATION.md。

### 检查点交付

- [ ] 用户审阅实现与验收报告后，再单独授权推送/部署。不得把本地实施授权视为生产操作授权。
