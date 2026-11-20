# 打开后台（本地模式）：建立 SSH 隧道，然后在浏览器打开 http://localhost:8080/admin
# 关掉这个窗口 = 关掉隧道。
$key = Join-Path $HOME '.ssh\wuye_azure_ed25519'
Start-Process 'http://localhost:8080/admin'
Write-Host '隧道已连接。后台地址：http://localhost:8080/admin   （关闭此窗口即断开）'
ssh -i $key -N -L 8080:127.0.0.1:8080 ubuntu@141.148.35.139
