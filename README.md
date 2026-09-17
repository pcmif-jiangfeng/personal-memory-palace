# Personal Memory Palace

> 个人记忆宫殿 / 人生长廊：一座由照片与文字构成的私人数字人生博物馆。

Personal Memory Palace 不是普通相册、日记软件或社交平台。它希望提供一种更安静的方式，让人整理已经发生的经历，并在未来重新走进自己的过去。

用户从照片出发，把若干照片整理成一段 `Memory`，写下属于当时的 `Original Story`，再将它放入自己定义的 `Stage`。多年以后，用户可以沿着人生章节浏览、搜索过去，或让时间齿轮随机翻开一段记忆。

当前项目是一个已经完成核心闭环并部署验证的 V1：服务单一 Owner，同时允许 Owner 将指定 Memory 以只读方式分享给 Visitor。

## 产品理念

核心体验是：

> 用户进入自己的数字人生博物馆，通过照片和文字重新遇见过去。

设计方向：

```text
Modern Museum
+ Warm Memory
+ Future Archive
```

界面强调现代艺术馆式的留白、安静、温暖与克制。照片是展品，Story 是展览说明，Memory 则是一场小型展览。

## 核心模型

### Stage

Stage 是用户自己定义的人生章节，例如“大学本科”“英国交换”或“摄影成长”。系统不预设标准人生分类，也允许 Memory 暂时保持“未归类”。

### Memory

Memory 是整个产品最重要的对象。它可以由一张或多张照片组成，可以表示一个瞬间、一次旅行，也可以承载一段完整经历。

```text
Memory
├── Title
├── Original Story
├── Cover Image
├── Gallery Images
├── Stage（可选）
├── Related Memories（可选）
├── Later Notes
└── Visibility
```

`Original Story` 始终作为最初的展览说明保留。之后产生的新感受通过带有创建时间的 `Later Notes` 继续追加，让未来的自己能够与过去对话。

## 当前已实现功能

### 人生长廊

- 现代数字博物馆式首页；
- Stage 收藏册 / 书架式人生章节；
- Stage 三图悬停预览；
- Stage 独立浏览页面；
- 响应式 Memory 卡片与展览页面；
- 桌面端和移动端均可浏览。

### 从照片创建 Memory

创建流程以照片为入口，而不是从空白表单开始：

```text
上传照片
→ 照片整理台
→ 选择若干照片
→ 创建 Memory
→ 填写标题和 Story
→ 选择 Stage 与相关 Memory
→ 保存
```

- 支持批量上传 JPG、JPEG、PNG 和 WebP；
- 单张不超过 20MB；
- 单批最多 20 张且总计不超过 100MB；
- 自动生成最长边不超过 2048px 的 WebP 浏览版本；
- 可以选择是否同时保留原始上传文件；
- 支持多选照片、选择封面、选择 Stage 和关联 Memory；
- Demo 数据与 Owner 的真实数据完全隔离。

### Memory Exhibition

- 主视觉照片、标题、Original Story 与响应式照片画廊；
- Later Notes 与 Related Memories；
- 显示所属人生章节；
- Owner 可以修改标题、Original Story 和 Stage；
- Owner 可以追加 Later Note、调整相关记忆或将 Memory 移入回收站；
- Memory 主视觉照片支持全屏沉浸查看；
- 桌面端支持滚轮缩放、双击切换和拖动；
- 移动端支持双指缩放、双击切换和单指拖动；
- 查看器缩放范围为 1～5 倍，并保持合理移动边界。

### 重新遇见过去

- Time Gear 从所有有效 Memory 中完全随机抽取一条；
- 基础关键词搜索覆盖 `Memory.title` 和 `Memory.story`；
- 不使用推荐算法、浏览权重或 AI。

### Stage 与内容管理

- 创建、修改和选择 Stage 封面；
- 将 Memory 分配、切换或取消分配 Stage；
- Memory 与 Stage 采用“移入回收站 → 恢复 / 永久删除”的删除流程；
- 永久删除需要用户再次确认。

### Owner 与 Visitor

- Owner 使用单一私密密码登录；
- 写入 API 与管理入口均要求 Owner 身份；
- Owner 可以为单个 Memory 开启或关闭分享；
- 分享支持“有链接即可访问”和“链接 + 密码”两种模式；
- Visitor 看到相同的博物馆式 Memory 展览界面，但保持只读；
- 未被分享的内容不会进入 Visitor 视图。

### 生产可靠性

- Next.js standalone Docker 镜像；
- SQLite 数据库和上传图片使用宿主机持久目录；
- 容器重启、容器重建、镜像重建和服务器重启后数据保持；
- 提供一致性备份与隔离恢复脚本；
- 更新部署保留更新前备份和上一版本回滚容器；
- 已在腾讯云轻量应用服务器完成生产部署、备份与恢复验证。

## 技术栈

| 层 | 选择 |
| --- | --- |
| Web | Next.js 16 App Router、React 19、TypeScript |
| 服务端 | Next.js Node.js Runtime |
| 数据库 | SQLite、显式 SQL schema |
| 图片处理 | Sharp |
| 图片存储 | 本地文件存储，通过独立 `ImageStorage` 边界访问 |
| 部署 | Next.js standalone、Docker、腾讯云轻量应用服务器 |
| 测试 | Node.js Test Runner |

V1 保持单体、低依赖和可读性优先，没有为了未来规模提前引入复杂服务。

## 项目结构

