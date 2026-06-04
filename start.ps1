# start.ps1
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# 启动后端（新窗口）
Start-Process powershell -ArgumentList "-NoExit", "-Command cd $projectRoot\backend; python run.py"

# 启动前端（新窗口）
Start-Process powershell -ArgumentList "-NoExit", "-Command cd $projectRoot; python -m http.server 8080"

Write-Host "后端 → http://localhost:5000"
Write-Host "前端 → http://localhost:8080"
Write-Host "请在打开的浏览器中访问 http://localhost:8080"
