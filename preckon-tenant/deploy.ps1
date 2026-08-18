# Deploy the tenant plane to the VPS  -  one command, run on Windows.
#
#   powershell -ExecutionPolicy Bypass -File c:\Users\IKIO\Downloads\New\Preckon-system\preckon-tenant\deploy.ps1
#
# It exists because the manual runbook has a trap in it: the packaging half must
# run on Windows and the deploy half on the server, and pasting the whole block
# into an SSH session silently produces a 45-byte empty tarball, scp's THAT over
# the good one, and then every `docker compose up --build` reports success with
# every layer CACHED  -  a deploy that looks perfect and ships nothing.
#
# So: this refuses to run anywhere but Windows, and it checks the size of what
# arrived before it builds anything.

$ErrorActionPreference = "Stop"

if ($IsLinux -or $IsMacOS) {
  Write-Host "This script runs on Windows, not on the server." -ForegroundColor Red
  Write-Host "If your prompt says [root@localhost], type 'exit' first." -ForegroundColor Red
  exit 1
}

# The server address is NOT committed. This repository is cloned onto machines
# and shared with reviewers, and a public file naming the production host is a
# free head start for anyone scanning it.
#
#   $env:PRECKON_HOST = "203.0.113.10"
#
if (-not $env:PRECKON_HOST) {
  Write-Host 'Set PRECKON_HOST first, e.g.  $env:PRECKON_HOST = "your.server.ip"' -ForegroundColor Red
  exit 1
}
$Server  = "root@$($env:PRECKON_HOST)"
$DbPass  = if ($env:DATABASE_PASSWORD) { $env:DATABASE_PASSWORD } else { "preckon" }
$Root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # ...\Preckon-system
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

