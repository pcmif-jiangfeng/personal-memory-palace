# 协作恢复：只读差异审计

日期：2026-10-03。依据：用户已整体确认的 PRODUCT_CORE.md 与 COLLABORATION_SPEC.md。

## 结论与范围

保留 Next.js/React/TS/SQLite、现有认证、图片存储与事务。不需要重写，但不能仅取消接口 410 就视为恢复完成。

本次只读取代码、运行隔离的已有测试、编写文档。未读取正式数据库、迁移数据、修改业务代码、检查腾讯云或部署；不能据此推断线上成员数、实际配额与数据状态。

## 差异与证据

| 边界 | 当前代码与行为 | 必要调整 |
| --- | --- | --- |
| 宫殿模型 | src/data/schema.ts、museum-repository.ts 无私人/共同类型；migrations.ts v28 在 owner_id 上建全局唯一 | 明确类型，仅私人 owner 唯一；共同馆多个，仍每馆一个馆长 |
| 创建/默认馆 | museum-onboarding.ts 有任何自有馆即拒绝创建；findMuseumByOwnerIdInDatabase 取最早馆 | 分开私人初始化和共同创建；默认明确查询私人，不猜最早 |
| 页面/API权限 | memory-page-scope.ts、memory-request-scope.ts 要求 owner；底层 museum-access.ts 仍支持 active collaborator | 先迁移禁用旧授权，再开放新成员内容权限；保留馆长管理检查和待删除冻结 |
| 媒体 | photo-access.ts 普通媒体 owner-only，media 路由与分享分开 | 新有效成员可读同馆媒体，旧成员仍不能；移除后每次请求拒绝 |
| 切换 | museum-switcher.ts 只列 owned；client/memory-museum-url.ts 已从显式参数或当前URL传 museumId | 显示 owned/加入馆，每次服务端验证目标，不新造账号状态 |
| 邀请 | invite-link-schema.ts 无邮箱，支持 single/multi-use及可空到期；invite-acceptance.ts 能直接重新激活 revoked 成员 | 指定标准化邮箱，7 天，重复不延长；旧邀请失效，接受/撤销事务竞争 |
| 入口 | api/invites、transfer、leave、collaborators 返回410；invite/account-invites 页面404 | 新流程完整后逐个恢复；跨馆复制不恢复 |
| 退出/成员 | museum-collaborators.ts 和 museum-leave.ts 保留 revoked 记录与贡献；leave 未查 pending；名册返回邮箱 | 复用记录保留，补冻结与转让失效；不直接把含邮箱名册投影给协作者 |
| 内容 | memory-access.ts、scoped-stage.ts 已支持底层成员编辑、永久删除仅owner；scoped-share.ts 管理仅owner | 保留细粒度限制，检查 publication 标志和清空回收站不能成为旁路 |
| 冲突 | scoped-memory.ts/management-repository.ts 有 details/exhibit 版本检查；memory-management.tsx 保留草稿版本与输入 | 复用并补双账号运行时验证；不夸大为所有动作已有过期版本保护 |
| 照片删除 | photo-deletion-service.ts 走物理删除队列；archiveScopedPhoto 是整理台归档，trash API 仅 Memory/Stage | 新增照片可恢复软删除，不用归档或删除作业冒充回收站 |
| Note | later_notes 无作者、软删除、编辑状态；addLaterNote 只追加 | 保存真实作者，新建作者编辑/作者与馆长移入恢复/馆长永久删除流程 |
| 作者 | Memory已有created_by_user_id；旧作者可能空，Note没有 | 可靠归属保留，未知历史作者不猜成馆长 |
| 日志 | audit schema 无昵称快照；reader owner-only且JOIN当前昵称；activity较窄但也JOIN当前昵称 | 新事件存操作时昵称，成员读安全投影；永久删除后仅留规定摘要 |
| 配额 | photo-storage-quota.ts 按单馆used/quota/reserved；museum-storage-usage.ts已去重优化版/原图并纳入未完成作业 | 文件账本保留按馆，额度按owner聚合，包括跨馆并发预留与转让 |
| 管理额度 | platform-admin-quota.ts调整单馆；新museum默认quota=0 | 改账号额度语义且保留管理员身份；不自动相加历史多馆额度或新增套餐默认值 |
| 转让 | museum-owner-transfer.ts 单方即时，原馆长可stay/leave，无接任申请或额度检查 | 共同馆一份7天申请，接任主动接受，旧馆长固定成员，额度整体转移 |
| 删除/取消 | museum-deletion.ts 排期30×24小时但依赖账号删除前置检查；取消未判断已到截止；无类型 | 私人写入口关闭；共同馆有成员也可排期；冻结、转让失效、到期不可撤销 |
| 永久整馆删除 | application/permanent-museum-deletion.ts、finalize脚本有备份/恢复/作业，但要求停止全部写入者与quiesced | 受控后台周期执行与重试/状态反馈，不能直接在在线请求里调用；新表加入清理白名单 |
| 分享/运维支持 | scoped-share仅owner；platform-admin-support有既有短时授权和离线故障处理 | 不扩大管理员权限；分享及支持读均受待删除限制；转让撤销旧支持授权 |

## 迁移影响与不能推断的输入

1. 一人一馆的普通历史账号可映射私人馆；一人多馆、来源不明或未完成删除须输出清单，不能按创建时间猜类型。
2. 先备份并验证可恢复，再幂等迁移；保留ID、正文、同馆关系、存储键、分享、账号与会话。
3. 旧成员保留历史但全部不生效，旧邀请不可接受。重新邀请才激活，升级测试必须覆盖旧active成员与有效旧token。
4. 历史Note作者和日志当时昵称无法可靠逆推时显示历史未知，不用当前昵称冒充操作时快照。
5. 单馆账号原额度原值迁移，多馆额度冲突须明确映射；文件账本不重算出低占用，未完成文件作业先恢复或明确隔离。
6. 新邀请/转让/Note状态纳入备份、恢复与整馆清理；不强制合并、搬动或清理线上旧照片。
7. 后台删除需明确停写机制和调度部署，生产操作另需授权。

## 已运行验证

```powershell
pnpm test:file tests/museum-membership-schema.test.ts tests/invite-acceptance.test.ts tests/museum-owner-transfer.test.ts tests/photo-storage-quota.test.ts tests/museum-storage-usage.test.ts tests/museum-deletion-cancel.test.ts tests/task13-private-boundaries.test.ts tests/scoped-memory.test.ts tests/scoped-share.test.ts
```

结果：60/60通过，0失败、跳过或取消。内存/隔离目录测试，不操作真实业务数据。

这些测试证明旧行为基线稳定，不证明新协作验收通过。通用多次邀请、单方转让、单馆配额的断言需按新规格修改，但越权、跨馆、匿名隔离、事务回滚与完整性断言必须保留，不能删测试“通过”。

没有业务代码改动，本轮未重复全量 typecheck/lint/build，未浏览器或线上验收。实施检查点再运行。

## 交付

计划见 [tasks/plan.md](../tasks/plan.md)，唯一任务清单见 [tasks/todo.md](../tasks/todo.md)。此前计划全部完成，归档保留；没有覆盖其他未完成计划。本轮不实施、不提交、不推送。
