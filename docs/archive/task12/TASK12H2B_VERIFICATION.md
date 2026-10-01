# Task 12H2b — 照片上传与删除审计验收记录

## 完成范围

主要修改两个文件：

- `src/application/scoped-photo-upload.ts`：照片入库与 `photo.upload` 审计共同提交。
- `src/data/photo-deletion-service.ts`：创建删除队列及移除照片记录时共同写入 `photo.deleteQueued`。

新增测试 `tests/photo-audit.test.ts`，以及本文。没有新迁移、依赖、API 或页面；保留前面 G5、H1、H2a 的全部改动。结合 H2a，本次完成 H2 的内容操作审计接入，不执行 H3 的邀请/成员/所有权审计。

## 上传语义

原流程仍是验证图片 → 创建 pending upload → 保存文件 → 再次检查成员权限 → 提交照片及审计。actor 和 museum 使用已授权服务端 scope，object ID 使用真正入库的照片 ID；diff 仅记录宽高，不记录文件名、文件路径、图像内容、账户字段或凭证。

照片入库、pending journal 移除与审计共享事务。任何审计异常均回滚入库，不留下成功事件。此前已保存的文件不能用 SQLite 回滚，但原 pending journal 保留，可由已有 `recoverPendingUploads` 清理；不引入另一套恢复逻辑。

图片验证或文件保存失败不产生成功审计；保存过程中成员被撤销时，再次授权拒绝入库与审计。非 ApiError 的提交异常仍沿用原 `IMAGE_STORAGE_FAILED` 返回，不改变 API 错误协议。

## 删除语义

删除有两个阶段，不能跨文件系统与 SQLite 假装成单一事务：

1. 在数据库事务中检查 Owner、馆归属及引用关系，创建删除队列，移除照片记录，写入 `photo.deleteQueued`。
2. 提交后异步删除物理文件，再清除队列。

`photo.deleteQueued` 只声明数据库层已接受删除并进入清理流程，不声明文件已清理。审计失败时阶段 1 全部回滚，阶段 2 不会开始。文件清理或队列清除失败时保留原队列，原审计事件依然准确，重试和启动恢复不重复记账、不改写原 actor。

本步没有独立的“物理删除完成”事件；判断未完成清理时仍需查看 `photo_deletion_jobs`。历史已有队列不回填或伪造操作者。Memory/Stage 永久删除引起的清理仍由 H2a 的父对象事件追溯，不为恢复工作额外编造用户操作。

批量删除继续按对象部分成功，输入 ID 去重；只为新进入队列的对象各记录一次。完成删除后再次调用有 scope 的删除接口，仍按原规则返回 `PHOTO_NOT_FOUND`，不新建事件。无 scope 的遗留内部删除助手不伪造身份，行为保持。

## 验证与审查

- 局部命令：`node --experimental-strip-types --test tests/photo-audit.test.ts tests/scoped-photo.test.ts tests/photo-deletion.test.ts tests/photo-upload-service.test.ts`，29 项通过。
- 新增 11 项测试：上传成功身份/对象/尺寸、非法图片、保存失败、提交审计失败与恢复、异步权限撤销、删除审计失败、文件清理重试、队列收尾重试、启动恢复、越权/跨馆/被引用对象、批量去重及历史队列。
- 最终 `pnpm check` 通过：typecheck、lint、279 项测试、format:check。
- `git diff --check` 通过。

按 `code-review-and-quality` 检查事件时机、事务、可信身份、敏感信息和性能，未发现阻断问题。复用 H1 writer 及已有授权、事务和恢复队列；每个成功操作只增加一条参数绑定 INSERT，没有新增抽象或循环查询，无需额外简化。

没有执行生产构建或全站浏览器回归。专项测试使用内存数据库、真实的小型 WebP 验证及模拟文件存储，不删除用户照片；没有推送、提交、部署或访问正式站数据。

## 人工验收路径

1. 在本地/隔离测试环境运行上述局部命令，确认 29 项通过；失败触发器仅可在隔离库使用。
2. 上传一张合法照片，在 `audit_logs` 检查 `photo.upload` 的 photo ID 与照片表一致，actor、museum 正确，diff 只有宽高；尝试无效图片确认没有成功事件。
3. 参照专项测试在保存后撤销成员权限或拒绝审计写入，确认新照片未入库、成功事件为零，pending upload 留存并可恢复清理。
4. 删除一张无引用照片，检查一条 `photo.deleteQueued`；对被记忆/封面引用的照片、他馆照片或协作者删除请求，确认拒绝且不写成功事件。
5. 参照测试模拟文件删除失败或队列清除失败，确认队列可重试，原事件保持不变；启动恢复也不新增重复记录。
6. 批量删除包含重复、可删与不可删对象的集合，确认部分成功协议保持，每个新排队对象只记一次。事件查询可用 `SELECT actor_user_id, museum_id, action, object_id, timestamp, diff FROM audit_logs WHERE action IN ('photo.upload', 'photo.deleteQueued') ORDER BY rowid;`。

## Rollback Plan 与剩余边界

本步无迁移。回滚两个接入文件到 H2a 基线即可；保留 H1 表与审计数据，不需要为代码回滚恢复 SQLite 或照片目录。不要为回滚代码删除待处理队列，否则会失去原有文件恢复能力。

审计失败前尚未开始物理删除，数据库可回滚；物理文件已经成功删除后不可用代码回滚恢复，必须使用现有 SQLite/照片备份恢复流程。审计事件不保存图像，不能用作照片备份。

H2a + H2b 已完成 H2 的内容关键操作接入，但不包含全文 diff、历史回填、防篡改机制或审计页面。H3 的邀请/成员/所有权、H4/H5 的页面与活动流仍待后续任务。

本步 STOP，等待人工验收，不自动执行 H3。
