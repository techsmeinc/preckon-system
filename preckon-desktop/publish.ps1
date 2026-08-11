# Build the desktop installers and publish them to the workspace.
#
#   powershell -ExecutionPolicy Bypass -File preckon-desktop\publish.ps1
#
# Afterwards they appear on app.preckon.com/desktop with no rebuild and no
# restart: the app reads the download directory on every request, so a copy into
# the volume IS the release.
#
# electron-builder only builds for the platform it runs on (macOS needs a Mac,
# and a signed Windows build needs Windows). So this publishes whatever it just
# built and leaves the others alone - the page lists what exists, so a platform
# nobody has built for simply does not appear.

$ErrorActionPreference = "Stop"

if ($IsLinux -or $IsMacOS) {
  Write-Host "Run this on Windows. If your prompt says [root@localhost], type 'exit' first." -ForegroundColor Red
  exit 1
}

$Server = "root@74.208.182.201"
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $Here
try {
  if (-not (Test-Path "node_modules")) {
    Write-Host "==> Installing build dependencies (first run only)" -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  }

  # A reminder rather than a blocker: the app finds a user-installed converter
  # too, so an unbundled build is a working build.
  if (-not (Get-ChildItem "vendor\oda" -File -Recurse -ErrorAction SilentlyContinue)) {
    Write-Host "    note: vendor\oda is empty, so DWG support relies on each user having" -ForegroundColor Yellow
    Write-Host "          the ODA File Converter installed. Bundling it needs an ODA membership." -ForegroundColor Yellow
  }

  # Three levels, because the first one needs a Windows privilege most machines
  # do not grant. The NSIS installer pulls in the winCodeSign toolchain, whose
  # archive contains macOS symlinks - and creating a symlink on Windows requires
  # Administrator or Developer Mode, so 7-Zip fails to unpack it and the build
  # dies AFTER the app itself has been built perfectly well.
  #
  # So: try the installer; fall back to a zip, which needs none of that
  # toolchain; and if even that trips, zip the packaged folder by hand. All
  # three produce something a user can run. Only the first is an installer.
  Write-Host "==> Building the installer" -ForegroundColor Cyan
  npm run dist:win
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    The installer step failed - most likely the symlink privilege." -ForegroundColor Yellow
    Write-Host "    Falling back to a portable zip, which does not need it." -ForegroundColor Yellow
    Write-Host "    For a real installer, re-run this from an Administrator PowerShell." -ForegroundColor Yellow
    npm run dist:win:zip
  }

  # Last resort: the app was packaged before the failure, so zip that directly.
  $unpacked = Join-Path $Here "dist\win-unpacked"
  $anything = Get-ChildItem (Join-Path $Here "dist") -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".exe", ".zip", ".dmg", ".AppImage", ".deb" }
  if (-not $anything -and (Test-Path (Join-Path $unpacked "Preckon.exe"))) {
    Write-Host "    Packaging dist\win-unpacked by hand." -ForegroundColor Yellow
    $ver = (Get-Content (Join-Path $Here "package.json") | ConvertFrom-Json).version
    Compress-Archive -Path "$unpacked\*" -DestinationPath (Join-Path $Here "dist\Preckon-$ver-win.zip") -Force
  }
} finally { Pop-Location }

$installers = Get-ChildItem (Join-Path $Here "dist") -File |
  Where-Object { $_.Extension -in ".exe", ".zip", ".dmg", ".AppImage", ".deb" }
if (-not $installers) { throw "Nothing shippable was produced in dist\." }

foreach ($i in $installers) { Write-Host ("    {0}  {1:N0} bytes" -f $i.Name, $i.Length) }

Write-Host "==> Copying to the server (password prompt #1)" -ForegroundColor Cyan
foreach ($i in $installers) {
  scp $i.FullName "${Server}:/tmp/$($i.Name)"
  if ($LASTEXITCODE -ne 0) { throw "scp failed for $($i.Name)" }
}

# Into the named volume via the running container, which is the only way in
# without knowing where Docker keeps it on this host.
$names = ($installers | ForEach-Object { "'/tmp/$($_.Name)'" }) -join " "
$remote = @"
set -eu
cd /opt/preckon-tenant
for f in $names; do
  docker compose cp "`$f" app:/app/.downloads/
  rm -f "`$f"
done
echo '==> Published:'
docker compose exec -T app ls -la /app/.downloads
"@

$tmp = Join-Path $env:TEMP "preckon-publish.sh"
[IO.File]::WriteAllText($tmp, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

Write-Host "==> Publishing (password prompts #2 and #3)" -ForegroundColor Cyan
scp $tmp "${Server}:/tmp/preckon-publish.sh"
if ($LASTEXITCODE -ne 0) { throw "scp of the publish script failed" }
ssh $Server "bash /tmp/preckon-publish.sh"
if ($LASTEXITCODE -ne 0) { throw "publish failed" }

Write-Host "==> Live at https://app.preckon.com/desktop" -ForegroundColor Green
