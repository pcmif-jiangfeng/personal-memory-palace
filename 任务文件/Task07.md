# Personal Memory Palace

# Production Launch & Reliability Plan

## 1. 文档目的

本阶段目标不是继续增加产品功能，而是把当前已经可运行的 Personal Memory Palace 从：

> 本地开发完成

推进到：

> 已在真实服务器运行，并具备基本数据可靠性的私人产品

整个阶段分为两个层次：

```text
Phase 1
Production Baseline
通过腾讯云公网 IP 完成真实部署和可靠性验证

Phase 2
Production Finalization
域名审核/备案完成后，绑定正式域名与 HTTPS
```

重要原则：

> 域名审核不是当前阶段的阻塞条件。

只要腾讯云服务器、公网 IP、Docker 和 GitHub 均可用，就可以先完成 Production Baseline。

---

# 2. 当前项目状态

项目名称：

```text
Personal Memory Palace
个人记忆宫殿 / 人生长廊
```

核心体验：

> 用户进入自己的数字人生博物馆，通过照片与文字重新遇见过去。

项目不定位为：

- 普通相册
- 日记软件
- 管理后台
- 社交平台

---

## 2.1 本地项目

路径：

```text
D:\记忆宫殿搭建\V1
```

GitHub：

```text
https://github.com/pcmif-jiangfeng/personal-memory-palace
```

---

## 2.2 技术栈

```text
Next.js 16
React 19
TypeScript
SQLite
Sharp
Docker
```

---

## 2.3 当前服务器

```text
腾讯云轻量应用服务器
Ubuntu 24.04
Docker 29
2 Core CPU
2 GB RAM
40 GB SSD
```

公网 IP：

```text
82.156.172.124
```

---

## 2.4 当前服务器状态

已完成：

- 服务器购买
- Ubuntu 正常运行
- Docker 安装
- 腾讯云网页终端可用
- SSH 密钥已创建并绑定

当前存在：

```text
本地 SSH 客户端认证仍失败
```

本问题当前不作为部署阻塞项。

允许并推荐直接使用：

```text
腾讯云网页终端
```

完成服务器部署。

---

# 3. 当前部署策略

整个生产上线过程遵循：

```text
本地项目
↓
Codex 审计与必要修改
↓
GitHub
↓
腾讯云服务器
↓
Docker
↓
公网 IP
↓
真实数据验证
↓
备份/恢复
↓
域名
↓
HTTPS
```

当前阶段先完成：

```text
本地项目
↓
GitHub
↓
腾讯云
↓
公网 IP
↓
可靠性验证
```

不等待域名。

---

# 4. 执行环境划分

本任务必须明确区分两类工作。

---

## 4.1 Codex / 本地环境负责

Codex 只负责项目仓库内部的工作。

包括：

- 审计 Docker 配置
- 审计环境变量
- 审计 SQLite 路径
- 审计用户图片路径
- 修复持久化相关问题
- 增加必要的生产配置
- 编写备份脚本
- 编写恢复说明
- 增加上传限制
- 修复上传失败后的孤儿文件问题
- 更新部署文档
- 本地构建验证
- 输出服务器执行命令

Codex 不应假设自己已经直接控制腾讯云服务器。

---

## 4.2 腾讯云服务器负责

必须在真实服务器上完成：

- git clone / git pull
- Docker build
- 创建持久目录
- 设置生产环境变量
- 启动容器
- 端口映射
- 公网访问
- Owner 登录验证
- 创建真实测试数据
- Docker restart 测试
- Container recreate 测试
- Server reboot 测试
- 实际备份
- 实际恢复

---

# 5. 当前阶段定义

## Phase 1：Production Baseline

当前立即执行。

目标：

```text
http://82.156.172.124
```

可以正常访问 Personal Memory Palace，并完成完整的数据可靠性验证。

---

## Phase 2：Production Finalization

等待：

```text
域名审核 / ICP / DNS 条件满足
```

之后再执行：

- 域名解析
- Nginx 或 Caddy
- HTTPS
- 正式域名访问
- HTTP → HTTPS 跳转
- 正式 Cookie / Secure 配置复核
- 域名入口验证

Phase 2 不阻塞 Phase 1。

---

# 6. Phase A：部署前项目审计

此阶段由 Codex 在本地仓库完成。

目标：

> 确认当前项目是否具备安全部署到腾讯云的条件。

