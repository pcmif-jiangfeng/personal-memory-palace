# 邮箱验证与事务邮件配置

项目使用 Resend HTTPS API 发信，不使用 QQ/Gmail SMTP 密码。邮箱验证目前是有效期 24 小时的验证链接，不是数字验证码；注册、重发验证、找回密码和 K3/K4 通知共用同一组发信配置。

## 1. 验证发件域名

在 [Resend](https://resend.com/) 的 Domains 添加你实际持有且能修改 DNS 的域名或子域名。例如，若 `memorymuseum.top` 属于你，可使用 `mail.memorymuseum.top` 作为发信子域名。

到实际管理 DNS 的控制台（如果使用腾讯云 DNSPod，就到对应域名的 DNSPod 解析列表），按 Resend 当时展示的主机记录、类型、值逐项添加发信所需 SPF/DKIM 等记录，再回 Resend 验证 Sending 能力。不要猜记录值，不替换网站的 A 记录或已有邮箱的根域 MX；发信与收信是两项独立能力。[官方域名验证说明](https://resend.com/changelog/domain-verification-events)

## 2. 创建 API Key

Resend → API Keys → Create API Key。给生产站点单独创建 `Sending access` 密钥，并限制到刚验证的域名；保存到服务器，不放进 Git 或聊天。[官方权限说明](https://resend.com/changelog/new-api-key-permissions)

## 3. 服务器配置

在服务器编辑既有配置，不覆盖其他密码、会话密钥、数据目录或 Cookie 设置：

```bash
sudo nano /opt/personal-memory-palace/config/app.env
```

以下值是示例，必须填入实际密钥及已验证域名上的地址。Docker `--env-file` 的值不用加引号：

```dotenv
RESEND_API_KEY=re_替换为实际密钥
MEMORY_PALACE_EMAIL_FROM=人生博物馆 <no-reply@mail.memorymuseum.top>
```

发件地址必须与 Resend 中验证的域名匹配；这里的地址表示发件身份，不等于自动建立了能收回复的邮箱。若需要收信，应另外配置邮箱服务；本阶段不增加收信或 Reply-To 系统。

`app.env` 改好后，必须在部署更新步骤中**重新创建容器并传入同一个 `--env-file`**，保留原挂载、端口和其他参数。仅 `docker restart` 不会重新读取宿主机 env-file。不要单独复制旧的端口/挂载示例替换现有容器。

检查运行中的容器是否拿到了配置（只输出布尔值，不输出密钥）：

```bash
sudo docker exec personal-memory-palace node -e '
console.log({
  keyConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
  senderConfigured: Boolean(process.env.MEMORY_PALACE_EMAIL_FROM?.trim())
});'
```

两个 true 只证明变量已加载，不证明 Key 有效、域名已验证或邮件已送达。

本地开发则在项目根目录 `.env.local` 添加对应变量，`MEMORY_PALACE_EMAIL_FROM` 可用双引号包住整个值，然后重启开发服务；不要加 `NEXT_PUBLIC_` 前缀。已检查的本地 `.env.local` 在 2026-10-01 尚未包含这两项；未读取生产配置。

## 4. 真实验收

在正式网站打开 `/resend-verification`，输入已经注册且尚未验证的邮箱，提交重发，然后查看收件箱/垃圾箱和 Resend 的邮件记录，打开收到的链接完成验证。

邮件验证和找回密码链接在本地开发模式（`next dev`，`NODE_ENV=development`）使用 `http://localhost:3000/`；生产模式继续使用正式地址 `https://memorymuseum.top/`。本地测试请保持开发服务运行，并在同一台电脑打开邮件链接；本地账号的 token 不会自动存在于云端数据库。若正式域名改变，需要单独调整既有站点地址，不要只换发件域名。本地开发端口目前固定为 3000。

重发接口有账号冷却和请求限流；未知/已验证账号可得到通用成功响应来避免泄露账号存在性，不能只看网页“提交成功”认定已经发信。频繁重试应等待冷却，而不是绕过限制。

注册验证邮件在用户请求时发送，不依赖 cron。K3/K4 的重试和到期提醒还需在新版本上线、真实邮件验收后安装定时通知任务；那是另一项生产配置，不由本地代码自动安装。
