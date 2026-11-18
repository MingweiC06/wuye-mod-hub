# Runs the site for the public at wuye.uniquetalentmap.com (Cloudflare Tunnel → 127.0.0.1:8090).
# Start the tunnel separately:  cloudflared tunnel run wuye-mc
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:PORT = '8090'
$env:HOST = '127.0.0.1'          # only the tunnel can reach it
$env:TRUST_PROXY = '1'           # real visitor IPs from Cloudflare
$env:COOKIE_SECURE = '1'         # logins over HTTPS only
$env:NODE_ENV = 'production'
$env:WIDGET_ORIGINS = 'http://localhost:8091'
$env:CF_ZONE_ID = 'f963865905fedb404e0c3be86a7ee80c'   # uniquetalentmap.com (not secret)
# Auto Under Attack: put the Cloudflare API token in data\cf-token.txt (never commit it).
node server.js
