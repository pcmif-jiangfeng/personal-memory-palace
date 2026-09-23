# Client API 边界清单

## 范围

本清单仅盘点重构计划 Task C1 指定的 11 个 Client Component。当前共发现 11 个直接 `fetch()` 调用点，分布在全部 11 个组件中；所有调用均为同源 `/api/*` 请求。

| Component | Endpoint | Method | Request | Response | 建议 API 模块 |
|---|---|---|---|---|---|
| `memory-editor.tsx` | `/api/memories` | `POST` | JSON：`title`、`story`、`stageId`、`photoIds`、`coverPhotoId`、`relatedMemoryIds` | JSON：成功时使用 `memory.id`；失败时读取 `error` | `src/client/memory-api.ts` |
| `trash-manager.tsx` | `/api/trash` | `POST` | JSON：`type`（`memory \| stage`）、`ids`、`action`（`restore \| permanent`）、`confirm` | JSON：`succeededIds?`、`failures?: Array<{ id, error }>` | `src/client/trash-api.ts` |
| `memory-management.tsx` | `/api/memories/:memoryId` | `POST` | JSON 联合动作：`details`（`title`、`story`、`stageId`）、`note`（`content`）、`relations`（`relatedMemoryIds`）、`trash` | 响应体未使用；仅检查 `response.ok` | `src/client/memory-api.ts` |
| `stage-delete-action.tsx` | `/api/stages/:stageId` | `DELETE` | 无请求体 | 响应体未使用；仅检查 `response.ok` | `src/client/stage-api.ts` |
| `time-gear.tsx` | `/api/recall` | `GET` | 无请求体；`cache: "no-store"` | JSON：`{ memory: { id: string } \| null }` | `src/client/memory-api.ts` |
| `share-access.tsx` | `/api/share-access` | `POST` | JSON：`token`、`password` | 响应体未使用；仅检查 `response.ok` | `src/client/share-api.ts` |
| `login-form.tsx` | `/api/auth` | `POST` | JSON：`password` | 响应体未使用；仅检查 `response.ok` | `src/client/auth-api.ts` |
| `memory-exhibit-manager.tsx` | `/api/memories/:memoryId` | `POST` | JSON 联合动作：`reorderPhotos`（`photoIds`）、`removePhoto`（`photoId`）、`exhibitMetadata`（`photoId`、`title`、`description`）、`addPhotos`（`photoIds`）、`setCover`（`photoId`） | 响应体未使用；仅检查 `response.ok` | `src/client/memory-api.ts` |
| `upload-task-provider.tsx` | `/api/photos` | `POST` | `FormData`：优化后的 `photos` 文件、`originalName` | JSON：`error?`、`photos?: Array<{ id }>`；成功时使用首个 `photoId` | 复用/扩展 `src/client/photo-api.ts` 前需在 Task C7 单独判断 |
| `share-manager.tsx` | `/api/shares` | `POST` | JSON：`memoryId`、`enabled`、`mode`、`password`、`rotate` | JSON：成功时使用 `url`；失败响应未建模 | `src/client/share-api.ts` |
| `stage-manager.tsx` | `/api/stages` | `POST` | JSON：`title`、`description`、`coverPhotoId` | 响应体未使用；仅检查 `response.ok` | `src/client/stage-api.ts` |
| `stage-manager.tsx` | `/api/stages/:stageId` | `PUT` | JSON：`title`、`description`、`coverPhotoId` | 响应体未使用；仅检查 `response.ok` | `src/client/stage-api.ts` |

## 迁移边界备注

- `share-access.tsx` 的语义是分享链接访问验证，不是馆长登录；归入 `share-api.ts`，避免把分享域强塞进 `auth-api.ts`。
- `time-gear.tsx` 的 `/api/recall` 返回 Memory 导航目标，归入 `memory-api.ts`。
- `memory-management.tsx` 与 `memory-exhibit-manager.tsx` 共用同一详情端点，但动作 payload 不同；迁移时应保留可辨识的具体函数，不建立泛型 `send(action, body)` 框架。
- `upload-task-provider.tsx` 同时负责图片压缩、队列并发、取消状态和上传后回调。Task C7 应先判断现有 `photo-api.ts` 是否能在不破坏生命周期语义的前提下承接 multipart 上传。
- `memory-editor.tsx`、`share-manager.tsx` 和上传流程会读取 JSON 响应；其余调用当前只依赖 HTTP 成功状态。迁移时不应擅自改变这些可观察行为。

## 未发现直接 fetch 的目标组件

无。11 个目标组件中，`stage-manager.tsx` 含两个 endpoint 变体，因此表中共有 12 条 API 使用记录。

## Task C8 收尾扫描

当前 Client Component 的直接 `fetch()` 仅剩一处：

| 分类 | 位置 | 结论 |
|---|---|---|
| 特殊上传行为，合理直接使用 | `upload-task-provider.tsx` | 保留。它同时处理图片压缩、并发队列、取消状态、multipart 请求与上传后回调；迁入普通 JSON API 会增加跨模块状态耦合。 |

`src/client/http-client.ts` 中的 `fetch()` 是统一客户端 API 边界的实现，不属于组件直接调用。