# ── Getting bytes to this server ─────────────────────────────────────────────
#
# The link resets bulk transfers partway through: the handshake and any small
# command succeed, then a large upload dies at a consistent offset having crawled
# along at a few KB/s. Two things make that survivable.
#
# IPQoS=none. OpenSSH marks packets DSCP EF by default (`ssh -G` shows "ipqos ef
# cs0") — the class reserved for VoIP, which carriers police to a small budget
# and drop beyond it. That produces exactly this shape of failure, and the marking
# buys us nothing on a file copy.
#
# reput, not scp. scp has no notion of resume, so a reset means starting from
# zero — on a link that dies every ~100KB, a 1.3MB bundle never lands, however
# many times you retry. sftp's `reput` continues from what arrived. The transfer
# is then verified by SIZE rather than by exit code, because the thing being
# defended against is precisely a connection that reports success having moved
# only part of the file.
$SshOpts = @("-o", "IPQoS=none", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3")
$Key = Join-Path $env:USERPROFILE ".ssh\ionos_preckon"
if (Test-Path $Key) {
  $SshOpts += @("-i", $Key)
} else {
  Write-Host "    (no SSH key at $Key - expect a password prompt per attempt)" -ForegroundColor Yellow
}

function Send-Bundle {
  param([string]$Local, [string]$Remote, [long]$Size, [int]$Attempts = 25)

  $batch = Join-Path $env:TEMP "preckon-put.sftp"
  [IO.File]::WriteAllText($batch, "reput `"$Local`" `"$Remote`"`nexit`n",
                          (New-Object Text.UTF8Encoding $false))

  for ($i = 1; $i -le $Attempts; $i++) {
    & sftp @SshOpts -b $batch $Server 2>&1 | Out-Null

    # The server's own count is the only one that matters. sftp can exit 0 on a
    # reset, and it can exit non-zero having transferred the last byte.
    $landed = (& ssh @SshOpts $Server "stat -c %s '$Remote' 2>/dev/null || echo 0") -join ""
    $landed = [long]($landed.Trim())

    if ($landed -eq $Size) {
      Write-Host ("    {0:N0} bytes landed (attempt {1})" -f $landed, $i) -ForegroundColor Green
      return
    }
    if ($landed -gt $Size) { throw "remote file is LARGER than the bundle - delete $Remote and re-run" }
    Write-Host ("    attempt {0}: {1:N0} / {2:N0} bytes ({3:P0}) - resuming" -f `
                $i, $landed, $Size, ($landed / $Size)) -ForegroundColor DarkYellow
  }
  throw "upload did not complete in $Attempts attempts - the link to $($env:PRECKON_HOST) is too unstable"
}

Write-Host "==> Copying up (resumable)" -ForegroundColor Cyan
Send-Bundle -Local $Bundle -Remote "/tmp/preckon-tenant.tgz" -Size $size

# The remote half goes up as a file rather than as pasted text, so there is no
# way for it to end up typed into a password prompt.
$remote = @"
set -eu
cd /tmp
actual=`$(stat -c %s /tmp/preckon-tenant.tgz)
echo "==> Bundle on server: `$actual bytes"
if [ "`$actual" -ne $size ]; then echo "SIZE MISMATCH  -  expected $size. Aborting."; exit 1; fi

echo "==> Unpacking"
# Windows tar records file attributes as a SCHILY.fflags header GNU tar does not
# know, and warns about it once per file  -  two hundred lines of noise that hide
# anything real. Silenced where supported, kept where it is not.
tar xzf /tmp/preckon-tenant.tgz -C /opt --warning=no-unknown-keyword 2>/dev/null \
  || tar xzf /tmp/preckon-tenant.tgz -C /opt
cd /opt/preckon-tenant

# Bash will not run a script with CRLF line endings: `set -eu` arrives as
# `set -eu<CR>` and dies with "set: -: invalid option", having printed half the
# message over the other half because the CR sent the cursor back to column 0.
#
# This is normalised HERE, on the server, rather than trusted to be right in the
# bundle. The packaging half runs on Windows with core.autocrlf=true, so whether
# a given .sh arrives as LF depends on when it was last checked out — which is
# not a thing a deploy should be sensitive to. Cheap, idempotent, and it removes
# the whole class of failure rather than the instance of it.
echo "==> Normalising line endings"
find . -name '*.sh' -not -path './node_modules/*' -exec sed -i 's/\r`$//' {} + 2>/dev/null || true

echo "==> Migrations"
sh scripts/migrate.sh

# Artifact payload schemas live in the DATABASE, registered from the pack — they
# are NOT read from source at runtime. Ship code that uses a newly added field
# without re-registering, and the server keeps validating against the previous
# shape: every agent or editor write of that field is rejected with "Payload
# invalid for <type>" while the deploy itself reports success. An application
# that is up and quietly broken is worse than one that never came up.
#
# update-from-git.sh has always done this; this script did not, which is how the
# two deploy paths could land the same commit and behave differently.
#
# The seeder is rebuilt first, deliberately. `run` otherwise reuses the seed
# image already on the box — built from the PREVIOUS bundle — and would register
# the old catalog over the new code, reporting success. (`run --build` says this
# in one flag but wants Compose v2.13+; two commands work on every v2.)
#
# Before the app comes up, so there is no window in which it serves requests
# against schemas that do not match it. Idempotent (ON DUPLICATE KEY UPDATE),
# and cheap next to the build that follows.
echo "==> Re-registering the pack catalog (artifact schemas)"
docker compose build seed && docker compose --profile tools run --rm seed || {
  echo "  ! catalog seed FAILED - the schemas in the database do not match the code being deployed."
  echo "    Refusing to bring the app up against them."
  exit 1
}

# The WORKER is in this list, and leaving it out is how a deploy lands cleanly
# and changes nothing. Every prompt, every agent and every tool lives in
# worker/src and is baked into that image  -  so a change to how the Copilot
# thinks or how the bill is priced ships only when the worker is rebuilt. The
# app can look perfectly deployed while still running last week's agents.
echo "==> Building (app + worker + cad sidecar)"
docker compose up -d --build app worker cad

echo "==> Running images"
docker compose images app worker cad

# The volume the desktop installers are served from. Created here so the very
# first deploy after this change has somewhere to put them  -  an app that cannot
# stat its download directory just reports no builds, but the directory has to
# exist before publish.ps1 can copy into it.
docker compose exec -T app sh -c 'mkdir -p /app/.downloads' 2>/dev/null || true

# How big the sheets actually are. This decides whether the remaining wait is
# the network (a big SVG) or was the database all along (a small one).
echo "==> Sheet sizes"
docker compose exec -T db mysql -uroot -p$DbPass preckon_tenant -e \
  "SELECT COUNT(*) sheets,
          ROUND(AVG(LENGTH(svg))/1024) avg_kb,
          ROUND(MAX(LENGTH(svg))/1024) max_kb,
          ROUND(AVG(LENGTH(summary))/1024) summary_avg_kb
     FROM cad_extraction WHERE svg IS NOT NULL" 2>&1 | grep -v "Using a password"
"@

$tmp = Join-Path $env:TEMP "preckon-remote-deploy.sh"
# LF endings and no BOM: bash will not run a script with CRLF line endings.
[IO.File]::WriteAllText($tmp, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

Write-Host "==> Sending the deploy script" -ForegroundColor Cyan
Send-Bundle -Local $tmp -Remote "/tmp/preckon-remote-deploy.sh" -Size (Get-Item $tmp).Length

Write-Host "==> Deploying" -ForegroundColor Cyan
& ssh @SshOpts $Server "bash /tmp/preckon-remote-deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "remote deploy failed" }

Write-Host "==> Done. Hard-refresh app.preckon.com (Ctrl+Shift+R)." -ForegroundColor Green