---

## 6.1 Docker 审计

检查：

```text
Dockerfile
.dockerignore
next.config
package.json
生产启动命令
standalone build
```

确认：

- build 可以完成
- production server 可以启动
- 不依赖 Windows 路径
- 不依赖未提交文件
- 不把敏感信息打进镜像
- 不把用户数据写入镜像层

---

## 6.2 环境变量审计

列出全部生产环境变量。

至少确认：

```text
MEMORY_PALACE_OWNER_PASSWORD
```

要求：

- 真实密码不进入 Git
- 真实密码不进入 Dockerfile
- 真实密码不写入 README
- `.env` 被 gitignore
- `.env.example` 只保留变量名和说明

如存在：

- Cookie Secret
- Share Secret
- Token Secret
- Base URL
- Storage Path

也必须统一审计。

---

## 6.3 SQLite 审计

明确：

```text
SQLite database file
```

真实存放路径。

必须确认：

```text
数据库路径可以通过 bind mount 或 volume 持久化
```

Codex 应明确输出：

```text
Container DB path:
Host DB path:
Database filename:
```

---

## 6.4 图片存储审计

明确用户上传图片路径。

输出：

```text
Container image path:
Host image path:
```

要求：

> 图片不得只存在于 Docker container writable layer。

---

## 6.5 用户数据范围审计

列出所有不可重新生成的数据。

至少包括：

```text
SQLite database
uploaded images
```

如果还有：

- generated thumbnails
- metadata
- sidecar files
- share configuration

需要判断：

```text
是否可从数据库重新生成
```

只有不可重建数据必须进入备份。

---

# 7. Phase B：服务器目录设计

腾讯云服务器推荐使用：

```text
/opt/personal-memory-palace/
```

建议结构：

```text
/opt/personal-memory-palace/
├── app/
├── data/
│   ├── database/
│   └── uploads/
├── backups/
└── config/
```

实际结构应优先适配当前项目。

原则：

```text
代码
≠
数据
≠
备份
≠
Secret
```

---

## 7.1 app

```text
/opt/personal-memory-palace/app
```

用于：

- Git repository
- Dockerfile
- build context

---

## 7.2 data

```text
/opt/personal-memory-palace/data
```

用于所有长期用户数据。

例如：

```text
data/
├── database/
│   └── memory-palace.sqlite3
└── uploads/
```

---

## 7.3 backups

```text
/opt/personal-memory-palace/backups
```

用于备份。

---

## 7.4 config

```text
/opt/personal-memory-palace/config
```

可用于：

- `.env.production`
- Docker env file

该目录不得进入 Git repository。

权限应尽可能收紧。

---

# 8. Phase C：服务器首次部署

服务器部署使用腾讯云网页终端。

---

## 8.1 获取代码

从 GitHub 获取项目。

原则：

```text
第一次：
git clone

之后：
git pull
```

---

## 8.2 创建持久化目录

在第一次启动容器之前完成。

确保：

```text
data/
backups/
config/
```

已经存在。

---

## 8.3 设置 Owner Password

主人密码只能在服务器端设置。

不得：

```text
commit
push
hardcode
```

建议通过：

```text
env file
```

或等价方式注入。

---

## 8.4 Docker Build

基于真实 Dockerfile 构建 production image。

如果服务器 2GB 内存构建过程中出现资源不足：

优先研究：

- swap
- build optimization
- 本地构建后推镜像

不要立即改变应用架构。

---

## 8.5 Docker Run

容器必须：

- 映射 HTTP 端口
- 挂载持久数据目录
- 加载生产环境变量
- 配置 restart policy

目标访问：

```text
http://82.156.172.124
```

---

# 9. Phase D：Production Smoke Test

首次成功启动后执行。

---

## 9.1 页面测试

验证：

- 首页
- 登录页
- 人生长廊
- Stage
- Memory Detail
- Search

至少保证主流程无明显异常。

---

## 9.2 Owner 登录

验证：

```text
正确密码 → 成功
错误密码 → 失败
未认证 → 不能访问 Owner-only 能力
```

---

## 9.3 创建 Stage

创建专门测试 Stage：

```text
Production Verification
```

---

## 9.4 创建 Memory

创建测试 Memory：

```text
一张测试图片
+
一段唯一测试文字
```

文字应容易识别，例如：

