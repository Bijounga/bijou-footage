# Builds the Bijou Footage Stream Deck plugin and packs it into
# dist/com.bijounga.bijoufootage.streamDeckPlugin — double-click that file to install it.
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path node_modules)) { npm ci }
    npm run build
    npx streamdeck validate com.bijounga.bijoufootage.sdPlugin
    npx streamdeck pack com.bijounga.bijoufootage.sdPlugin --output dist --force --no-update-check
}
finally {
    Pop-Location
}
