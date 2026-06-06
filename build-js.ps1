# build-js.ps1
# Rebuild the frontend JS bundle with esbuild.
# Run this after editing any .js file in js/.
#
# Prerequisites: Node.js (npx esbuild runs without global install)
param(
    [switch]$Watch    # Keep watching and rebuild on changes
)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $projectRoot

if ($Watch) {
    Write-Host "👀 Watching js/ for changes... (Ctrl+C to stop)" -ForegroundColor Cyan
    npx esbuild js/app.js --bundle --format=esm --outfile=js/bundle.js --watch
} else {
    Write-Host "🔨 Building js/bundle.js..." -ForegroundColor Cyan
    npx esbuild js/app.js --bundle --format=esm --outfile=js/bundle.js
    Write-Host "✅ Done" -ForegroundColor Green
}

Pop-Location
