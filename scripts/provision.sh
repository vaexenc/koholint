#!/usr/bin/env bash
# provisions a fresh debian/ubuntu vps and starts the prod stack.
#
#   curl -fsSL https://raw.githubusercontent.com/vaexenc/koholint/main/scripts/provision.sh | bash -s -- [domain]
#
# safe to re-run: every step checks what already exists or is idempotent.
set -euo pipefail

DOMAIN="${1:-koholint.toomuchofheaven.com}"
APP_DIR=/opt/koholint
REPO=https://github.com/vaexenc/koholint.git

[[ $EUID -eq 0 ]] || {
	echo "run as root" >&2
	exit 1
}
export DEBIAN_FRONTEND=noninteractive

echo "== system packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ca-certificates openssl ufw fail2ban unattended-upgrades

echo "== swap"
# the docker build (tsc + vite) can oom small instances without it.
if [[ -z "$(swapon --show --noheadings)" ]]; then
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	echo "/swapfile none swap sw 0 0" >>/etc/fstab
fi

echo "== docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "== firewall"
# ports published by docker bypass ufw; this covers everything else.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
# http/3
ufw allow 443/udp
ufw --force enable

echo "== unattended upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "== fail2ban"
# the default backend reads auth.log, which minimal debian images don't write.
cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
backend = systemd

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

echo "== app"
if [[ -d $APP_DIR/.git ]]; then
	git -C "$APP_DIR" pull --ff-only
else
	git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

if [[ ! -f .env ]]; then
	sed -e "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" \
		-e "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 32)/" \
		.env.example >.env
fi

# the server container runs as uid 1000 and has to own the sqlite dir before
# the first up (compose.prod.yaml).
mkdir -p _data/db
chown -R 1000:1000 _data

echo "== stack"
docker compose -f compose.prod.yaml up -d --build

echo "done. admin token is in $APP_DIR/.env"
