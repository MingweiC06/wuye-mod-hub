#!/bin/sh
# One-time server hardening for wuye (run with sudo on the server). Safe to re-run.
set -eu

# 1) SSH: no root login, no X11, fewer guesses per connection. Tunnels (AllowTcpForwarding) stay ON: the admin needs them.
cat > /etc/ssh/sshd_config.d/90-wuye-hardening.conf <<'CONF'
PermitRootLogin no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
PasswordAuthentication no
KbdInteractiveAuthentication no
CONF
sshd -t
systemctl reload ssh

# 2) rpcbind is not used by anything here.
systemctl disable --now rpcbind.socket rpcbind.service 2>/dev/null || true

# 3) Data files readable by the app user only.
chmod 700 /opt/wuye/data
find /opt/wuye/data -maxdepth 1 -type f -exec chmod 600 {} +
chmod 700 /opt/wuye/backups 2>/dev/null || true

# 4) Sandbox the app: it can only write inside /opt/wuye, can't gain privileges, can't see /home.
mkdir -p /etc/systemd/system/wuye.service.d
cat > /etc/systemd/system/wuye.service.d/hardening.conf <<'CONF'
[Service]
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/opt/wuye
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077
CONF
systemctl daemon-reload
systemctl restart wuye
sleep 3
systemctl is-active wuye
echo "hardening applied"
