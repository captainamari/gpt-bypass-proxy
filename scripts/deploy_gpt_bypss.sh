#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gpt-bypass-proxy"
APP_DIR="/opt/gpt-bypass-proxy"
REPO_URL="https://github.com/gpt-bypass/proxy-server.git"
PORT="10800"
ADMIN_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)"
PROXY_AUTH_PASSWORD="$(openssl rand -hex 8 2>/dev/null || head -c 8 /dev/urandom | xxd -p)"
ALLOWED_DOMAINS="openai.com,chatgpt.com,claude.ai,gemini.google.com,anthropic.com,coze.com,x.ai,meta.ai,aistudio.google.com,grok.com"

log(){ echo -e "\e[34m[INFO]\e[0m $*"; }
warn(){ echo -e "\e[33m[WARN]\e[0m $*"; }
err(){ echo -e "\e[31m[ERR]\e[0m $*" >&2; }

require_root(){
  if [ "$EUID" -ne 0 ]; then
    err "请用 root 运行（或 sudo bash deploy_gpt_bypass.sh）"; exit 1;
  fi
}

install_node_pm2(){
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
    log "安装 Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get update
    apt-get install -y nodejs
  else
    log "已存在满足要求的 Node.js: $(node -v)"
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    log "安装 PM2..."
    npm install -g pm2
  else
    log "已存在 PM2: $(pm2 -v)"
  fi
}

install_tools(){
  log "安装基础工具..."
  apt-get update
  apt-get install -y git curl build-essential ca-certificates
}

fetch_code(){
  log "获取代码到 ${APP_DIR}..."
  rm -rf "${APP_DIR}"
  git clone --depth=1 "${REPO_URL}" "${APP_DIR}"
}

make_env(){
  log "生成 .env..."
  cat > "${APP_DIR}/.env" <<EOF
PORT=${PORT}
HOST=0.0.0.0
NODE_ENV=production
PROXY_TIMEOUT=30000
MAX_CONNECTIONS=1000
KEEP_ALIVE_TIMEOUT=5000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
ENABLE_CORS=true
CORS_ORIGIN=*
LOG_LEVEL=info
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
LOG_DIR=./logs
ENABLE_METRICS=true
METRICS_PORT=9090
HEALTH_CHECK_INTERVAL=30000
CACHE_TTL=300
CACHE_MAX_KEYS=10000
ALLOWED_DOMAINS=${ALLOWED_DOMAINS}
ADMIN_TOKEN=${ADMIN_TOKEN}
PROXY_AUTH_PASSWORD=${PROXY_AUTH_PASSWORD}
ENABLE_ADMIN_API=true
SSL_ENABLED=false
DB_ENABLED=false
EOF
}

install_deps(){
  log "安装生产依赖..."
  cd "${APP_DIR}"
  npm install --omit=dev
}

setup_process(){
  log "用 PM2 启动服务..."
  cd "${APP_DIR}"
  pm2 start src/index.js --name "${APP_NAME}" -- \
    || true
  pm2 save
  log "配置开机自启..."
  pm2 startup systemd -u root --hp /root >/tmp/pm2.startup.log 2>&1 || true
}

open_port(){
  log "放行 ${PORT}/tcp（iptables）..."
  iptables -C INPUT -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT -p tcp --dport "${PORT}" -j ACCEPT
}

health_check(){
  log "等待服务启动并做健康检查..."
  for i in {1..15}; do
    if curl -fs "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      log "健康检查通过"
      return 0
    fi
    sleep 2
  done
  warn "健康检查未通过，请手动检查 pm2 logs ${APP_NAME}"
}

print_summary(){
  cat <<EOF

部署完成！
- 监听端口: ${PORT}
- 代理认证密码: ${PROXY_AUTH_PASSWORD}
- 管理令牌: ${ADMIN_TOKEN}
- 健康检查: curl http://$(hostname -I | awk '{print $1}'):${PORT}/health
- 管理接口示例: curl -H "Authorization: Bearer ${ADMIN_TOKEN}" http://$(hostname -I | awk '{print $1}'):${PORT}/admin/status
- PM2 查看日志: pm2 logs ${APP_NAME}
- PM2 状态: pm2 status

EOF
}

main(){
  require_root
  install_tools
  install_node_pm2
  fetch_code
  make_env
  install_deps
  open_port
  setup_process
  health_check
  print_summary
}

main "$@"
