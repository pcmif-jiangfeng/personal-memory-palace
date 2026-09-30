# Task12K1 — Cross-Museum Photo Copy 自检报告

日期：2026-09-30。依据 `任务文件/task12.md` 的 K1；本轮按用户授权顺序继续 K 阶段，每项独立验证，遇到非预期错误停止。

## 结果

K1 完成。用户在照片整理台选中一张照片后，可选择自己有访问权的另一座 active Museum 并复制。目标获得新 Photo ID、独立优化图和（源照片保留原片时）独立原片，不共享文件或原关系。目标配额包含全部复制资产；源行、文件及用量不变。

## 修改文件

- `src/application/cross-museum-photo-copy.ts`：复制编排，预留前及提交前重查两馆权限与源绑定，生成独立 ID，提交和目标审计在同一事务内。
- `src/storage/photo-copy-storage.ts`：真实文件复制而非硬链接，拒绝覆盖，检查真实路径归属和文件尺寸。
- `src/storage/photo-storage-key.ts`、`src/data/photo-storage-quota.ts`：允许同馆原片参与已有配额预留；普通上传约束保持不变。
- `src/http/museum-copy.ts`、`src/app/api/photos/[id]/copy/route.ts`：严格校验目标，仅从服务端 Session 获取操作者；同源保护；成功返回 201、Photo ID 和目标馆 ID。
- `src/components/museum-copy-form.tsx`、`src/components/photo-workspace.tsx`、`src/app/workspace/page.tsx`、`src/i18n/zh-CN.ts`：单张复制入口、目标列表、成功导航及明确失败提示，禁止自动重试。
- `src/app/account/museums/[id]/audit/page.tsx`：复制照片审计中文标签。
- `tests/cross-museum-photo-copy.test.ts`、`scripts/verify-museum-copy.mjs`：专项单测、生产 HTTP 和真实 Chrome 验收。

## 验证与审查

- 26 项复制、配额及照片 scope 专项 / 相关测试通过，其中 K1 新增 7 项。
- `pnpm check` 通过：376 项测试全部通过，typecheck、lint 和格式检查通过。
- 隔离临时数据目录的生产构建通过。
- 真实生产 HTTP：无登录 401、跨源 403、伪造身份字段 400、无目标权限 404、空间不足 507；配额失败不写文件、照片或预留日志。
- Chrome：选中照片、选择目标、点击复制、进入目标整理台通过，无 page / console errors。
- 文件字节一致且不是同一 inode；通过真实 API 删除测试源照片后目标照片仍可读取。
- 原片与优化图总量检查、复制期间撤权、审计失败与现有恢复队列回收通过。
- 代码质量与安全审查核对 IDOR、两馆权限、异步期间状态变化、物理路径、配额、事务及恢复记录，未发现阻断问题。无新依赖或迁移。

## 人工验收

1. 使用同时能访问两座馆的测试账号，在源馆整理台选择一张照片。
2. 选择另一座 active Museum，点击「复制这张照片」。
3. 点击「查看目标博物馆」，确认副本在目标整理台、源照片仍在源馆。
4. 用独立测试照片删除源照片，确认目标副本仍可使用；空间不足目标应明确失败。

## 限制与回滚

本项每次复制一张照片，暂不提供批量复制。失败后的目标文件继续由既有 pending_uploads 恢复队列追踪，不对正在进行的其他上传自动执行全局恢复；按已有停写恢复流程清理，回收前保留配额占用。

本项无新 migration。回退代码不会删除已成功创建的副本；这些副本可继续由原有 Photo 管理流程处理。不需要恢复源数据库或照片。需要精确恢复整个测试前状态时使用一致 SQLite / 照片备份；本轮只使用合成数据，没有操作正式站。
