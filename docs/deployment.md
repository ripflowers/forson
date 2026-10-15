# Forson 发布与自动部署

目标仓库：`https://github.com/ripflowers/forson`。目标域名：`forson.ningxx.com`。目标服务器：`31.220.108.62`。

## 运行方式

独立 Docker Compose 项目 `forson` 运行 PostgreSQL、Python/Node 教学服务和静态前端。仅前端映射到服务器回环端口 `127.0.0.1:15178`；现有 Nginx 以独立虚拟主机代理，配置文件为 `deploy/forson.ningxx.com.conf`。图片、配音及视频保存在 `/opt/forson/data`，数据库保存在 `/opt/forson/postgres`，部署不会清空数据。

`/opt/forson/.env` 保持 `600` 权限，配置 `DB_PASSWORD`、`AI_BASE_URL`、`AI_MODEL`、`AI_VISION_MODEL`、`AI_REVIEW_MODEL`、`DEEPSEEK_API_KEY`。数据库连接由 Compose 注入，不能继续使用本机 `127.0.0.1:55432` 地址。密码使用不含 URL 保留字符的随机值。凭据不进入仓库或构建包。

当前产品为单家庭学习空间。Nginx 使用 `/opt/forson/access.htpasswd` 保护整个站点及 API；访问口令单独交付。数据库和应用容器没有公网端口。此服务器已有 Cloudflare Origin CA 通配符证书，覆盖 `*.ningxx.com`，有效期至 2041-03-30；虚拟主机使用服务器原有私有证书文件。Cloudflare 对此主机须使用 Full (strict)，HTTP 重定向到 HTTPS。

## CI 与发布流程

`.github/workflows/ci-deploy.yml` 对 PR 和 `main` 运行隔离数据库的后端测试、前端测试和生产构建。推送 `main` 还会先打包精确提交，再以和服务器一致的 `027` umask 解包，构建并检查正式容器及真实 Remotion 画面；通过后发布该同一构建包。测试图片是 CI 中生成的隔离夹具，不作为线上样卷。

配置以下 GitHub Secrets：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_KEY`、`DEPLOY_KNOWN_HOSTS`。CI 使用专用 SSH 密钥和经过可信渠道确认的服务器主机密钥。服务器在 `authorized_keys` 为这把专用公钥绑定：

```text
restrict,command="/opt/forson/bin/deploy" ssh-ed25519 <专用公钥> forson-github-actions
```

将 `deploy/deploy.sh` 安装为 root 所有的 `/opt/forson/bin/deploy`，权限 `750`。服务器需具有 Docker Compose V2、Bash、flock、curl、Python 3；先检查现有端口、Nginx 实际加载配置和存储空间。不要覆盖已有站点配置。

只有完成 SSH、公钥、环境文件、访问口令、DNS 和首次运行验证后，才将仓库变量 `DEPLOY_ENABLED` 设为 `true`。之后每次合并到 `main` 都会自动部署。服务健康检查失败时返回失败并恢复上一版容器；数据库不会随代码回退，发布前应单独备份。

部署会输出已部署的提交 SHA，当前成功版本指向 `/opt/forson/current`。核验需要比较该 SHA 与 GitHub 提交，再检查 Compose 健康状态、域名 HTTPS、API 数据库状态以及实际课堂页面。CI 通过和部署任务被跳过都不代表服务器已经上线。

## 当前发布记录

SSH 使用 root、22 端口，握手较慢，CI 等待上限为 180 秒。域名已通过 Cloudflare 代理解析。主机的 Nginx 虚拟站点、私有环境文件、访问口令和受限 CI 公钥已安装；本次任务通过 main 推送验证完整自动部署。最终运行证据见任务交付记录。