```text
Production persistence verification record.
```

---

## 9.5 图片验证

确认：

- 图片上传成功
- 图片页面正常显示
- 重刷正常
- Memory 详情正常
- Stage 页面正常

---

# 10. Phase E：持久化验证

本阶段必须真实执行。

---

## 10.1 Container Restart

执行：

```text
restart container
```

验证：

- Stage
- Memory
- 图片
- 关联关系

全部存在。

---

## 10.2 Container Recreate

仅 restart 不足以证明 bind mount 正确。

必须进行一次：

```text
stop
remove container
create new container
```

然后验证数据。

因为：

> container restart 后数据还在，并不能证明删除容器后数据还在。

这是非常重要的区别。

---

## 10.3 Docker Image Rebuild

允许重新 build 新 image。

重新创建 container 后：

```text
旧用户数据必须仍然存在
```

---

# 11. Phase F：Server Reboot

完成一次：

```text
Ubuntu server reboot
```

重启后验证：

```text
Docker daemon 自动启动
Container 自动启动
网站自动恢复
```

并确认数据仍然存在。

---

# 12. Phase G：最小备份系统

当前先建立：

> Manual Backup V1

不急着自动化。

---

## 12.1 备份内容

必须包含：

```text
SQLite database
用户原图
```

如缩略图可重建：

可以不进入核心备份。

如果不可重建：

加入备份。

---

## 12.2 SQLite 一致性

不能简单假设：

```text
直接 cp 正在写入的 SQLite 文件
```

永远安全。

Codex 应根据当前 SQLite 使用方式选择合适方法。

优先考虑：

```text
SQLite backup API
sqlite3 .backup
短暂停止写入
或其他一致性备份方式
```

不要使用可能产生损坏备份的简单方案。

---

## 12.3 图片备份

图片目录与数据库备份应属于同一个 backup snapshot。

尽可能避免出现：

```text
数据库记录已经更新
图片备份还是旧版本
```

导致状态不一致。

---

## 12.4 备份命名

建议：

```text
backup-YYYYMMDD-HHMMSS
```

内部：

```text
backup-20260916-210000/
├── database/
├── uploads/
└── manifest.txt
```

---

## 12.5 manifest

建议至少记录：

```text
backup time
application version / git commit
database filename
upload file count
backup source paths
```

方便未来恢复时确认内容。

---

# 13. Phase H：恢复测试

恢复测试必须执行。

---

## 13.1 原则

不得直接拿唯一生产数据做破坏性实验。

建议：

```text
backup
↓
复制到 restore-test 目录
↓
启动独立测试实例
↓
验证恢复结果
```

---

## 13.2 恢复验证

确认：

- Stage 数量
- Memory 数量
- 测试 Memory 存在
- 测试图片存在
- 图片路径正确
- 数据库可读
- 应用可正常启动

---

## 13.3 恢复成功标准

不是：

```text
文件解压成功
```

而是：

```text
恢复后的应用真实可用
```

---

# 14. Phase I：最小生产可靠性

Production Baseline 完成后，再处理下面这些。

---

## 14.1 文件类型限制

只允许当前明确支持的图片格式。

例如：

```text
JPEG
PNG
WebP
HEIC
```

具体以当前 Sharp 和前端支持情况为准。

不要机械开放全部图片 MIME 类型。

---

## 14.2 文件大小限制

需要设置单文件大小上限。

上限需要同时考虑：

```text
2GB RAM
40GB SSD
Next.js request handling
Sharp processing
用户实际照片大小
```

Codex 不应随意拍一个数字。

应根据真实上传流程给出合理值。

---

## 14.3 孤儿文件处理

检查以下失败路径：

```text
图片写入成功
↓
DB insert 失败
```

以及：

```text
DB 写入成功
↓
图片写入失败
```

要求最终不能长期出现明显不一致状态。

---

## 14.4 磁盘空间

至少建立简单检查方法：

```text
df -h
du -sh data
du -sh backups
docker system df
```

当前阶段不开发后台 Dashboard。

---

# 15. 当前阶段不做

在 Production Baseline 完成之前，不开始：

- Onboarding
- Random Rediscovery
- On This Day
- Time Travel
- EXIF
- Batch Upload
- AI Tagging
- PostgreSQL
- Supabase
- S3
- Redis
- Kubernetes
- Multi-user Account System

---

