# Wuye admin (local-only): opens an SSH tunnel, then the admin at http://localhost:8080/admin
# Close this window to close the tunnel. (ASCII only: Windows PowerShell 5.1 misreads UTF-8 without BOM.)
$key = Join-Path $HOME '.ssh\wuye_azure_ed25519'
Write-Host 'Tunnel connecting... Admin: http://localhost:8080/admin   (close this window to disconnect)'
Start-Job { Start-Sleep 3; Start-Process 'http://localhost:8080/admin' } | Out-Null
ssh -i $key -N -o ServerAliveInterval=30 -L 8080:127.0.0.1:8080 ubuntu@141.148.35.139
