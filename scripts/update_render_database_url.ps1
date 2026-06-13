# Update Render njuatlas-backend DATABASE_URL and trigger redeploy.
# Requires: $env:RENDER_API_KEY from https://dashboard.render.com/u/settings#api-keys
#
# Usage:
#   $env:RENDER_API_KEY = "rnd_..."
#   .\scripts\update_render_database_url.ps1 `
#     -DatabaseUrl "postgresql://...pooler.../neondb?sslmode=require&channel_binding=require"

param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,

    [string]$ServiceName = "njuatlas-backend"
)

$ErrorActionPreference = "Stop"

if (-not $env:RENDER_API_KEY) {
    Write-Error "Set RENDER_API_KEY first (Render Dashboard -> Account Settings -> API Keys)."
}

$headers = @{
    Authorization = "Bearer $($env:RENDER_API_KEY)"
    Accept        = "application/json"
    "Content-Type" = "application/json"
}

Write-Host "Listing Render services..."
$cursor = $null
$serviceId = $null
do {
    $uri = "https://api.render.com/v1/services?limit=100"
    if ($cursor) { $uri += "&cursor=$cursor" }
    $page = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    foreach ($entry in $page) {
        $svc = $entry.service
        if ($svc.name -eq $ServiceName) {
            $serviceId = $svc.id
            break
        }
    }
    if ($serviceId) { break }
    $cursor = $page[-1].cursor
} while ($cursor)

if (-not $serviceId) {
    Write-Error "Service '$ServiceName' not found."
}

Write-Host "Found service $ServiceName ($serviceId)"

$body = @{ key = "DATABASE_URL"; value = $DatabaseUrl } | ConvertTo-Json
Invoke-RestMethod `
    -Uri "https://api.render.com/v1/services/$serviceId/env-vars/DATABASE_URL" `
    -Headers $headers `
    -Method Put `
    -Body $body | Out-Null

Write-Host "DATABASE_URL updated. Triggering deploy..."
$deployBody = @{ clearCache = "do_not_clear" } | ConvertTo-Json
Invoke-RestMethod `
    -Uri "https://api.render.com/v1/services/$serviceId/deploys" `
    -Headers $headers `
    -Method Post `
    -Body $deployBody | Out-Null

Write-Host "Deploy triggered. Check Render dashboard for status."
