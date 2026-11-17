# 用 GitHub Student Pack 免费上线（Azure for Students）

> 你的 GitHub 学生权益已通过验证（有效期到 2028-09），可以直接领取
> **Microsoft Azure for Students：$100 额度 + 25+ 免费服务，不需要信用卡**。
> DigitalOcean 的 $200 优惠已从 2026 年的 Student Pack 中下架，Azure 是目前
> 最适合这个项目的免费选项。

## 1. 领取 Azure 额度

1. 打开 <https://education.github.com/pack>，登录 GitHub；
2. 找到 **Microsoft Azure** 卡片，点「Get access by connecting your GitHub account」；
3. 跳到 Azure for Students 页面后点 **Start free**；
4. 用微软账号登录（没有就新建一个），按提示完成手机/学校邮箱验证；
5. 看到 Azure 门户、订阅显示 **Azure for Students**（$100 额度）即成功。

> 不需要信用卡。若提示需要付款方式，确认你走的是「Azure for Students」而不是
> 普通「Azure free account」。

## 2. 创建虚拟机

在 Azure 门户 → **Virtual machines → Create**：

| 项目 | 选择 |
| --- | --- |
| 订阅 | Azure for Students |
| 资源组 | 新建 `wuye-rg` |
| 虚拟机名称 | `wuye-mod-hub` |
| 区域 | **East Asia（香港）** 或 Japan East（国内访问较快） |
| 可用性 | No infrastructure redundancy required |
| 映像 | Ubuntu Server 24.04 LTS (x64) |
| 大小 | **Standard_B1s**（1 vCPU / 1 GiB，约 $9/月，$100 可用约 10 个月） |
| 身份验证 | SSH public key（推荐）或密码 |
| 入站端口 | 22、80、443 |
| 公共 IP | 新建，**Static**（静态，重启不变） |
| DNS 名称标签 | 例如 `wuye-mc` → `wuye-mc.eastasia.cloudapp.azure.com` |

> 1 GiB 内存足够跑这个站（Node + SQLite 常驻约 60–100 MB）。创建后建议加 1 GB
> swap，命令见下。

## 3. 创建后把这三样发我

1. 公网 IP（Overview 页的 Public IP address）；
2. SSH 用户名（创建时填的，例如 `azureuser`）；
3. SSH 私钥路径，或你设置的登录密码（建议私钥；不要发到公开聊天里，可先改成
   临时密码，部署完再换回密钥）。

有了这些，我直接帮你完成：Node 24 安装、代码部署、systemd、Nginx/Caddy、
HTTPS、管理员码初始化、备份 cron 和首次恢复验证。

## 4. 域名（可选，但 HTTPS 需要）

- 免费方案：Student Pack 里的 **Namecheap 1 年 .me 域名**或 **.TECH 免费域名**；
- 也可以先用 Azure 自带的 `xxx.eastasia.cloudapp.azure.com` 配 Caddy 自动 HTTPS；
- 服务器在境外，**不需要 ICP 备案**，但国内访问延迟会比国内机房高（香港约 30–80ms）。

## 5. 手动部署（如果你想自己来）

```bash
# 登录 VM
ssh azureuser@<公网IP>

# 1) swap（1G 内存建议加）
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 2) Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx

# 3) 代码
sudo mkdir -p /srv && sudo chown $USER:$USER /srv
git clone https://github.com/MingweiC06/wuye-mod-hub.git /srv/wuye-mod-hub
cd /srv/wuye-mod-hub

# 4) 先前台跑一次，确认能启动并记下管理码
PORT=8080 ADMIN_CODE='换成你自己的强管理码' node server.js
# Ctrl+C 停止

# 5) 之后按 deploy/README.md 配 systemd + Nginx + certbot
```

> 详细步骤（用户权限、systemd 加固、Nginx、certbot、备份 cron、回滚）见
> [deploy/README.md](README.md)。