# 16. Phase 2：域名正式收尾

只有域名条件满足后开始。

---

## 16.1 域名解析

将正式域名解析到腾讯云公网 IP。

---

## 16.2 Reverse Proxy

从：

```text
Nginx
```

或：

```text
Caddy
```

选择一种。

不要同时引入两套。

---

## 16.3 HTTPS

使用受信任 TLS certificate。

完成：

```text
https://your-domain
```

---

## 16.4 HTTP Redirect

最终：

```text
HTTP
↓
301/308
↓
HTTPS
```

---

## 16.5 Cookie Security

域名和 HTTPS 上线后重新检查：

```text
Secure
HttpOnly
SameSite
Domain
Path
```

尤其 Owner authentication cookie。

---

## 16.6 分享链接

重新测试：

- 无密码分享
- 密码分享
- Visitor 只读
- HTTPS URL

---

# 17. Phase 2 验收

最终正式地址满足：

```text
https://正式域名
```

并验证：

- HTTPS 无证书错误
- Owner 登录正常
- 分享正常
- 上传正常
- 图片正常
- HTTP 自动跳转
- 数据持久化仍正常

---

# 18. 安全红线

## SSH Private Key

本地私钥：

```text
C:\Users\jiang\.ssh\memory_palace_tencent
C:\Users\jiang\.ssh\memory_palace_tencent_rsa
```

绝对不得：

- 上传 GitHub
- 放进项目
- 放进 Docker image
- 发送给 Codex
- 写入公开文档
- 复制到 issue / commit

---

## Owner Password

不得：

- Git commit
- Dockerfile
- README
- Screenshot
- Public log

---

## 用户照片与数据库

任何部署流程不得默认：

```text
rm -rf data
```

不得因重新部署删除用户数据。

---

# 19. Production Baseline 验收清单

## Code Readiness

- [ ] Docker 配置已审计
- [ ] 环境变量已审计
- [ ] DB 路径已确认
- [ ] 图片路径已确认
- [ ] 用户数据范围已确认

## Deployment

- [ ] 腾讯云成功拉取代码
- [ ] Docker build 成功
- [ ] 容器运行成功
- [ ] 公网 IP 可访问
- [ ] Owner 登录成功

## Persistence

- [ ] 创建测试 Stage
- [ ] 创建测试 Memory
- [ ] Container restart 后数据存在
- [ ] Container recreate 后数据存在
- [ ] Image rebuild 后数据存在
- [ ] Server reboot 后数据存在

## Backup

- [ ] 生成真实 backup
- [ ] SQLite backup 一致
- [ ] 图片进入 backup
- [ ] backup 带时间信息

## Restore

- [ ] 至少完成一次恢复测试
- [ ] 恢复后 App 能启动
- [ ] Memory 正常
- [ ] Stage 正常
- [ ] 图片正常

---

# 20. Production Finalization 验收清单

- [ ] 域名解析成功
- [ ] Reverse Proxy 已配置
- [ ] HTTPS 正常
- [ ] HTTP 自动跳转 HTTPS
- [ ] Owner Cookie 安全配置复核
- [ ] 分享链接 HTTPS 下正常
- [ ] 最终域名公网访问正常

---

# 21. Codex 完成后必须输出

Codex 完成本地部分后必须停止。

输出：

```text
1. 审计结果
2. 修改文件
3. 修改原因
4. 当前 Docker 数据路径
5. 推荐 Host 挂载路径
6. 所需生产环境变量
7. 腾讯云完整执行命令
8. 备份命令 / 脚本
9. 恢复流程
10. 本地验证结果
11. 必须人工在服务器执行的步骤
12. 尚未验证事项
```

Codex 不得把：

```text
“已写好部署脚本”
```

描述成：

```text
“已经完成生产部署”
```

除非服务器端真实执行并验证过。

---

# 22. 当前停止点

完成：

```text
Production Baseline
```

以后停止。

不要自动进入：

```text
Onboarding
Rediscovery
Batch Import
```

必须先基于真实上线使用体验重新规划。

---

# 23. 最终原则

本阶段追求的不是：

> 项目技术上看起来更高级。

而是：

[
\boxed{
我敢把真正重要的人生资料放进去，
并且知道服务器出问题后我仍然能把它找回来。
}
]

这才是 Personal Memory Palace 第一次真正达到“可长期使用”的标准。
