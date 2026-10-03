# 已完成计划归档：Code quality audit remediation

日期：2026-10-03。原 tasks/plan.md 和 tasks/todo.md 的任务及检查点全部已完成；此文件保留历史摘要，不是新实施授权。

原方案保留 Next.js/SQLite 单体与既有依赖，以小步修复代码质量审查项。业务失败使用 typed domain errors，写接口 same-origin后授权，文件操作数据库作业重试，照片目录分页。

- [x] Task1 Typed domain errors，移除 data-to-HTTP imports。
- [x] Task2 Same-origin mutation protection与路由测试。
- [x] Task3 Share-token rotation、代理与分享部署约束。
- [x] Phase1 typecheck/lint/tests/build。
- [x] Task4 Pending deletion recovery、报告未解决作业。
- [x] Task5 Upload/backup recovery与备份停写约束。
- [x] Phase2故障注入retry/recovery。
- [x] Task6 Paginated photo catalog与workspace分页。
- [x] Task7 Canonical related-memory edges与双向编辑测试。
- [x] Complete全量检查与审查复核。

原风险约束：幂等迁移测试；路由测试不绕过cookie/origin；本地运行时文件不进入源码提交。原完整文件版本仍由Git保留。
