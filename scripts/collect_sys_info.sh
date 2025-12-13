#!/usr/bin/env bash
set -euo pipefail

timestamp="$(date +'%Y%m%d_%H%M%S')"
outfile="$(pwd)/gpt_bypass_sysinfo_${timestamp}.log"

sep(){ printf "\n===== %s =====\n" "$1"; }
run(){ echo "\$ $*"; eval "$@" 2>&1; }

{
  sep "OS / Kernel"
  run "uname -a"
  run "grep PRETTY_NAME /etc/os-release || cat /etc/os-release || true"

  sep "CPU / Memory"
  run "lscpu | head -n 20"
  run "free -h"
  run "uptime"

  sep "Disk"
  run "df -hT | sed -n '1,10p'"

  sep "Network Interfaces / IP"
  run "ip addr show | sed -n '1,200p'"

  sep "Open Ports (listening)"
  run "ss -ltnp | sed -n '1,200p' || netstat -tulpn 2>/dev/null | sed -n '1,200p'"

  sep "Firewall (ufw/iptables)"
  run "sudo ufw status || ufw status || true"
  run "sudo iptables -L -n | head -n 50 || iptables -L -n | head -n 50 || true"

  sep "Package Managers"
  run "which apt yum dnf zypper apk | tr ' ' '\n'"

  sep "Node / npm / PM2"
  run "node -v || true"
  run "npm -v || true"
  run "pm2 -v || true"

  sep "Docker / Compose"
  run "docker --version || true"
  run "docker compose version || docker-compose --version || true"

  sep "TLS Certificates (common paths)"
  for p in /etc/ssl/certs /etc/letsencrypt/live; do
    [ -d "$p" ] && run "ls -lah $p | head -n 50"
  done

  sep "Env / Config hints"
  run "echo \"ADMIN_TOKEN=\${ADMIN_TOKEN:-unset}\""
  run "echo \"ALLOWED_DOMAINS=\${ALLOWED_DOMAINS:-unset}\""
  run "echo \"ENABLE_ADMIN_API=\${ENABLE_ADMIN_API:-unset}\""
  run "echo \"ENABLE_METRICS=\${ENABLE_METRICS:-unset}\""

  sep "Done"
  echo "Log saved to: ${outfile}"
} | tee "${outfile}"
