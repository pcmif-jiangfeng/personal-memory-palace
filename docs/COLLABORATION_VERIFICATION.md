# 协作恢复：最终本地验收

2026-10-03。A–F功能及G本地交付已实施；schema 36。以下仅为隔离数据、本地生产构建和真实Chrome证据，不是线上验收。

## 验证结果

- 全量532项测试通过，typecheck、lint、build、diff检查通过。
- `node --experimental-strip-types scripts/collaboration-smoke.mjs`：一次性生产服务器、双账号及匿名访客，覆盖认证验证码界面、共同创建、邀请、成员、内容、Note、照片、日志、转让与删除流程，无页面异常。
- 受控迁移/清理仅在临时目录执行；只读字节不变、旧权限隔离、明确映射、备份恢复、失败重试及不触他馆均有测试。
- 各项自检详见 `COLLABORATION_A1_VERIFICATION.md` 至 `COLLABORATION_F4_VERIFICATION.md` 与 tasks/todo.md。

## 32条产品要求的证据对应

序号按 COLLABORATION_SPEC.md 第13节顺序。每项本地通过，不代表生产历史库已迁移。

| # | 验收内容 | 主要证据（tests/下文件，另含完整Chrome） |
|---|---|---|
|1|私人之外创建共同，加入不丢私人|museum-repository、museum-switcher；创建/加入页面|
|2|成员读加入前内容，其他宫殿隔离|scoped-memory、task13-private-boundaries|
|3|转发不能由非指定邮箱接受|email-invite-acceptance|
|4|7天准确截止、重新邀请|email-invites、email-invite-acceptance|
|5|重复不延期、已有成员拒绝、接受撤销竞态|email-invites、email-invite-acceptance（独立连接）|
|6|匿名/未验证/未加入/退出拒绝|scoped-memory、task13-private-boundaries|
|7|成员上传与创建编辑、查询范围|scoped-photo、scoped-memory、scoped-stage；Chrome整理台|
|8|成员软删除恢复，不得永久删除/清空|scoped-memory、photo-trash；Chrome回收站|
|9|Note作者才可编辑，馆长无代改权|later-note-permissions；Chrome作者/馆长|
|10|Note移入/恢复例外，撤权拒绝|later-note-permissions|
|11|邀请/移除/分享馆长限定、退出保贡献|email-invite-http、museum-collaborators、scoped-share|
|12|移除即时撤权、旧权限不复活|collaboration-migration、task13-private-boundaries；Chrome撤权|
|13|匿名及登录分享访客只读|task13-private-boundaries、scoped-share；Chrome分享|
|14|成员编辑同步分享且事先提示|scoped-share；Chrome双人编辑|
|15|上传记馆长配额、不阻断文字编辑|photo-storage-quota、platform-admin-quota|
|16|私人不能转让、共同必须显式接受|owner-transfer-requests、owner-transfer-http；Chrome双方|
|17|接任额度不足不变归属/数据|owner-transfer-requests；Chrome507保留申请|
|18|一份7天申请、撤回拒绝退出移除失效|owner-transfer-requests；Chrome拒绝/撤回|
|19|物理文件计量、预留和删除释放|photo-storage-quota、museum-permanent-deletion|
|20|整体转移承担者、失败原状与安全额度投影|owner-transfer-requests、platform-admin-quota|
|21|过期保存拒绝且保留未保存文字|scoped-memory；Chrome双标签编辑冲突|
|22|真实操作者与作者保留|content-audit、photo-audit、later-note-permissions|
|23|同馆安全日志、外人和撤权不能读|owner-audit、museum-activity；Chrome日志|
|24|当时昵称、永久删除清除内容副本|audit-log、audit-content-redaction、content-audit|
|25|待删除冻结、馆长仅受限状态|museum-deletion、shared-deletion-freeze；Chrome冻结|
|26|撤销仅恢复此前有效分享|shared-deletion-freeze；Chrome撤销|
|27|冻结全部管理，失效转让不复活|shared-deletion-freeze；Chrome转让/邀请拒绝|
|28|30×24小时截止与后台失败重试反馈|museum-deletion、museum-permanent-deletion-maintenance；Chrome截止/状态|
|29|私人整馆删除/账号注销停用|museum-deletion、task13-private-boundaries；Chrome410|
|30|无新增创建/加入人数产品限制，仍保护配额|museum-repository、email-invites、photo-storage-quota|
|31|跨馆复制移动停用|same-origin、task13-private-boundaries；Chrome410|
|32|历史内容保留、旧成员需重新接受|collaboration-migration；备份恢复、迁移隔离|

## 审查与行为变化

普通业务授权恢复为当前有效、已验证、同宫殿成员；馆长专属管理与Note作者例外独立检查。旧即时转让服务与旧未挂载表单保留历史用途，src中没有页面/API调用，不构成公开旁路。恢复的是经过新邀请接受的协作，不恢复旧active授权。转让为待接受状态，原馆长固定留作协作者；共同整馆删除具备排期、冻结、截止与受控清理。私人整馆删除、账号注销、跨馆复制仍停用。

审查修复：清理前提前释放额度、重试状态写入锁边界、Note作者字段误计、旧“公开后匿名可浏览”错误文案，以及浏览器转让辅助函数提前返回。未修改构建后的压缩文件，未引入新依赖，未改写现有生产数据。

## 保留的观察与生产待验收

- 曾一次重新邀请浏览器步骤等待POST超时，后续完整运行连续通过；原因未能复现，已添加只记录请求方法/按钮数量/错误提示数量的失败诊断，不加自动重试掩盖。作为测试稳定性观察项，不能声称根因已修复。
- 真实验证码/邀请邮件送达、生产历史映射、实际备份恢复、停写、调度与域名运行需上线阶段另验；当前模拟邮件不作为收件证据。
- 旧内部转让服务、未挂载表单继续保留为历史测试债务；无需为本次恢复删除历史维护路径。
- 不自动推送或部署。生产操作参见 COLLABORATION_OPERATIONS.md，需另行授权。
