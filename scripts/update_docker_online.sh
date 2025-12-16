#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-gpt-bypass-proxy}"
IMAGE_TAG="${IMAGE_TAG:-gpt-bypass-proxy:local}" # current/prod tag
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_TAG_FILE="${BACKUP_TAG_FILE:-${ROOT_DIR}/.last_backup_image_tag}"

log() { echo -e "\033[34m[INFO]\033[0m $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m $*"; }
err() { echo -e "\033[31m[ERR]\033[0m $*" >&2; }

usage() {
  cat <<'EOF'
Usage:
  scripts/update_docker_online.sh update   # default: pull (if git), backup, build, recreate container
  scripts/update_docker_online.sh rollback # recreate container using latest backup image tag
  scripts/update_docker_online.sh help

Env (optional):
  APP_NAME=gpt-bypass-proxy
  IMAGE_TAG=gpt-bypass-proxy:local
  BACKUP_TAG_FILE=/path/to/.last_backup_image_tag
  NO_PULL=1               # skip git pull

Notes:
  - Reads runtime env (PORT/ADMIN_TOKEN/ALLOWED_DOMAINS/ENABLE_*) from the existing container to avoid retyping.
  - For rollback it prefers BACKUP_TAG_FILE, otherwise finds the newest image tag like "<repo>:backup-YYYYmmddHHMMSS".
EOF
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { err "docker not found"; exit 1; }
  docker info >/dev/null 2>&1 || { err "docker not available (need root or docker group)"; exit 1; }
}

container_exists() {
  docker inspect "${APP_NAME}" >/dev/null 2>&1
}

get_container_env() {
  local key="$1"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${APP_NAME}" 2>/dev/null \
    | awk -F= -v k="${key}" '$1==k {print substr($0, index($0,$2))}' \
    | tail -n 1
}

collect_runtime_env() {
  PORT="${PORT:-$(get_container_env PORT)}"
  ADMIN_TOKEN="${ADMIN_TOKEN:-$(get_container_env ADMIN_TOKEN)}"
  
  # ENABLE_ADMIN_API="${ENABLE_ADMIN_API:-$(get_container_env ENABLE_ADMIN_API)}"
  # ENABLE_METRICS="${ENABLE_METRICS:-$(get_container_env ENABLE_METRICS)}"
  # ALLOWED_DOMAINS="${ALLOWED_DOMAINS:-$(get_container_env ALLOWED_DOMAINS)}"

  [[ -n "${PORT:-}" ]] || { err "PORT is empty (set PORT or ensure ${APP_NAME} exists)"; exit 1; }
  [[ -n "${ADMIN_TOKEN:-}" ]] || { err "ADMIN_TOKEN is empty (set ADMIN_TOKEN or ensure ${APP_NAME} exists)"; exit 1; }

  ENABLE_ADMIN_API="${ENABLE_ADMIN_API:-}"
  ENABLE_METRICS="${ENABLE_METRICS:-}"
  ALLOWED_DOMAINS="$(echo "${ALLOWED_DOMAINS:-}" | tr -d '[:space:]')"
}

maybe_git_pull() {
  if [[ "${NO_PULL:-}" == "1" ]]; then
    log "Skip git pull (NO_PULL=1)."
    return 0
  fi
  if [[ -d "${ROOT_DIR}/.git" ]] && command -v git >/dev/null 2>&1; then
    log "Updating code: git pull --ff-only"
    git -C "${ROOT_DIR}" pull --ff-only
  else
    warn "Skip git pull (no .git or git not installed)."
  fi
}

backup_image() {
  local ts backup_tag
  if docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
    ts="$(date +%Y%m%d%H%M%S)"
    backup_tag="${IMAGE_TAG%:*}:backup-${ts}"
    log "Backup image: ${IMAGE_TAG} -> ${backup_tag}"
    docker tag "${IMAGE_TAG}" "${backup_tag}"
    echo "${backup_tag}" > "${BACKUP_TAG_FILE}"
    log "Recorded backup tag: ${BACKUP_TAG_FILE}"
  else
    warn "No existing image ${IMAGE_TAG}, skip backup."
  fi
}

build_image() {
  log "Building image: ${IMAGE_TAG}"
  docker build -t "${IMAGE_TAG}" "${ROOT_DIR}"
}

recreate_container_with_image() {
  local image_ref="$1"

  log "Recreating container: ${APP_NAME} (image: ${image_ref})"
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
    "${image_ref}"
}

health_check() {
  log "Health check: http://127.0.0.1:${PORT}/health"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null && log "Health check OK" || warn "Health check failed"
  else
    warn "curl not found; skip health check."
  fi
  log "Logs: docker logs -f --tail=200 ${APP_NAME}"
}

find_latest_backup_tag() {
  local repo latest
  repo="${IMAGE_TAG%:*}"

  if [[ -f "${BACKUP_TAG_FILE}" ]]; then
    latest="$(tail -n 1 "${BACKUP_TAG_FILE}" | tr -d '[:space:]')"
    if [[ -n "${latest}" ]] && docker image inspect "${latest}" >/dev/null 2>&1; then
      echo "${latest}"
      return 0
    fi
    warn "Backup tag file exists but invalid/unavailable: ${BACKUP_TAG_FILE}"
  fi

  latest="$(docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E "^${repo}:backup-[0-9]{14}$" \
    | head -n 1 || true)"

  [[ -n "${latest}" ]] || return 1
  echo "${latest}"
}

cmd_update() {
  require_docker

  if ! container_exists; then
    err "Container ${APP_NAME} not found; cannot auto-read runtime env."
    err "Either start it first or export PORT/ADMIN_TOKEN/ALLOWED_DOMAINS/ENABLE_* before running."
    exit 1
  fi

  collect_runtime_env
  maybe_git_pull
  backup_image
  build_image
  recreate_container_with_image "${IMAGE_TAG}"
  health_check
}

cmd_rollback() {
  require_docker

  if ! container_exists; then
    err "Container ${APP_NAME} not found; cannot auto-read runtime env."
    err "Either start it first or export PORT/ADMIN_TOKEN/ALLOWED_DOMAINS/ENABLE_* before running."
    exit 1
  fi

  collect_runtime_env

  local backup_tag
  backup_tag="$(find_latest_backup_tag)" || { err "No backup image tag found to rollback."; exit 1; }
  log "Rolling back to: ${backup_tag}"
  recreate_container_with_image "${backup_tag}"
  health_check
}

main() {
  local cmd="${1:-update}"
  case "${cmd}" in
    update) cmd_update ;;
    rollback) cmd_rollback ;;
    help|-h|--help) usage ;;
    *) err "Unknown command: ${cmd}"; usage; exit 1 ;;
  esac
}

main "$@"

