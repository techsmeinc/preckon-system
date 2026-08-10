# Deploy the tenant plane to the VPS — one command, run on Windows.
#
#   powershell -ExecutionPolicy Bypass -File c:\Users\IKIO\Downloads\New\Preckon-system\preckon-tenant\deploy.ps1
#
# It exists because the manual runbook has a trap in it: the packaging half must
# run on Windows and the deploy half on the server, and pasting the whole block
# into an SSH session silently produces a 45-byte empty tarball, scp's THAT over
# the good one, and then every `docker compose up --build` reports success with
# every layer CACHED — a deploy that looks perfect and ships nothing.
#
# So: this refuses to run anywhere but Windows, and it checks the size of what
# arrived before it builds anything.

$ErrorActionPreference = "Stop"

if ($IsLinux -or $IsMacOS) {
  Write-Host "This script runs on Windows, not on the server." -ForegroundColor Red
  Write-Host "If your prompt says [root@localhost], type 'exit' first." -ForegroundColor Red
  exit 1
}

$Server  = "root@74.208.182.201"
$Root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # …\Preckon-system
$Bundle  = Join-Path $Root "preckon-tenant.tgz"

Write-Host "==> Packaging from $Root" -ForegroundColor Cyan
Push-Location $Root
try {
  if (Test-Path $Bundle) { Remove-Item $Bundle -Force }
  # .env is excluded on purpose: the server's own holds the real BETTER_AUTH_URL
  # and secrets, and the local one carries a raised AUTH_SIGNIN_MAX that must
  # never reach anything publicly reachable.
  tar czf preckon-tenant.tgz --exclude=node_modules --exclude=.next --exclude=.git `
    --exclude=test-results --exclude='*.tgz' --exclude=tsconfig.tsbuildinfo `
    --exclude=.uploads --exclude=.env preckon-tenant
  if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally { Pop-Location }

$size = (Get-Item $Bundle).Length
Write-Host ("    {0:N0} bytes" -f $size)
if ($size -lt 200000) { throw "That bundle is far too small to be real. Aborting before it overwrites a good one." }

Write-Host "==> Copying up (password prompt #1)" -ForegroundColor Cyan
scp $Bundle "${Server}:/tmp/preckon-tenant.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

# The remote half goes up as a file rather than as pasted text, so there is no
# way for it to end up typed into a password prompt.
$remote = @"
set -eu
cd /tmp
actual=`$(stat -c %s /tmp/preckon-tenant.tgz)
echo "==> Bundle on server: `$actual bytes"
if [ "`$actual" -ne $size ]; then echo "SIZE MISMATCH — expected $size. Aborting."; exit 1; fi

echo "==> Unpacking"
tar xzf /tmp/preckon-tenant.tgz -C /opt
cd /opt/preckon-tenant

echo "==> Migrations"
sh scripts/migrate.sh

echo "==> Building"
docker compose up -d --build app

echo "==> Running image"
docker compose images app

# How big the sheets actually are. This decides whether the remaining wait is
# the network (a big SVG) or was the database all along (a small one).
echo "==> Sheet sizes"
docker compose exec -T db mysql -uroot -ppreckon preckon_tenant -e \
  "SELECT COUNT(*) sheets,
          ROUND(AVG(LENGTH(svg))/1024) avg_kb,
          ROUND(MAX(LENGTH(svg))/1024) max_kb,
          ROUND(AVG(LENGTH(summary))/1024) summary_avg_kb
     FROM cad_extraction WHERE svg IS NOT NULL" 2>&1 | grep -v "Using a password"
"@

$tmp = Join-Path $env:TEMP "preckon-remote-deploy.sh"
# LF endings and no BOM: bash will not run a script with CRLF line endings.
[IO.File]::WriteAllText($tmp, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

Write-Host "==> Sending the deploy script (password prompt #2)" -ForegroundColor Cyan
scp $tmp "${Server}:/tmp/preckon-remote-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "scp of the deploy script failed" }

Write-Host "==> Deploying (password prompt #3)" -ForegroundColor Cyan
ssh $Server "bash /tmp/preckon-remote-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "remote deploy failed" }

Write-Host "==> Done. Hard-refresh app.preckon.com (Ctrl+Shift+R)." -ForegroundColor Green
