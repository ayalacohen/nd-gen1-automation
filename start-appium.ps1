Write-Host "🧹 Cleaning Appium log..."

if (!(Test-Path ".\logs")) {
    New-Item -ItemType Directory -Path ".\logs" | Out-Null
}

Remove-Item ".\logs\appium.log" -Force -ErrorAction SilentlyContinue

Write-Host "🚀 Starting Appium..."

.\node_modules\.bin\appium.cmd `
    --port 4723 `
    --relaxed-security `
    --log ./logs/appium.log
