# Task06 — Production Deployment

## 目标

将 Personal Memory Palace V1 从本地开发环境部署到公网。

当前项目已经完成：

- Next.js 应用
- TypeScript
- SQLite 数据存储
- 图片上传与处理
- WebP 浏览版本
- 可选原图保存
- Owner 登录保护
- Visitor 分享访问
- Docker standalone 构建

本阶段目标：

> 让 Personal Memory Palace 成为一个可以长期访问的真实网站。

---

# 一、执行原则

## 1. 不修改产品功能

本阶段不是开发阶段。

禁止增加：

- 新页面
- 新功能
- AI
- 多用户
- 新数据模型
- UI 重构

只处理：

- 生产环境配置
- 部署
- 持久化
- 安全检查

---

## 2. 优先保证数据安全

这是一个个人记忆库。

最高优先级：

```
数据不丢失
>
网站可访问
>
部署成本
>
性能优化
```

任何部署方案必须保证：

- SQLite 数据持久化；
- 上传图片持久化；
- 容器重启后数据仍存在。

---

# 二、部署前审计

开始部署前，先检查：

## 1. Docker

检查：

- Dockerfile
- .dockerignore
- standalone 输出
- 启动命令

确认：

生产环境可以运行：

```bash
node server.js
```

---

## 2. 数据目录

检查当前：

```
data/
```

目录结构。

确认：

- SQLite 文件位置；
- 图片存储位置；
- 上传文件路径；
- 数据目录是否可通过环境变量配置。

重点确认：

```
MEMORY_PALACE_DATA_DIR
```

是否作为生产持久化目录。

---

## 3. 环境变量

检查：

```
.env.example
```

确认生产需要配置：

至少包括：

```
MEMORY_PALACE_OWNER_PASSWORD
MEMORY_PALACE_DATA_DIR
```

不要把：

- 密码
- Secret
- 私人配置

提交到 Git。

---

# 三、选择部署方案

根据当前项目：

- Next.js
- Docker
- SQLite
- 文件存储

选择支持：

- Docker
- Persistent Volume

的平台。

优先考虑：

- Render
- Railway

不要选择不适合持久文件存储的平台。

---

部署方案需要输出：

```
Deployment Decision

Platform:

Reason:

Build Method:

Start Command:

Persistent Storage:

Environment Variables:
```

要求：

简单、低成本、易维护。

---

# 四、生产环境配置

部署时确保：

## Node 环境

使用生产模式。

确认：

```
NODE_ENV=production
```

---

## 数据目录

挂载持久卷。

例如：

```
/app/data
```

或者根据 Docker 配置确定。

必须保证：

```
SQLite
+
images
```

都位于持久卷。

---

## Dataset

生产环境不要使用 Demo 数据。

确认：

Demo：

```
MEMORY_PALACE_DATASET=demo
```

生产：

使用 Owner 数据。

例如：

```
MEMORY_PALACE_DATASET=owner
```

避免上线后混入演示内容。

---

# 五、部署后验证

完成部署后必须测试。

---

# Owner 测试

确认：

## 登录

- Owner 登录正常；
- Cookie 正常；
- 未登录无法进入编辑功能。

---

## Memory

测试：

- 创建 Memory；
- 上传图片；
- 保存 Story；
- 编辑 Memory；
- 删除恢复。

---

## 图片

确认：

- 上传成功；
- 页面刷新后仍存在；
- 服务重启后仍存在。

---

# Visitor 测试

确认：

## 分享链接

测试：

- 无密码分享；
- 密码分享。

---

确认：

Visitor：

可以：

- 查看允许分享内容。

不能：

- 查看 private Memory；
- 编辑内容；
- 调用写入接口。

---

# Mobile 测试

使用手机浏览器测试：

- 首页加载；
- 人生长廊展示；
- Memory Exhibition；
- 图片显示；
- 分享链接。

---

# 六、生成部署文档

部署完成后生成：

```
docs/DEPLOYMENT.md
```

包含：

## 当前架构

例如：

```
Frontend:
Backend:
Database:
Image Storage:
Hosting:
```

---

## 部署步骤

包括：

- 如何更新代码；
- 如何重新部署；
- 如何修改环境变量。

---

## 数据说明

说明：

- SQLite 文件位置；
- 图片目录；
- 持久卷位置；
- 如何备份。

---

## 运维说明

包括：

- 查看日志；
- 重启服务；
- 常见错误排查。

---

# 七、验收标准

Task06 完成后：

必须满足：

```
公网网址
    ↓
打开 Personal Memory Palace
    ↓
进入人生长廊
    ↓
查看 Memory
    ↓
创建新的 Memory
    ↓
上传照片
    ↓
随机回忆
    ↓
生成分享链接
    ↓
朋友访问
```

并且：

- 数据不会因为服务器重启丢失；
- 图片不会因为重新部署丢失；
- Owner 权限正常；
- Visitor 权限正常；
- 手机和电脑均可访问。

---

# 八、完成后停止

完成 Task06 后：

输出：

1. 部署方案总结；
2. 修改文件列表；
3. 环境变量列表；
4. 部署地址（如果已经完成）；
5. 测试结果。

不要自动进入下一阶段。