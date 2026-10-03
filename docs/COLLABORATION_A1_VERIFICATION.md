# A1 自检报告：旧数据只读审计

日期：2026-10-03。结果：A1 完成；A2 类型/旧授权迁移尚未实施，网页协作功能未启用。

## 修改与行为

- scripts/audit-collaboration-migration.ts：仅接受明确的现有 SQLite 文件。通过 readOnly、query_only 和单次读事务形成一致快照，不调用应用数据库初始化或迁移，不提供 apply 模式。
- tests/collaboration-migration.test.ts：5 项隔离测试验证数据库字节不变、多馆不猜类型/配额、未知作者、未归属照片/Stage、缺失owner、缺失/不兼容数据库、CLI拒绝写入参数。
- tasks/plan.md、todo.md：记录实施授权与 A1 完成状态。

输出馆/owner 映射、旧成员/邀请数量、原额度与已登记用量、所有带 museum_id 表的总数/未归属数量、历史未知作者和未完成作业。类型/账号额度仅为建议，不是迁移决定；未撤销邀请数量不等于当前可接受邀请数量，登记用量不等于物理文件实测。

命令示例（替换为待审计的已有副本路径）：

```powershell
node --experimental-strip-types scripts/audit-collaboration-migration.ts --database D:/path/to/copied/palace.sqlite
```

报告包含owner邮箱，用于本地迁移映射，不应上传GitHub或公开；不会输出密码哈希、token摘要、标题、正文、Note或原始照片文件名。命令失败只输出固定错误说明。

## 验证证据

1. 初始测试 RED：新模块未实现时失败。
2. 首轮4项 GREEN；审查发现未归属照片/Stage漏项，新增测试 RED捕获，再修复。
3. 最终 pnpm test:file tests/collaboration-migration.test.ts：5/5通过，无跳过。
4. pnpm test：461/461通过，0失败/跳过/取消。
5. pnpm typecheck、针对新增两文件的ESLint检查：通过。
6. 新增文件Prettier格式化后进行全量测试；最终格式/差异检查见本次交付结果。

## 代码审查结论与限制

只读边界、CLI参数、数据库一致快照、敏感字段投影和缺失数据处理已审查。修复了未归属表覆盖缺口，元数据表名使用SQL标识符转义；不引入依赖或通用抽象。

当前仅支持包含审计所需字段的现有数据库，缺失字段拒绝而不自动升级。历史无法推断项留作显式迁移映射，不伪造作者或配额。

没有执行真实数据审计或腾讯云操作；测试只在隔离目录运行并自动清理。没有页面改动，本项未启动网页或浏览器验收；A阶段检查点另运行lint/build及迁移整体回归。尚未提交、推送或部署。
