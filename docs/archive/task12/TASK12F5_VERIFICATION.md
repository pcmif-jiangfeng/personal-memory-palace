# Task 12F5 — Trash / Share / Secondary Relations Scope

完成日期：2026-09-27。仅完成 F5；未开始 F6，未提交、推送、部署或迁移真实数据。

## 修改总结

- 新增 `src/data/scoped-share.ts`：在同一事务内检查可信 User、active Museum、Memory 归属及状态。分享配置、关闭和轮换仅限本馆 Owner；协作者不能配置分享，非成员和跨馆 Memory 拒绝。
- `src/app/api/shares/route.ts` 与 `src/client/share-api.ts` 接入 User/Museum scope；旧馆长 cookie 不再授予分享管理权，同源检查保持在授权之前。
- `src/data/share-repository.ts` 写入分享的 Museum 归属。访客读取、密码授权 cookie 和媒体授权共同检查分享/Memory 归属、启用状态、Memory 可见性/回收站状态与 Museum 生命周期。关闭或轮换失效，pending_deletion 拒绝。密码仍使用 scrypt，token 仍使用安全随机字节，无认证机制替换。
- `src/data/memory-repository.ts` 按实际 Memory 的 Museum 过滤展品、照片、补充说明与关联 Memory，公开访客读取也不绕过该过滤。分享详情只返回公开关联 Memory，不返回同馆私有记忆。
- `src/data/publication-repository.ts` 增加 active Museum 的公开 Memory 读取条件，避免 Museum 待删除后仍经旧公开路径可读。未迁移的历史 null 归属维持旧内部兼容，不授予成员管理权。
- `src/data/scoped-memory.ts` 通过 LEFT JOIN 检出缺失上传记录的异常展品，不再跳过这些绑定后继续修改。
- `src/data/management-repository.ts` 将 Memory/Stage 永久删除产生的照片队列写入 Museum 归属。已有队列的照片 ID、键或归属冲突时回滚整个删除，不静默忽略队列约束后移除照片记录。
- 更新 `tests/same-origin.test.ts`；新增 `tests/scoped-share.test.ts`；扩展 `scripts/verify-memory-scope.mjs` 的真实 Share API 与 Trash 生命周期验收。

Trash 的逐项恢复、永久删除、部分成功返回和 Owner-only 永久删除规则沿用 F2/F3 的授权入口；本阶段没有另建管理系统或修改回收站体验。Later Notes、Related Memory 和 Cover/Exhibit 写入沿用已有事务式 scoped Memory/Stage 管理入口，新记录归属保持与主对象一致。

## 验证结果

- 新增 4 项 SQLite 测试：Owner/跨馆权限、分享归属与轮换/关闭/生命周期、访客次级关联过滤、密码与隐藏/回收站、照片队列归属及冲突删除回滚。测试覆盖同照片 ID 与同物理键的两种队列冲突。原始冲突用例先复现失败，再经最小修改通过。
- `pnpm check`：TypeScript、ESLint、216 项测试、格式检查通过。
- `pnpm build`：生产构建成功，隔离生产服务启动成功。
- 真实 HTTP：Share API 匿名401、协作者403、非成员/跨馆404、跨站403、旧馆长 cookie401；Owner 配置分享写入馆归属；链接可读、轮换后旧链接404；错误密码401，正确密码设置授权 cookie 并读取分享；Trash 后404、恢复后可重新配置；关闭后404；成员撤销和 Museum pending_deletion 拒绝。
- 真实 Chrome：上传、缩略图、选照片创建 Memory、Memory/Stage 编辑与 Museum 导航回归通过，页面/控制台无错误。本次未增加分享界面功能。
- `git diff --check` 通过。测试使用临时 SQLite、合成账号、独立端口与隔离浏览器 context；结束后清理服务与数据，无新增依赖。

复现：先 `pnpm build`，再执行 `node --experimental-strip-types scripts/verify-memory-scope.mjs`。浏览器模式复用现有 PALACE_TEST_PLAYWRIGHT / PALACE_TEST_CHROME 环境变量，不指定时仅运行 HTTP。

## 代码审查及行为边界

按 security-and-hardening 与 code-review-and-quality 检查授权、事务、访客过滤、回归、职责及查询边界；修复了次级读取未过滤、Share 旧授权、异常队列丢失照片记录等问题。SQL 参数绑定、复用现有仓库与密码/token 机制，不增加依赖或通用框架。本阶段未发现未解决的阻断项。

明确行为变化：分享配置从旧馆长权限切换为 Museum Owner；异常归属的分享及次级内容拒绝/过滤；待删除 Museum 的公开 Memory 与分享不可读。

保持的产品行为：分享仍遵循现有“Memory 本身及所属章节对访客公开”的规则，不将其扩展为私有 Memory 的独立访客通道。协作者退出后不能管理馆内容；已经由 Owner 启用的公开分享仍是独立访客授权，不因某个协作者退出自动关闭。

剩余边界：F6 的专门 IDOR/Cross-Museum 测试矩阵尚未开始，本报告不代表整个 Task12 已完成。F4 的真实历史照片迁移仍需按既定停写、备份和恢复流程操作，未在本次自动执行。
