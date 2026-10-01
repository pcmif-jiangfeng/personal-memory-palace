# Task 12H2a — 内容审计第一步验收记录

## 范围与结论

H2 涉及记忆创建、记忆管理、Stage 管理、照片归档、照片上传、照片删除六个写入模块。按 Task12 小循环规则拆为 H2a / H2b，本次只完成前四个模块；上传和删除留给下一步，不提前实施 H3 或审计 UI。

主要修改：

- `src/data/memory-write-repository.ts`：正式 museum-scoped 创建记忆时记录 `memory.create`。
- `src/data/scoped-memory.ts`：记录 details、note、relations、addPhotos、removePhoto、reorderPhotos、setCover、exhibitMetadata、publication、trash、restore、permanent。
- `src/data/scoped-stage.ts`：记录 `stage.create`，以及 details（含封面）、publication、trash、restore、permanent。
- `src/data/photo-access.ts`：首次归档记录 `photo.archive`，重复归档不重复产生事件。
- 新增测试 `tests/content-audit.test.ts`，以及本文。

已有 G5 / H1 未提交改动保留。没有新增数据库迁移、依赖、API 或 UI，没有提交、推送、部署或操作正式站。

## 行为契约

事件的 actor 和 museum 来自服务端已授权的 scope，不读取业务输入中的身份信息。授权、对象归属、关系合法性和版本检查仍在服务端执行；失败请求不记录成功事件。

写入位于原业务事务内：对象、封面/照片关系、版本、归属补齐、最后编辑者以及审计记录一起提交。审计写入失败会让本次业务修改回滚，不会出现“内容改了但审计缺失”。这意味着审计存储故障时，已接入操作不能成功保存。

Memory / Stage 管理事件保存 version 的 before / after（永久删除时 after 为 null）。涉及单张或多张照片时保存目标照片 ID / ID 列表；Stage 保存封面目标 ID；公开设置保存目标 isPublic。创建记忆记录 Stage、照片和封面标识。diff 是有限的操作上下文，不是全文快照或所有字段的完整差异。

不复制记忆正文、Later Note、展品说明、Stage 描述、账户字段、密码、分享 token 或物理图片路径。永久删除后事件仍保留对象 ID，但不能用事件还原被删内容。Stage 回收引起的记忆取消分类、永久删除引起的照片清理队列等副作用，以本次父对象事件记录，不逐条展开子事件。

页面、成功响应、版本递增和既有权限保持不变；Stage details 不会因共用审计出口而多递增一次版本。业务本来允许的成功重复保存仍按成功操作记账；照片重复归档没有新的状态改变，故不重复记账。未传 scope 的遗留底层创建助手不伪造 actor，也不产生新审计记录；正式创建 API 使用有权限检查的 scope。

## 验证与代码审查

- 局部命令：`node --experimental-strip-types --test tests/content-audit.test.ts tests/scoped-memory.test.ts tests/scoped-stage.test.ts tests/scoped-photo.test.ts tests/memory-create-scope.test.ts tests/exhibit-version.test.ts`，47 项通过。
- 新增 21 项审计回归，逐类覆盖成功记录和审计失败回滚；覆盖跨馆、成员撤销、非法绑定、版本冲突及归档幂等。
- 第一次完整检查发现测试夹具缺少永久删除的 `confirm: true`，已修正；不是业务实现问题。
- 最终 `pnpm check` 通过：typecheck、lint、268 项测试、format:check。
- `git diff --check` 通过。

按 `code-review-and-quality` 复查正确性、模块边界、可读性、安全和性能：无阻断问题。复用了 H1 writer 与已有事务，新增读取为固定数量，不新增循环查询或通用抽象；照片归档读取使用现有运行时类型校验。不需要额外简化或无关重构。

未执行全站浏览器回归、生产构建或正式站人工操作；以下人工路径待用户验收。

## 人工验收路径

1. 在本地隔离数据库/测试环境运行上面的局部命令，确认 47 项成功；不要直接在生产库制造失败触发器。
2. 使用馆长或协作者创建记忆与 Stage，检查 `audit_logs` 中相应 `memory.create` / `stage.create` 的 actor、museum 和对象 ID。
3. 修改记忆、切换封面或重排照片，检查对应事件及版本 before / after；编辑 Stage 封面后检查 `stage.details` 的封面标识，并确认版本只加一。
4. 使用两个旧版本编辑窗口造成冲突，或使用已退出的成员提交修改；确认修改失败且无对应成功记录。专项测试也提供了这些用例。
5. 在隔离库参照测试的 `fail_audit` 触发器拒绝审计写入，确认记忆、Stage、封面关系、版本和照片归档均不改变；移除测试触发器后重试可成功。
6. 连续两次归档同一张照片，确认只产生一次 `photo.archive`。现阶段没有审计页面，可通过 SQLite 查看 `SELECT actor_user_id, museum_id, action, object_type, object_id, timestamp, diff FROM audit_logs ORDER BY rowid;`。

## 回滚与限制

本步没有新迁移。回滚 H2a 的四个业务接入模块至 H1 基线即可，保留 H1 表和已有记录；不需要恢复 SQLite 或照片目录，也不应为代码回滚删除审计数据。

既有永久删除操作仍不可逆，审计记录不是内容备份；若真实用户已经删除内容，恢复须沿用现有 SQLite 和照片备份流程。本次验证全部使用隔离内存数据库，没有删除生产数据或物理图片。

H2 尚未全部完成：照片上传和删除审计留给 H2b；H3 的成员、邀请及所有权，H4/H5 的审计页面和活动流均未实施。历史记录不回填，全文 diff / 恢复快照也不是本步能力。

H2a 完成后 STOP，等待人工验收。
