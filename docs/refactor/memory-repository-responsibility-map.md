# Memory Repository 职责盘点

范围仅 `src/data/memory-repository.ts`；本任务不拆分代码，不修改查询。授权仍由上层 Scope / Access 完成，Repository 的 `publicOnly` 或资源 ID 不替代授权。

## Export 查询族

| 查询族 | Export（同名 `InDatabase` 为显式 DB 入口） | 当前职责 |
| --- | --- | --- |
| Active Memory Reads | `listActiveMemories`、`listActiveMemoriesInDatabase`、`listMemorySummariesInMuseumInDatabase`、`listMemoriesByStage` | 活跃/馆内/阶段摘要；馆内入口还支持回收站与搜索条件 |
| Stage Reads / Shelf | `listActiveStages`、`listStageShelfItems`、`listStagesInMuseumInDatabase`、`findStageById`、`findStageByIdInDatabase` | Stage、馆内 Stage、封面，以及 Shelf 的 Memory 计数和前三张预览 |
| Trash Reads | `listTrashedMemories`、`listTrashedStages` | 各自摘要及回收时间排序；复用相应 Row Reader |
| Search / Recall | `searchActiveMemories`、`findRandomActiveMemory`、`findRandomActiveMemoryInDatabase` | 标题/故事搜索和随机活跃 Memory；复用 Memory Summary SQL |
| Detail Reads | `findMemoryById`、`findMemoryByIdInDatabase`、`findMemoryDetails`、`findMemoryDetailsInDatabase` | 摘要与包含展品、关联 Memory、后记的详情；详情保证相关数据同馆 |
| Public Read Model | 以上支持 `publicOnly` 的入口 | 复用 Publication Predicate，而非独立的一套 Repository |

## 是否有两个稳定、能够独立演化的查询族？

是：Stage/Shelf Read Model 与 Memory Summary/Detail Read Model 已有不同的结果结构、Row Reader 和 SQL 基础。Stage 封面/陈列预览需求和 Memory 故事/展品/后记需求具有不同变化原因。

但 Search、Recall、Trash 与 Public 目前只是同一摘要查询的筛选/排序维度，不应各自拆 Repository。Stage Shelf 的计数与预览仍依赖 Memory，因此不是完全无耦合的模块。

未来新增完整 Stage/Shelf 查询族时，可评估形成独立 Stage Read Repository；新增 Memory Detail Read Model 时可评估摘要/详情边界。移动前需证明减少共享上下文和查询重复，并保持馆归属过滤。

当前没有功能变化，不执行拆分，继续保持单 Repository。禁止按行数迁移或为所有查询创建通用接口。
