# 2026-10-01 改进自检报告

本报告按任务完成顺序更新。检查通过只代表已列出的验证范围，不表示生产部署或所有功能已经重新验收。

## A1 — 当前架构事实同步：通过

- 修改：`docs/ARCHITECTURE.md`；多用户、多馆、Scope、Application、版本化迁移及存储一致性描述与实现对齐。
- 验证：文档链接存在；`git diff --check` 通过。仅文档修改，未运行代码测试。
- 行为变化：无。请求 scope 实际路径为 `src/memory-request-scope.ts`，已纠正文档中的旧路径。

## A2 — 开发约束：通过

- 修改：`docs/DEVELOPMENT_CONSTRAINTS.md`；补充三层 Scope、Application 判断、Repository 增长规则与稳定组件冻结规则。
- 验证：逐条对照 A2 要求；架构引用目标存在。仅文档修改，未运行代码测试。
- 行为变化：无；不移动现有混合用例，不按行数拆分。

## B1 — Application/Data 规则：通过

- 修改：规则并入 `docs/ARCHITECTURE.md`，不创建第二份相同说明。
- 验证：四层职责、现有混合用例保留与未来迁移条件逐条对照要求；相对链接目标存在。
- 行为变化：无；未运行代码测试。

## B2 — 编排热点分类：通过

- 新增：`application-boundary-inventory.md`，覆盖指定的 10 个文件，逐项分类并提供 Future Trigger。
- 验证：仅核对指定代码与直接边界；5 个 A、4 个 C、1 个 B；未移动文件、改 Import 或运行测试。
- 行为变化：无；没有立即迁移的必要。

## C1 — HTTP 双重断言：通过

- 修改：`src/http/museum-owner-transfer.ts` 显式收窄数字版本并构造已验证对象；相关测试增加字符串、null、不安全整数输入。
- 验证：修改前后 `pnpm typecheck` 通过，馆长转移测试 8/8 通过；局部格式检查发现问题后已修正并通过，差异检查通过。
- 审查：原确认、目标、Disposition、额外字段拒绝规则保留；没有改业务逻辑、Route 或依赖。合法请求行为不变。

## C2 — Invite SQLite Row：通过

- 修改：`src/data/invite-management.ts` 使用局部 `readInviteSummaryRow`，复用 String/Nullable String/Number Reader，校验 Use Mode；计数也使用 Number Reader。
- 验证：新增 BLOB 混入 TEXT 的回归测试在修改前失败，修改后通过，并证明撤销失败时 timestamp 与 audit 均回滚；类型检查、20 项邀请/转移相关测试、局部 ESLint 和格式检查通过。
- 审查：SQL、分页、权限、Token 生成与哈希规则未改变。异常 DB 类型现在拒绝输出；合法数据行为保持。

## C3 — 类型边界扫描：通过

- 范围：仅 `src/http/`、`src/data/`、`src/application/` 搜索 `as unknown as`。
- 结果：C1/C2 修复后 0 处，无需进一步分类或修改。代码修改后的类型检查已通过。

## D1 — 单文件测试入口：通过

- 修改：`package.json` 添加 `test:file`，保留原 `test` 脚本及 Node Runner，没有新增依赖。
- 验证：实际执行 `pnpm test:file tests/scoped-memory.test.ts`，6/6 通过；JSON 格式检查通过。
- 行为变化：仅增加开发命令；未执行完整测试或构建。

## D2 — 可选模块脚本：按计划跳过

- 单文件入口已可工作，没有实际使用证据表明需要更多脚本；不预建 `test:changed` 或模块入口。

## E1 — Memory Repository 盘点：通过

- 新增：`memory-repository-responsibility-map.md`；覆盖所有 Export，区分 Stage/Shelf 与 Memory Read Model，说明共享查询的筛选维度不构成独立模块。
- 验证：逐项对照指定文件；仅分析、不读取调用方、不改代码、不运行测试。
- 结论：存在未来独立查询边界，但当前继续保留单 Repository。

## E2 — Management Repository 盘点：通过

- 新增：`management-repository-responsibility-map.md`；覆盖内容、关系、回收站、永久删除、批量操作及 Export Contract。
- 验证：逐项对照指定文件，明确批量部分成功及 DB Queue 不等于物理删除；未修改代码或运行测试。
- 结论：Trash Lifecycle 是未来候选，不在本轮拆分。

## F1 — 历史文档归档：通过

- 将 44 份 Task12 验证/进度/诊断记录移至 `docs/archive/task12/`；分 8 批，每批最多 6 份，逐份 SHA256 校验内容一致，没有删除历史记录。
- 新增 `docs/archive/README.md` 导航；现行架构、约束、Runbook、Policy 保留主目录。F4 保留原路径以维持其现行照片迁移指南链接，不改历史内容。
- 验证：主文档、新盘点、索引及历史 I 汇总的 22 个相对文件链接均存在；`git diff --check` 通过。
- 行为变化：只有文档位置变化，无业务代码变更。

## F2 — 可选旧任务文件整理：评估后保留

- `任务文件/` 包含产品定义、当前阶段任务，以及开始前已有的用户修改/未跟踪文件；不是可以全部视为失效的历史文件夹。
- 没有移动或删除其中任何文件，避免改变当前工作入口。根目录没有独立旧 Task 文件需要归档。

## 最终代码审查与范围

- 正确性：HTTP 验证后构造类型对象；邀请每个输出字段通过已有 Reader，模式显式验证。异常字段拒绝有修改前失败、修改后通过的回归证据。
- 安全/数据完整性：授权、SQL、Token 哈希、审计事务保持；异常 Row 导致撤销回滚。未读取密钥、连接生产数据、执行迁移或删除用户照片。
- 回归/性能：20 项邀请/馆长转移测试与 6 项 Scoped Memory 测试共 26 项通过；类型、局部 ESLint、代码格式与差异检查通过。未新增查询、依赖或框架。
- 可维护性：新增局部 Reader 是实际 DB 边界，不建立 Generic Mapper；冻结组件和 Repository 文件均未改动，没有新增无用包装或孤立代码。
- 文档：规则只维护于架构入口；Repository 候选只记录未来触发条件，不立即拆分。归档内容完全保留。
- 结论：本计划必做项 A1/A2、B1/B2、C1/C2/C3、D1、E1/E2、F1 已完成；可选 D2/F2 已评估并跳过。限定检查范围内没有未修复的阻断问题。
- 未验证：完整测试、生产构建、浏览器与腾讯云运行状态，按原计划不在本轮执行。代码尚未提交、推送或部署。
- 仍保留的技术债：Data 层混合编排与 Repository 潜在边界按计划保留；不是本轮未完成项。开始前的 `next-env.d.ts`、任务提示词及未跟踪任务文件未覆盖。
