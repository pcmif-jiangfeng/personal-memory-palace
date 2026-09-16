# Task 02 — Memory Creation

## 目标

完成最核心的创建闭环：

```text
照片
→
整理
→
Memory
```

---

## 1. 图片上传

支持一次选择多张图片。

支持常见格式：

- JPG
- JPEG
- PNG
- WebP

不要读取 EXIF。

---

## 2. 图片处理

上传后：

```text
生成 Web 优化版本
```

同时提供：

```text
□ 保留原始上传文件
```

不支持 RAW。

图片处理逻辑集中管理，不要散落在 UI 中。

---

## 3. Photo Workspace

上传后进入照片整理台。

使用缩略图网格。

支持：

- 查看上传图片
- 多选
- 取消选择
- 显示选中数量
- 使用选中照片创建 Memory

不要自动生成 Memory。

不要自动分组。

---

## 4. Memory Editor

用选中的照片创建 Memory Draft。

支持：

- Title
- Story
- Cover Image
- 多张 Gallery Images
- Stage
- Related Memories

Story：

只支持纯文本。

---

## 5. Stage

支持：

- 创建 Stage
- 修改 Stage 名称
- 可选简介
- 可选封面

Memory 创建时推荐选择 Stage，但允许：

```text
未归类
```

---

## 6. Related Memories

创建或编辑 Memory 时允许手动选择其他 Memory 进行关联。

V1 不做自动推荐。

---

## 7. 保存

Memory 保存后重新加载网站仍然存在。

图片和数据库数据都必须持久化。

---

## 当前阶段不做

不要实现：

- Time Gear
- 完整人生长廊视觉
- Stage hover 动画
- 分享
- 搜索
- Trash
- AI
- EXIF
- 富文本

---

## 验收标准

用户可以完成：

```text
批量上传照片
→
在 Photo Workspace 中选择部分照片
→
创建 Memory
→
设置封面
→
填写 Title
→
填写 Story
→
选择或跳过 Stage
→
可选关联 Memory
→
保存
→
重新打开仍存在
```

完成后停止。