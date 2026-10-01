# Application / Data 编排边界盘点

分类：A = 明确 Application Orchestration；B = 明确 Data Concern；C = 混合但当前不值得迁移。归属原则以 [架构说明](../ARCHITECTURE.md#application--data-归属规则) 为准。本盘点不移动文件、不改 Import。

| 文件 | 分类 | 当前证据 | Future Trigger |
| --- | --- | --- | --- |
| `src/application/photo-upload-service.ts` | A | 校验、登记任务、落盘、提交照片协调 | 新增上传生命周期时在此扩展，不回填 HTTP |
| `src/application/scoped-photo-upload.ts` | A | 授权、配额预留、异步落盘后重新授权、审计 | 新增独立资产步骤时评估生命周期，不强拆包装层 |
| `src/application/cross-museum-photo-copy.ts` | A | 源/目标授权、Storage Copy、配额、Journal、最终事务 | 新增复制类型时复用资产生命周期，保持原子提交 |
| `src/application/cross-museum-memory-copy.ts` | A | 复用照片复制，版本校验后提交 Memory、展品、后记和审计 | 新增复制资源时检查目标归属与事务边界 |
| `src/application/permanent-museum-deletion.ts` | A | 停写、备份验证、Storage 清理、DB 分阶段收尾 | 修改永久删除流程时保持备份与 Journal 协调归属 |
| `src/data/scoped-memory.ts` | C | 读取入口加授权；写入同时涉及多 Repository、绑定检查、版本与审计 | 下次新增跨 Repository / Storage 编排时，评估仅迁移用例而非整个文件 |
| `src/data/scoped-stage.ts` | C | Scope 读取与 Stage 生命周期、封面绑定、版本、审计混合 | 新增独立生命周期或 Storage 协调时评估用例归属 |
| `src/data/museum-owner-transfer.ts` | C | 同一事务协调馆长、Membership、Support Access、审计和通知队列 | 下次实质修改 Owner Transfer 用例时评估 Application，保留 DB 原语 |
| `src/data/museum-deletion.ts` | C | 读取删除状态与预约/取消用例混合；授权、版本、审计、通知协调 | 下次修改删除生命周期时评估编排边界，不为文件名搬家 |
| `src/data/museum-permanent-deletion.ts` | B | DB 计划、完整性/跨馆绑定检查、Journal、分阶段删除和保护数据指纹 | 新增 DB-Owned 表时显式更新策略；若加入备份/文件协调，则放入已有 Application 用例 |

明确 Application 的现有文件已位于对应层；混合文件有稳定调用与事务边界，当前没有功能变化收益，不执行迁移。永久删除 Data 文件虽包含删除策略，仍是 Application 所调用的 DB 阶段，不承担物理删除或备份创建。
