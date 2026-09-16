# Task 05 — Sharing & Deployment

## 目标

把当前项目变成：

> 可真实公网访问的单用户 Personal Memory Palace V1。

---

## 1. Owner / Visitor

区分两种访问状态。

### Owner

可以：

- 查看全部内容
- 创建
- 编辑
- 删除
- 管理分享

### Visitor

使用与 Owner 相同的博物馆视觉体系。

但：

- 只读
- 只能看到允许分享的内容

---

## 2. 分享范围

Owner 可以选择哪些 Memory 对 Visitor 可见。

默认：

```text
private
```

主动选择后：

```text
shared
```

不要因为一个 Stage 被访问就自动暴露其中全部 Memory。

---

## 3. 分享访问模式

支持：

### 模式 A

```text
有链接即可访问
```

### 模式 B

```text
链接 + 密码
```

Owner 自己选择。

不需要自动过期。

---

## 4. Visitor Filtering

Visitor 在任何路径下都不能看到 private Memory。

包括：

- Life Gallery
- Stage View
- Search
- Related Memories
- 直接 URL
- API

这是必须满足的隐私边界。

---

## 5. Owner 保护

项目部署公网后：

Owner 编辑入口必须有最基本访问保护。

不要开发完整用户注册系统。

选择简单可靠的单用户方案。

---

## 6. 公网部署

选择适合当前技术栈的部署方式。

要求：

- Desktop 正常访问
- Mobile 正常访问
- 图片正常加载
- 数据库持久化
- 上传内容持久化
- Visitor 分享链接正常工作

---

## 7. 最终体验优化

只修正：

- 明显视觉不统一
- 响应式问题
- Loading State
- Empty State
- Error State
- 图片上传错误
- 分享错误
- 搜索无结果状态

不要在此阶段增加新产品功能。

---

## 最终验收

完整 V1 流程必须成立：

```text
上传照片
→
Photo Workspace
→
创建 Memory
→
加入人生长廊
→
浏览 Stage
→
进入 Memory Exhibition
→
Time Gear 随机回忆
→
Search
→
Later Notes
→
筛选允许分享内容
→
生成访问方式
→
朋友公网参观
```

同时确认：

- private 内容不会泄露
- Owner 能正常编辑
- Visitor 只能浏览
- Desktop 可用
- Mobile 可用

达到以上条件后，V1 完成。

停止，不进入 Future Roadmap。