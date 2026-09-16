# Task 03 — Life Gallery

## 目标

实现 Personal Memory Palace 最核心的视觉体验：

> 人生长廊。

---

## 1. 首页原则

首页不是 Dashboard。

不要把以下内容作为主视觉：

- 数据统计
- 最近操作
- 管理卡片
- 后台列表

用户进入后应感觉自己进入一座人生博物馆。

---

## 2. 视觉方向

使用：

```text
Modern Museum
+
Warm Memory
+
Future Archive
```

要求：

- 现代
- 安静
- 大量留白
- 高质量图片突出
- 有私人记忆的温度
- 少量未来科技元素

不要：

- 赛博朋克
- 强霓虹
- HUD
- 游戏 UI
- 传统后台风格

---

## 3. Stage Shelf

Stage 使用：

> 收藏册 / 书架

作为视觉隐喻。

每个 Stage 应明显像一个人生章节，而不是普通按钮。

---

## 4. Hover Preview

鼠标悬停 Stage：

约 3 张来自该 Stage 的照片从收藏册后方展开。

动画：

- 平滑
- 克制
- 轻微层叠
- 不夸张弹跳

移动端无需复制 hover 行为，可使用适合触屏的替代方式。

---

## 5. Stage View

点击 Stage 后进入 Stage View。

展示该阶段中的 Memory。

Memory 卡片至少显示：

- Cover Image
- Title
- 简短 Story preview

---

## 6. Memory Exhibition

实现完整 Memory 展览页。

顺序可根据设计调整，但至少包括：

```text
主视觉照片

Title

Story

照片 Gallery

Later Notes 区域

Related Memories

关联 Stage
```

页面要体现：

> Memory 是一场展览，而不是普通详情页。

---

## 7. 多图体验

Memory 可能包含：

- 1 张照片
- 5 张照片
- 20+ 张照片

页面必须在不同数量下保持可浏览。

不需要复杂瀑布流算法，优先保证稳定和美观。

---

## 8. 响应式

Desktop 和 Mobile 均需可正常浏览。

重点处理：

- Stage 展示
- 图片尺寸
- Story 阅读宽度
- Gallery
- 导航

---

## 当前阶段不做

不要实现：

- Time Gear 随机逻辑
- 分享
- 搜索
- Trash
- AI
- 3D
- 可行走人物

---

## 验收标准

完成时：

- 首页具有明确人生长廊感觉
- Stage 使用收藏册 / 书架视觉
- Desktop hover 可展示约 3 张照片
- 可以进入 Stage View
- 可以进入 Memory Exhibition
- 单图和多图 Memory 均能正常展示
- Mobile 正常浏览

完成后停止。