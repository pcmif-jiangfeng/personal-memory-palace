# MemoryExhibitManager 职责盘点

## 目的与范围

本文只记录 `src/components/memory-exhibit-manager.tsx` 当前承担的职责，并为 Task B2、B3 的窄范围拆分确定边界。本 Task 不修改组件行为或代码。

当前组件同时管理展品编辑、照片库选择、上传接入、请求反馈和页面渲染。后续拆分应按行为职责提取 Hook，而不是按 JSX 区块拆 presentation component。

## 当前直接依赖

| 依赖 | 当前用途 | 职责归属 |
| --- | --- | --- |
| `useRouter` | mutation 成功及上传关联成功后刷新 Server Component 数据 | UI orchestration |
| `useUploadTasks` | 把新文件加入现有上传队列，并在单张上传成功后关联到 Memory | UI orchestration；不纳入 B2 |
| `usePhotoCatalog` | 管理照片库筛选、分页、加载与失败状态 | 现有独立 catalog Hook；不重复封装 |
| `PhotoUsageFilter`、`WorkspacePhotoView` | 约束筛选值和照片库视图数据 | shared contract |
| `copy` | 展品编辑、照片库和反馈文案 | UI orchestration |

## Responsibility A — Exhibit Editor

### 当前状态与派生值

- `selectedPhotoId`：当前选中的展品照片。
- `draftTitle`：当前展品标题草稿。
- `draftDescription`：当前展品说明草稿。
- `metadataDirty`：草稿是否包含未保存修改。
- `selected`：由 `selectedPhotoId` 和 `exhibits` 得到的当前展品；找不到时沿用第一张照片。

### 当前行为

- `loadMetadataDraft`：载入所选展品的标题和说明，并清除 dirty 状态。
- `selectExhibit`：切换所选展品；存在未保存修改时先确认是否放弃。
- `saveMetadata`：保存标题和说明，成功后清除 dirty 状态。
- `moveSelected`：根据当前索引生成完整照片顺序并向前或向后移动。
- `removeSelected`：按封面状态显示相应确认文案；移除成功后选择相邻展品作为回退。
- 标题和说明输入事件：更新草稿并设置 dirty 状态。

### Task B2 应迁移的边界

`useExhibitEditor` 只拥有上述选择、草稿、dirty tracking、保存、排序和移除行为。建议公开面向用途的 API：

```ts
{
  selectedPhotoId,
  selectedPhoto,
  draft,
  metadataDirty,
  selectPhoto,
  updateDraft,
  saveMetadata,
  moveSelected,
  removeSelected,
}
```

Hook 不应拥有 JSX、照片库选择、上传、全局消息组件或通用请求框架。为了维持当前统一的 `busy/message/error` 行为，可由组件向 Hook 注入一个窄的 mutation callback；不要在 Hook 内再复制一套请求和反馈状态。

### 明确留在 B2 范围外的相邻行为

- “设为封面”目前在 JSX 中直接调用 `perform`。它属于展品操作，但 Task B2 的允许迁移清单未包含该动作，因此 B2 不应顺手迁移。
- `request`、`perform`、`busy`、`message`、`error` 被展品编辑和照片添加共同使用，暂时保留在组件编排层。
- `router.refresh()` 保留在共享 mutation orchestration 中。

## Responsibility B — Library Selection

### 当前状态与派生值

- `librarySelection`：照片库中已选择、准备加入当前 Memory 的照片 ID 集合。
- `currentPhotoIds`：当前已成为展品的照片 ID 集合。
- `remainingSlots`：距离每个 Memory 20 张照片上限的剩余数量。
- `filteredLibrary`：从照片库结果中排除已加入当前 Memory 的照片。
- `usePhotoCatalog` 返回的筛选、分页、加载和失败状态。

### 当前行为

- `toggleLibraryPhoto`：切换照片选择，并确保选择数量不超过剩余位置。
- `addSelectedLibraryPhotos`：把已选择照片批量关联到当前 Memory；成功后清空选择。
- 照片库筛选：按使用状态、Memory 关键词和 Stage 筛选。
- 照片库分页：加载下一页。

### Task B3 应迁移的边界

`useExhibitLibrarySelection` 只拥有：

- 已选择照片 ID；
- 单张 toggle；
- clear；
- 剩余位置限制；
- 批量加入已选择照片；
- 与批量加入直接相关的状态。

建议公开面向选择行为的 API：

```ts
{
  selectedPhotoIds,
  remainingSlots,
  togglePhoto,
  clearSelection,
  addSelected,
}
```

`usePhotoCatalog` 已经独立负责 catalog 查询、筛选和分页，B3 应直接复用，不把它包进新的 selection Hook。`filteredLibrary` 可以保留在组件作为两个职责之间的组合结果，也可以在 B3 中仅以输入集合计算；选择其中更少耦合的实现，不改变筛选行为。

### 上传边界

`upload` 与“向 Memory 添加照片”概念相关，但它依赖文件输入、全局上传队列、逐张上传回调和 `router.refresh()`。Task B3 只处理 library selection，因此上传协调继续留在组件层。不要把 `useUploadTasks` 或文件输入 ref 移入 selection Hook。

## Responsibility C — UI Orchestration

以下职责继续由 `MemoryExhibitManager` 保留：

- 组合 `useExhibitEditor`、`useExhibitLibrarySelection`、`usePhotoCatalog` 和 `useUploadTasks`。
- 渲染当前展品条、检查器、展签表单、照片库筛选、分页和上传入口。
- 连接按钮和表单事件到 Hook 暴露的用途明确的动作。
- 维护共享的 `busy`、`message` 和 `error` 反馈。
- 执行当前 Memory mutation 请求并在成功后 `router.refresh()`。
- 协调上传成功后的照片关联。
- 持有文件输入 `inputRef`，在加入上传队列后清空输入。
- 将 `libraryLoadFailed` 与 mutation error 映射到现有 alert。
- 保持空展品、已达上限、照片库无结果等展示分支。

组件收尾时可以继续保留 200–300 行。目标是让组件表达 Hook composition、render、event wiring 和反馈呈现，而不是追求固定行数。

## 跨职责耦合与行为约束

后续提取必须保持以下现有行为：

1. 所有 mutation 共用一个 `busy` 门闩，进行中不会并发执行另一个展品或照片库 mutation。
2. 切换展品时，未保存展签必须先确认；取消确认后选择和草稿均不变化。
3. 移除展品成功后，优先选择后一张，没有后一张时选择前一张。
4. 排序请求发送完整的展品 ID 顺序。
5. 照片库选择数不能超过 `remainingSlots`，成功加入后才清空选择。
6. 已在当前 Memory 中的照片不出现在可添加列表。
7. 上传文件按剩余位置截断，并继续使用现有 `UploadTaskProvider` 流程。
8. mutation 成功继续显示原有成功消息并刷新服务端数据；失败继续显示统一错误。

## 后续 Task 边界

- **B2**：只提取 Exhibit Editor；不改照片库、上传或 JSX 结构。
- **B3**：只提取 Library Selection；继续复用 `usePhotoCatalog`。
- **B4**：只整理 Hook 组合、事件连接和反馈呈现；除非 JSX 存在明确独立语义且严重影响阅读，否则不继续拆 presentation component。
