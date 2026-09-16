# Personal Memory Palace — Task08

# Core Memory Editing Completion

## 1. 目标

补齐 Owner 对 Memory 核心文字与所属人生章节的编辑闭环，解决真实使用中“创建后无法调整 Stage”的问题。

本阶段不改变 Memory 作为小型展览的展示结构，不扩展照片管理能力。

## 2. 范围

- Owner 可以修改 Memory 标题。
- Owner 可以修改 Original Story，Later Notes 保持独立且不受影响。
- Owner 可以把 Memory 归入一个有效 Stage。
- Owner 可以从一个 Stage 改到另一个 Stage。
- Owner 可以将 Memory 改为“未归类”。
- 创建 Memory 页面提供清晰的 Stage 管理入口。
- 所有写入继续受到 Owner 身份保护。
- Visitor 继续只读。

## 3. 不做

- 不在 Memory 表单内创建 Stage。
- 不新增或移除 Memory 图片。
- 不调整封面或图片顺序。
- 不做富文本、Markdown、EXIF、批量导入或 AI。
- 不修改 Later Notes、关联、分享和回收站的产品行为。

## 4. 验收标准

- 标题和 Original Story 修改后刷新仍然存在。
- 可将未归类 Memory 归入 Stage。
- 可更换 Stage。
- 可移除 Stage，恢复为未归类。
- 已进入回收站或不存在的 Stage 不能被写入。
- 空标题、空 Story 被拒绝。
- 未认证写入被拒绝。
- Later Notes、图片、关联和分享配置不受编辑影响。
- Desktop 与 Mobile 均可操作。

## 5. 停止点

完成核心内容编辑闭环后停止，不进入照片编辑、Onboarding、Rediscovery 或其他后续功能。
