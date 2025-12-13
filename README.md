# GPT Bypass Proxy Server

标准 HTTP Forward Proxy（支持 `CONNECT`），为 GPT Bypass Chrome 扩展的 PAC 代理模式设计：把特定域名的流量转发到云服务器，再由云服务器访问目标网站。

当前代码实现重点是“可控的 Forward Proxy”：仅允许转发到白名单域名，并对每个来源 IP 做基础限流。

## 特性

- Forward Proxy：支持 HTTP 代理（absolute-form）与 HTTPS `CONNECT` 隧道
- 域名白名单：`ALLOWED_DOMAINS` 支持精确域名与 `*.example.com` 通配符
- 基础防护：内置内存限流（按 IP，超限会短暂封禁）
- 健康检查：`GET /health`
- 日志：控制台 + 按天滚动文件日志（默认 `./logs`）

## 工作原理（业务流程）

代码入口：`src/index.js`。

- HTTP 请求（`http.createServer`）
  - `GET /health`：直接返回 JSON
  - 其它请求：先按 IP 限流 → 解析目标 URL → 校验域名白名单 → 转发到上游（`http`/`https`）
- HTTPS 请求（`server.on('connect')`）
  - 解析 `CONNECT host:port` → 校验白名单 → `net.connect` 建立 TCP 隧道 → 双向 `pipe`

## 端到端数据流

```text
Chrome(含 PAC) / 其它客户端
  |
  | 1) 代理请求：
  |    - HTTP: GET http(s)://target/path  (absolute-form)
  |    - HTTPS: CONNECT target:443        (建隧道)
  v
gpt-bypass-proxy (公网 IP:PORT)
  |
  | 2) 入站校验：
  |    - 按来源 IP 限流（优先 X-Forwarded-For，其次 remoteAddress）
  |    - 校验目标域名是否在 ALLOWED_DOMAINS（支持 *. 通配符）
  |
  | 3a) HTTP 转发：
  |    - 解析 req.url 得到协议/host/port/path
  |    - 清理 hop-by-hop 头并重写 Host
  |    - 使用 http/https 模块发起上游请求并 pipe 响应回客户端
  |
  | 3b) HTTPS CONNECT：
  |    - net.connect(host, port) 连接上游
  |    - 返回 200 Connection Established
  |    - clientSocket <-> upstreamSocket 双向 pipe（透明转发 TLS 流量）
  v
目标站点（例如 chatgpt.com / openai.com / ...）
```

## 配置

配置加载：`src/config/index.js`（来源为环境变量 / `.env`）。

### 常用环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `10800` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `ALLOWED_DOMAINS` | 内置一组 AI 域名 | 允许代理的目标域名（逗号分隔） |
| `PROXY_TIMEOUT` | `30000` | 上游请求/连接超时（ms） |
| `KEEP_ALIVE_TIMEOUT` | `5000` | 服务端 keep-alive 超时（ms） |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 限流窗口（ms） |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | 每窗口最多请求数（按 IP） |
| `LOG_LEVEL` | `info` | 日志级别（`error|warn|info|debug`） |
| `LOG_DIR` | `./logs` | 日志目录 |
| `LOG_MAX_SIZE` | `20m` | 单个日志文件大小 |
| `LOG_MAX_FILES` | `14d` | 日志保留时长/数量（由 winston rotate 解析） |

说明：
- `ALLOWED_DOMAINS` 的通配符仅支持前缀形式：`*.example.com`（匹配 `a.example.com`，也会匹配根域 `example.com`）。
- 代码里会优先用 `X-Forwarded-For` 作为来源 IP（若存在），否则使用 TCP 连接的 `remoteAddress`。
- `.env.example` 里还有一些 `ENABLE_ADMIN_API/ENABLE_METRICS/...` 等字段，但当前 `src/index.js` 未实现对应接口；以代码行为为准。

## 快速开始

### 本地运行（Node.js）

```bash
npm install
cp .env.example .env
npm start
```

开发热重载：

```bash
npm run dev
```

### Docker

```bash
docker build -t gpt-bypass-proxy .
docker run -d --name gpt-bypass-proxy -p 10800:10800 gpt-bypass-proxy
```

### Docker Compose

```bash
docker compose up -d --build
docker compose logs -f
```

## 使用与验证

健康检查（示例响应字段：`status/timestamp/uptime/allowedDomains`）：

```bash
curl http://localhost:10800/health
```

通过代理访问 HTTP：

```bash
curl -x http://localhost:10800 http://example.com -I
```

通过代理访问 HTTPS（会走 `CONNECT`）：

```bash
curl -x http://localhost:10800 https://chatgpt.com -I
```

常见返回码：
- `403 Forbidden: domain not allowed`：目标域名不在 `ALLOWED_DOMAINS`
- `429 Too Many Requests`：触发限流（会被短暂封禁一段时间）
- `502 Bad Gateway`：上游连接/请求失败或超时

## 部署与运维

- 进阶部署文档：`DEPLOYMENT.md`
- 常用脚本：
  - `scripts/deploy.sh`：在 Linux 上部署为 systemd + PM2（偏传统部署）
  - `scripts/deploy_docker_oneclick.sh`：一键 Docker 部署
  - `scripts/update_docker_online.sh`：在线更新/回滚镜像并重建容器

## License

MIT（见 `package.json` 中的 `license` 字段）
