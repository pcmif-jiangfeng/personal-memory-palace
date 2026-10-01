# 开发约束

本文件约束后续功能开发和重构时的复杂度增长；具体运行边界见 [架构说明](ARCHITECTURE.md)。

## 新功能开发前

先检查：

1. 当前组件承担了多少项独立职责和交互状态；
2. 是否已有可扩展的 Hook、`src/client/` API 或领域函数；
3. 新逻辑是否重复了已有逻辑，且是否会因同一个原因一起变化；
4. 是否正把网络请求及其错误处理继续加入大型组件。

如果一个组件已承担多个独立交互状态机，优先沿现有职责边界扩展，不再向组件本体增加独立状态和副作用。新增抽象须解决当前明确的问题，并沿用项目已有模式。

## 不按行数机械拆分

文件达到某个行数（例如 300 行）本身不是重构理由。判断是否拆分，应看：

- 职责是否内聚；
- 状态之间是否相互耦合；
- 不同需求的修改是否反复影响同一处；
- 拆出后能否独立测试；
- 是否存在稳定的概念边界。

只抽取有明确归属且能降低当前修改成本的模块，不为未来可能出现的需求预先建立层、接口或框架。

## Multi-Museum Scope Rule

新增或修改 Memory、Stage、Photo、Share、Exhibit、Trash、Notification、Invite 操作时，必须检查当前 User、Museum scope 和资源归属。资源 ID 或客户端提交的 `museumId` 都不是授权依据；关联资源必须绑定同一个 `museum_id`。异步操作提交时也要重新检查当前权限与生命周期状态。

## Application Layer Rule

涉及两个及以上 Repository、DB + Storage、Access + Mutation + Audit 或跨 Museum 协调时，优先评估 `src/application/` 用例编排。单表 CRUD 不强制包装 Service；现有 Data 层混合用例不为目录一致性批量移动。具体归属规则以 [架构说明](ARCHITECTURE.md) 为准。

## Repository Growth Rule

只有出现以下边界才考虑拆分：两组操作因不同业务原因独立变化；文件名无法准确表达职责；新功能持续进入 `management-*` 等泛化容器；能够形成稳定的 Read Model、Lifecycle 或 Mutation 边界。新增整类查询或独立生命周期前先评估，不以超过 300 行作为拆分理由。

## Stable Component Freeze Rule

`photo-viewer.tsx`、`photo-workspace.tsx`、`upload-task-provider.tsx`、`memory-exhibit-manager.tsx` 保持冻结，不因行数继续拆分。只有新增独立状态机、重复 Mutation Lifecycle、跨 Feature 逻辑或频繁冲突修改时，才重新评估边界。

## 局部维护验证

文档修改仅做事实与链接检查。代码修改优先运行相关测试和 `pnpm typecheck`；不默认运行浏览器、完整测试或生产构建。新增 Schema 变化追加 Migration 版本，不改已执行的历史版本。
