# Management Repository 职责盘点

范围仅 `src/data/management-repository.ts`；不改代码，不新增 Service。当前函数是 DB Mutation 原语，Museum/资源授权与审计由 Scoped 用例协调，不能作为绕过授权的请求入口。

## Export Mutation 族

| 查询/变更族 | Export | 当前职责 |
| --- | --- | --- |
| Content Mutation | `updateMemoryDetailsInDatabase`、`updateMemoryDetails`、`addLaterNote` | 标题/故事/阶段、可选版本比较、后记校验和持久化 |
| Relation Mutation | `updateMemoryRelationsInDatabase`、`updateMemoryRelations` | 关联去重、数量限制、目标存在性、事务内替换关系 |
| Trash Lifecycle | `trashMemoryInDatabase`、`trashMemory`、`restoreMemoryInDatabase`、`restoreMemory`、`trashStageInDatabase`、`trashStage`、`restoreStageInDatabase`、`restoreStage` | 软删除与恢复；Stage 移入回收站时解除 Memory 绑定并调整公开状态 |
| Permanent Deletion | `permanentlyDeleteMemoryInDatabase`、`permanentlyDeleteMemory`、`permanentlyDeleteStageInDatabase`、`permanentlyDeleteStage` | 删除处于回收站的记录，关联未引用照片进入可重试删除队列 |
| Batch Operations | `applyTrashBatchInDatabase`、`applyTrashBatch` | 去重后逐项执行 Trash Action，返回成功 ID 与失败；不是整个批次的原子事务 |
| Lifecycle Contracts | `TrashItemType`、`TrashAction`、`TrashBatchResult` | 回收站对象、动作和部分成功结果 |
| Content Contract | `UpdateMemoryDetailsInput` | 内容更新输入；不提供请求授权 |

`mark` 与 `queueUnreferencedPhotos` 是内部辅助，不是 Export。照片队列检查现有 Job 归属，登记 Job 后删除照片记录；此文件不直接删除物理图片。

## 独立变化原因与未来边界

Trash Lifecycle（软删、恢复、永久删除、批量结果与照片清理队列）已具有独立于故事编辑/关联修改的变化原因，是未来拆分候选。Batch 与 Permanent Deletion 共享生命周期，不应为了行数拆成多个微型 Repository。

下次新增回收站保留规则、批量事务语义或永久删除协调时，先评估 Lifecycle Repository；跨 Storage 或 Audit 编排仍应由 Application/Scoped 用例拥有，而不是加入这个泛化容器。

当前保持文件和所有 Export，不执行拆分。下一次新增独立 Mutation Lifecycle 前必须重新判断归属，不能无条件塞入 `management-*`。
