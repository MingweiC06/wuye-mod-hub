# Push the latest committed code to the Oracle server. Data (votes, wishes, uploads) on the server is untouched.
# 部署前会先在服务器上做一次数据备份（失败即中止部署），并安装/刷新每日备份的 systemd timer。
# Run:  powershell -File scripts\deploy-oracle.ps1
#       powershell -File scripts\deploy-oracle.ps1 -SkipBackup   # 仅紧急回滚时使用
param(
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$key = "$HOME\.ssh\wuye_azure_ed25519"
$server = 'ubuntu@141.148.35.139'
$tgz = Join-Path $env:TEMP 'wuye-code.tgz'

# 1) 部署前备份：优先用服务器上已有的 scripts/backup.js（新版会备份 DB + files/ + media/ + 校验和）
if (-not $SkipBackup) {
  Write-Host 'Backing up production data before deploy...'
  $backupCmd = 'set -e; if [ -f /opt/wuye/scripts/backup.js ]; then sudo -u wuye env DATA_DIR=/opt/wuye/data BACKUP_DIR=/opt/wuye/backups KEEP=14 /usr/bin/node /opt/wuye/scripts/backup.js; else echo "scripts/backup.js not found on server" >&2; exit 1; fi'
  ssh -i $key $server $backupCmd
  if ($LASTEXITCODE -ne 0) { throw "Pre-deploy backup failed (exit $LASTEXITCODE). Deploy aborted; production was not changed." }
  Write-Host 'Backup done.'
} else {
  Write-Warning 'Skipping pre-deploy backup (-SkipBackup).'
}

# 2) 上传并解压已提交的代码（data/ 不在 tarball 里，服务器上的 data/ 不受影响）
git archive --format=tar.gz -o $tgz HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive failed (exit $LASTEXITCODE)" }
scp -i $key -q $tgz "${server}:/tmp/wuye-code.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
ssh -i $key $server 'sudo tar xzf /tmp/wuye-code.tgz -C /opt/wuye && sudo chown -R wuye:wuye /opt/wuye'
if ($LASTEXITCODE -ne 0) { throw "extract failed (exit $LASTEXITCODE)" }

# 3) 安装/刷新每日备份的 systemd unit（若本次提交里带了它们）
ssh -i $key $server 'if [ -f /opt/wuye/deploy/wuye-backup.timer ]; then sudo install -m 0644 /opt/wuye/deploy/wuye-backup.service /etc/systemd/system/wuye-backup.service && sudo install -m 0644 /opt/wuye/deploy/wuye-backup.timer /etc/systemd/system/wuye-backup.timer && sudo systemctl daemon-reload && sudo systemctl enable --now wuye-backup.timer && systemctl list-timers wuye-backup.timer --no-pager; else echo "backup units not in this commit; skipping timer install"; fi'
if ($LASTEXITCODE -ne 0) { throw "backup timer install failed (exit $LASTEXITCODE). Code is updated but wuye was NOT restarted." }

# 4) 重启站点并确认存活
ssh -i $key $server 'sudo systemctl restart wuye && sleep 2 && systemctl is-active wuye'
if ($LASTEXITCODE -ne 0) { throw "wuye restart/health check failed (exit $LASTEXITCODE)" }
Write-Host 'Done. Site updated.'
