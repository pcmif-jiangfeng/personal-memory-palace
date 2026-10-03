# B3 共同创建与私人默认服务自检

日期：2026-10-03。状态：本地完成，未部署。

- 创建服务区分private/shared，私人仍每个账号最多一座，共同可多座；首馆之后不增加账号额度。
- 默认查馆只查私人类型，不再根据创建时间选择共同馆。
- 服务端复核账号及邮箱验证，明确投影name/slug/description/type，不接受伪造owner或配额。
- POST `/api/museums` 可选museumType，省略为private；只接受private/shared，null及未知字段拒绝。响应增加museumType，原id/slug保持。PATCH不提供类型转换。
- typed Museum新增museumType，删除状态读取复用该类型。无新依赖、创建数限制或成员权限开放。

验证：17项相关测试通过；新测试先失败再修复。`pnpm test`475/475、typecheck及lint通过。覆盖共同馆先创建、后来私人馆、10座自有馆仍明确选私人、重复私人/slug、未验证和伪造配额。

审查：局部唯一索引是最终约束，创建事务串行；共享创建不会因已有私人馆误报重复；新类型请求不触发转换。UI及真实浏览器检查在B4完成。
