# Task 01 — Foundation

## 目标

建立一个可以继续发展的 Personal Memory Palace V1 项目基础。

不要实现完整产品体验。

---

## 任务

### 1. 检查当前仓库

先确认：

- 当前技术栈
- 项目结构
- 已有代码
- 启动方式
- 部署相关配置

不要在不了解现状时直接重构。

---

### 2. 技术选型

根据 `PRODUCT_CORE.md` 选择适合 V1 的方案。

开始编码前只简短记录：

```text
Frontend
Backend
Database
Image Storage
Deployment
```

以及每项选择的一句话理由。

不要写长篇架构论文。

---

### 3. 建立清晰项目结构

至少区分：

```text
UI / Components
Domain Logic
Data Access
Image Storage
Database
```

具体目录由当前技术栈决定。

---

### 4. 建立核心数据模型

至少支持以下概念：

```text
Stage

Memory

MemoryImage

MemoryRelation

LaterNote

ShareConfig
```

Memory 应支持：

- title
- story
- cover
- 多张图片
- 可选 stage
- visibility
- created_at
- updated_at
- trash 状态

---

### 5. Demo 数据

准备少量独立 Demo 数据。

至少展示：

- 2–3 个 Stage
- 4–6 个 Memory
- 单图 Memory
- 多图 Memory
- Related Memory

Demo 数据不得与未来真实数据混合。

---

### 6. 页面骨架

建立基础路由和空页面：

```text
Life Gallery

Photo Workspace

Memory Editor

Memory Exhibition

Stage View

Search

Trash
```

当前阶段只需要结构正确，不做完整视觉。

---

### 7. 中文文案层

V1 界面中文。

建立最简单的统一文案结构，为未来国际化留空间。

不要把大量中文字符串散落在业务代码中。

---

## 当前阶段不做

不要实现：

- 完整图片上传流程
- Time Gear
- 分享
- Stage hover 动画
- 完整 Memory 创建
- 完整搜索
- 视觉精修
- AI
- 多用户

---

## 验收标准

完成时必须满足：

- 项目可以正常启动
- 数据库可以初始化
- Demo 数据可读取
- 所有基础页面可访问
- 核心数据模型已建立
- 项目结构清晰
- 没有明显过度工程

完成后停止。