# Task 12H3 — 现有邀请、加入与退出审计验收记录

## 完成范围

本步完成 H3 **现有入口**，并非 H3 所有生命周期能力已完成。

- `src/data/invite-management.ts`：邀请创建、撤销与审计共同提交。
- `src/data/invite-acceptance.ts`：接受邀请时，成员关系、邀请使用次数与加入审计共同提交。
- `src/data/museum-leave.ts`：主动退出时，成员撤销与退出审计共同提交。
- 新增 `tests/membership-audit.test.ts` 和本文。

没有新迁移、依赖、API 或页面，保留 G5、H1、H2a、H2b 的全部改动。实际代码尚无移除成员、所有权转移及博物馆删除生命周期服务；不在审计子任务中提前实现这些功能，也不编造事件。

## 事件与行为

| 事件 | 操作者与对象 | diff 内容 |
| --- | --- | --- |
| `invite.create` | 服务端 Owner；对象为实际邀请 ID | 使用模式、次数上限、有效期 |
| `invite.revoke` | 服务端 Owner；对象为实际邀请 ID | 无；动作本身表示撤销 |
| `membership.join` | 服务端接受邀请的 User；对象为该 User ID | 邀请 ID、成员状态前后值 |
| `membership.leave` | 服务端主动退出的 User；对象为该 User ID | `active` → `revoked` |

成员关系由 museum + user 唯一标识，museum 已记录在审计行中。首次加入的旧状态为 null；退出后重新加入的旧状态为 `revoked`。邀请令牌、令牌摘要、邀请 URL、邮件地址、密码或密码摘要不进入审计。

所有事件在对应业务事务内写入。审计异常使业务操作失败并回滚；不会留下未审计的有效邀请、消耗的邀请次数或变更后的成员状态。复用已有事务助手，外层事务回滚时内层业务与事件均回滚。

重复撤销保持原撤销时间，不重复记账；有效成员重复接受邀请仍返回 `alreadyMember: true`，不消耗次数或新增事件；重复退出仍返回成功，不新增事件。真正退出后重新加入会记录新的状态转换并按原规则消耗次数。

保留既有响应、错误、权限、有效期、配额及 pending museum 规则。Owner 不能主动退出；待删除博物馆的既有成员仍可主动退出。无效或无权请求不产生成功事件；本步不新增失败请求日志。

## 验证与审查

- 原有邀请管理、接受邀请、退出测试：10 项通过。
- 联合专项命令：`node --experimental-strip-types --test tests/membership-audit.test.ts tests/invite-management.test.ts tests/invite-acceptance.test.ts tests/museum-leave.test.ts`，20 项通过。
- 新增 10 项测试覆盖可信身份、馆归属、敏感信息排除、重复操作、退出后重入、无效请求、审计故障回滚及外层事务回滚。加入回滚同时检查新成员和已撤销成员重新激活两条分支。
- `pnpm check` 通过：typecheck、lint、289 项测试、format:check。
- `git diff --check` 通过。

按 `code-review-and-quality` 复核事务时机、授权来源、幂等性、数据完整性、测试断言及敏感字段，未发现阻断问题。复用已有 writer、授权与事务模式，每次真正状态变化增加一条参数绑定 INSERT；没有新增抽象或无关重构，不需要额外简化。

测试使用隔离的内存数据库。没有执行生产构建、全站浏览器回归、历史回填、提交、推送或部署，没有访问或修改正式站数据。

## 人工验收路径

1. 在本地隔离环境执行上述专项命令，确认 20 项通过；禁止在正式库安装故障触发器。
2. 用 Owner 创建邀请，检查一条 `invite.create`，确认 actor、museum、invite ID 与真实业务对象一致，diff 不含令牌或摘要。
3. 连续撤销同一邀请两次，确认只有一条 `invite.revoke`，撤销时间不变；用另一个馆的 Owner 撤销该邀请，确认拒绝且没有新事件。
4. 创建可重复使用的邀请，让另一位已有自己博物馆的已验证 User 加入，重复加入、退出、重复退出，再重新加入；确认成员事件依次为 join、leave、join，使用次数只增加两次。
5. 参照专项测试，在隔离库拒绝审计 INSERT，分别尝试创建、撤销、加入和退出，确认邀请、成员状态、使用次数和审计历史均保留操作前状态；解除故障后可正常重试。
6. 尝试过期、已撤销、已用尽邀请，以及 Owner 自己加入、未验证用户加入、非成员退出，确认没有成功事件；检查退出后的成员权限已失效。

查询示例：`SELECT actor_user_id, museum_id, action, object_type, object_id, timestamp, diff FROM audit_logs WHERE action IN ('invite.create', 'invite.revoke', 'membership.join', 'membership.leave') ORDER BY rowid;`。审计查询 API 与页面尚未实现，验收使用隔离数据库查询。

## Rollback Plan 与待接入边界

本步无迁移。只回滚以上三个接入模块到 H2b 基线即可；保留 H1 审计表、已有日志、邀请和成员关系。代码回滚不需要恢复数据库或照片目录，也不应删除审计数据。已完成的邀请撤销或成员变更按正常业务操作处理，不能以代码回滚自动逆转；审计不是业务备份。

H3 的以下部分仍未完成，需在对应 J 阶段实现业务时，在同一事务接入并验证审计：

- J1：Owner 移除成员。
- J2：所有权转移。
- J4：启动博物馆待删除流程。
- J5：取消待删除。
- J6：最终永久删除；须同时确认日志保留与现有 museum 外键约束的处理策略，不允许直接删除历史审计以绕过约束。

本步不包含历史回填、失败请求日志、全文 diff、防篡改机制或 H4/H5 审计页面与活动流。现有入口的成功状态转换已审计，未来能力不可因本报告而视为已经覆盖。

本步 STOP，等待人工验收，不自动执行后续任务。
