# Deploying the tenant plane to 74.208.182.201

The bundle is `preckon-tenant.tgz`, built from the repo root:

```bash
cd /c/Users/IKIO/Downloads/New/Preckon-system
rm -f preckon-tenant.tgz
tar czf preckon-tenant.tgz \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude=test-results \
  --exclude='*.tgz' --exclude=tsconfig.tsbuildinfo --exclude=.uploads --exclude=.env \
  preckon-tenant
```

`.env` is excluded on purpose. The server's own `/opt/preckon-tenant/.env` holds the
real `BETTER_AUTH_URL`, DB host and secrets; shipping the local one would point the
deployed app at `localhost` and would carry `AUTH_SIGNIN_MAX=200`, which must never
be set on anything publicly reachable.

## 1. Copy it up — run from PowerShell, NOT from inside an SSH session

```powershell
cd c:\Users\IKIO\Downloads\New\Preckon-system
scp preckon-tenant.tgz root@74.208.182.201:/tmp/
```

## 2. Then on the server

```bash
ssh root@74.208.182.201

# Unpack over the existing checkout. docker-compose.override.yml is not in the
# bundle, so the server's BETTER_AUTH_URL override survives untouched.
tar xzf /tmp/preckon-tenant.tgz -C /opt
cd /opt/preckon-tenant

# The API key the drawing assistant, the chain agents and the Copilot all need.
# Add it once; it is read by the worker only — the app container never sees it.
grep -q '^ANTHROPIC_API_KEY=' .env || echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env

# New table for BIM Studio. Idempotent — safe to re-run.
docker compose exec -T db mysql -uroot -ppreckon preckon_tenant \
  < db/migrations/004_bim_document.sql

docker compose up -d --build app worker
```

## 3. Verify

```bash
# The worker has the key
docker compose exec -T worker sh -c \
  'echo "key: $([ -n "$ANTHROPIC_API_KEY" ] && echo YES || echo NO)"'

# The proxy reaches Anthropic
TOK=$(grep -E '^INTERNAL_SERVICE_TOKEN' .env | cut -d= -f2-)
curl -s -X POST http://localhost:4000/claude \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-8","maxTokens":20,"messages":[{"role":"user","content":"say ready"}]}'

# The table exists
docker compose exec -T db mysql -uroot -ppreckon preckon_tenant \
  -e 'SHOW TABLES LIKE "bim_document"'

# Sign-in still works through the public origin
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://app.74.208.182.201.nip.io/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"owner@cedarstone.build","password":"preckon-tenant-2026"}'
```

Then open <https://app.74.208.182.201.nip.io>, go to a project → **Drawings**, and
type an instruction into BIM Studio's prompt bar.

## Drawings (.dxf / .dwg)

`.dxf` works with nothing extra — the `cad` sidecar parses it on upload.

`.dwg` is proprietary and binary. ezdxf converts it through the **ODA File
Converter**, a free download from opendesign.com. Install it on the host, then
point the sidecar at it:

```bash
# in /opt/preckon-tenant/.env
EZDXF_ODAFC=/opt/ODAFileConverter/ODAFileConverter
```

and mount it into the container. Without it a `.dwg` upload is marked **failed**
with a message telling the estimator to export DXF — it is never silently
ingested as unreadable bytes, because a drawing that looks understood but isn’t
is how a BOQ quietly loses a discipline.

## Retiring stale artifacts

A project that ran against the stub agents (before `ANTHROPIC_API_KEY` was set)
carries records that look real but aren’t. To clear them without breaking
provenance:

```bash
node scripts/retire-artifacts.mjs --project <pid> --before 2026-08-01 --dry-run
node scripts/retire-artifacts.mjs --project <pid> --before 2026-08-01   --reason "stub-agent output"
```

It supersedes rather than deletes — downstream records keep their lineage — and
writes one audit entry through the chain’s stored procedure. Verify after with
`GET /api/v1/audit/verify`.

## The host plane (and the QA checklist it serves)

The checklist is a static file in the host's `public/`, baked into the image at
build time — so publishing an updated one means rebuilding the host, not copying
a file into a running container (that would vanish on the next recreate).

Build the bundle from the repo root:

```bash
cd /c/Users/IKIO/Downloads/New/Preckon-system
rm -f preckon-host.tgz
tar czf preckon-host.tgz \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude=test-results \
  --exclude='*.tgz' --exclude=tsconfig.tsbuildinfo --exclude=.env \
  preckon-host
```

From PowerShell:

```powershell
scp preckon-host.tgz root@74.208.182.201:/tmp/
```

Then on the server:

```bash
tar xzf /tmp/preckon-host.tgz -C /opt
cd /opt/preckon-host
docker compose up -d --build app
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/checklist.html   # 200
```

The checklist is then at **`/checklist.html` on whatever origin serves the Host
console** — append the path to the URL you already use to reach Host. Results are
stored per browser in localStorage, so each tester keeps their own; Export CSV
pulls from the same case list the page renders.

## Rate limiting

`AUTH_SIGNIN_MAX` must stay unset on the server. Unset, sign-in throttles at 3
attempts per minute, which is the point. It exists only so the local e2e suite —
which signs in once per test — can run.
