# Push the latest committed code to the Oracle server. Data (votes, wishes, uploads) on the server is untouched.
# Run:  powershell -File scripts\deploy-oracle.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$key = "$HOME\.ssh\wuye_azure_ed25519"
$server = 'ubuntu@141.148.35.139'
$tgz = Join-Path $env:TEMP 'wuye-code.tgz'
git archive --format=tar.gz -o $tgz HEAD
scp -i $key -q $tgz "${server}:/tmp/wuye-code.tgz"
ssh -i $key $server 'sudo tar xzf /tmp/wuye-code.tgz -C /opt/wuye && sudo chown -R wuye:wuye /opt/wuye && sudo systemctl restart wuye && sleep 2 && systemctl is-active wuye'
Write-Host 'Done. Site updated.'