```text
src/
├── app/          # 页面、Route Handlers 与全局样式
├── components/   # 展览、创建、管理与交互组件
├── domain/       # Memory、Stage 等领域类型
├── data/         # SQLite schema 与数据访问层
├── storage/      # 图片处理与存储边界
└── i18n/         # 集中的中文文案

scripts/          # 数据库初始化、备份与恢复脚本
tests/            # 数据、图片、备份与交互几何测试
docs/             # 生产部署与运维文档
任务文件/         # 各阶段任务定义与产品总纲
```

UI、领域模型、数据访问、图片存储和数据库保持基本分离。页面组件不直接拼接 SQL，图片处理也不与 Memory 页面高度耦合。

## 本地运行

### 环境要求

- Node.js 24；
- pnpm 10。

### 安装与启动

```bash
git clone https://github.com/pcmif-jiangfeng/personal-memory-palace.git
cd personal-memory-palace
pnpm install
cp .env.example .env.local
pnpm db:init
pnpm dev
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env.local
```

打开 `http://localhost:3000`。

首次运行前，请在 `.env.local` 中把 `MEMORY_PALACE_OWNER_PASSWORD` 改为自己的私密密码。不要把真实密码提交到版本库。

## Demo 与 Owner 数据

项目提供两套相互隔离的数据集：

| 配置 | 数据库 | 用途 |
| --- | --- | --- |
| `MEMORY_PALACE_DATASET=demo` | `data/demo.sqlite` | 默认模式，初始化少量演示 Stage 与 Memory |
| `MEMORY_PALACE_DATASET=owner` | `data/palace.sqlite` | 真实 Owner 数据，不混入 Demo 内容 |

可以通过 `MEMORY_PALACE_DATA_DIR` 修改数据根目录。优化图片和可选原图位于：

```text
data/images/uploads/<dataset>/
```

运行数据、数据库、上传照片和本地环境文件均不会提交到 Git。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `MEMORY_PALACE_DATASET` | `demo` 或 `owner` |
| `MEMORY_PALACE_DATA_DIR` | SQLite 与图片的持久化根目录 |
| `MEMORY_PALACE_OWNER_PASSWORD` | Owner 登录密码，生产环境必须设置 |
| `MEMORY_PALACE_SESSION_SECRET` | 独立会话签名密钥；生产环境至少 32 个字符，不能提交 Git |
| `MEMORY_PALACE_SECURE_COOKIES` | HTTPS 环境设为 `true`；仅在 HTTP/IP 验证时使用 `false` |

配置模板见 [`.env.example`](.env.example)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动本地开发服务 |
| `pnpm build` | 创建生产构建 |
| `pnpm start` | 启动生产服务 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | ESLint 静态检查 |
| `pnpm format` | 统一格式化源代码与测试 |
| `pnpm check` | 依次执行类型、静态检查、测试和格式检查 |
| `pnpm test` | 运行全部测试 |
| `pnpm db:init` | 初始化当前数据集数据库 |
| `pnpm db:demo:reset` | 重建 Demo 数据库 |
| `pnpm backup:manual` | 创建手动一致性备份 |
| `pnpm backup:restore-test` | 在隔离目录中验证备份可恢复性 |

提交代码前建议至少运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Docker 与生产部署

项目的 `Dockerfile` 使用多阶段构建，并输出 Next.js standalone 运行镜像。生产环境必须将数据目录映射到容器外部，避免容器替换时丢失数据库和照片。

当前生产目录约定：

```text
/opt/personal-memory-palace/
├── app/          # 项目源码
├── releases/     # 按提交版本保存的发布源码
├── data/         # SQLite 与图片持久数据
├── backups/      # 一致性备份
├── config/       # 仅服务器可读的环境配置
└── restore-tests/# 隔离恢复测试目录
```

完整的首次部署、环境配置、更新、Smoke Test、持久化验证、备份和恢复流程见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 数据与安全原则

- `.env`、Owner 密码、SSH 私钥不得进入版本库；
- 数据库、用户照片和备份不得放入 GitHub；
- 公网编辑入口必须使用 Owner 保护；
- 正式 HTTPS 环境必须启用 Secure Cookie；
- 更新前先备份，再切换容器，并保留可验证的回滚版本；
- 不直接永久删除 Memory 或 Stage，必须先进入回收站。

## 当前边界

V1 当前只服务单一 Owner。以下内容不属于当前版本：

- 用户注册、多用户平台、社区、关注、评论或点赞；
- AI 写作、AI 分类、AI 推荐或语义搜索；
- 人物、地点、地图和图谱可视化；
- EXIF 自动读取、RAW 文件或专业原片管理；
- 富文本、Markdown 编辑器和图片内文字混排；
- 3D 博物馆、可行走角色或游戏引擎；
- 深色主题和主题编辑器。

这些边界用于保护当前产品体验，避免项目退化为相册后台、社交平台或功能堆叠。

## 长期愿景

Personal Memory Palace 的长期方向不是增加更多管理面板，而是让“重新遇见过去”逐渐拥有空间感：

```text
二维人生长廊
↓
空间化私人博物馆
↓
用户在自己的博物馆中行走
↓
与展厅和画框交互
↓
进入一场 Memory Exhibition
```

未来可以探索人物、地点、当年今日、知识图谱或 AI Memory Assistant，但这些能力只有在不破坏私人、安静和真实记录原则时才会进入正式范围。

## 项目状态

当前已完成：

- 照片驱动的 Memory 创建闭环；
- 人生长廊、Stage 与 Memory Exhibition；
- 随机回忆、基础搜索、Later Notes、关联和回收站；
- Owner 登录与 Visitor 分享；
- Memory 核心内容编辑；
- 主视觉照片全屏缩放与移动；
- Docker 公网部署、持久化、备份与隔离恢复验证。

当前继续以小任务逐步演进。每个阶段只完成明确范围，并在进入下一阶段前完成测试和验收。
