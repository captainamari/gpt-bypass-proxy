#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gpt-bypass-proxy"
IMAGE_TAG="${IMAGE_TAG:-gpt-bypass-proxy:local}"
PORT="${PORT:-10800}"
HOST_IP="${HOST_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)}"
ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-openai.com,chatgpt.com,claude.ai,gemini.google.com,anthropic.com,coze.com,x.ai,meta.ai,aistudio.google.com,grok.com}"
ENABLE_ADMIN_API="${ENABLE_ADMIN_API:-false}"
ENABLE_METRICS="${ENABLE_METRICS:-false}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo -e "\033[34m[INFO]\033[0m $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m $*"; }
err() { echo -e "\033[31m[ERR]\033[0m $*" >&2; }

require_root_or_docker_group() {
  if groups | grep -q '\bdocker\b'; then
    return 0
  fi
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    err "Run as root or a user in the docker group."
    exit 1
  fi
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi
  log "Docker not found, installing..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker.io
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker
    systemctl enable --now docker
  else
    err "Unsupported package manager. Install Docker manually and re-run."
    exit 1
  fi
}

build_image() {
  log "Building image ${IMAGE_TAG}..."
  docker build -t "${IMAGE_TAG}" "${ROOT_DIR}"
}

run_container() {
  log "Starting container ${APP_NAME} on port ${PORT}..."
  docker rm -f "${APP_NAME}" >/dev/null 2>&1 || true
  docker run -d \
    --name "${APP_NAME}" \
    --restart unless-stopped \
    -p "${PORT}:${PORT}" \
    -e PORT="${PORT}" \
    -e HOST=0.0.0.0 \
    -e ADMIN_TOKEN="${ADMIN_TOKEN}" \
    -e ENABLE_ADMIN_API="${ENABLE_ADMIN_API}" \
    -e ENABLE_METRICS="${ENABLE_METRICS}" \
    -e ALLOWED_DOMAINS="${ALLOWED_DOMAINS}" \
    "${IMAGE_TAG}"
}

print_summary() {
  local ip="${HOST_IP:-unknown}"
  if command -v curl >/dev/null 2>&1; then
    ip="$(curl -s --max-time 2 https://checkip.amazonaws.com 2>/dev/null || echo "${ip}")"
  fi

  cat <<EOF

Deployment complete.
- Public IP: ${ip}
- Proxy port: ${PORT}
- Admin API: ${ENABLE_ADMIN_API} (token: ${ADMIN_TOKEN})
- Set the Chrome extension `proxyServer` as: ${ip}:${PORT}
- Health check: curl http://127.0.0.1:${PORT}/health
- Logs: docker logs -f ${APP_NAME}

EOF
}

main() {
  require_root_or_docker_group
  install_docker_if_needed
  build_image
  run_container
  print_summary
}

main "$@"
