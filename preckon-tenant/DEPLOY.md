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

## Rate limiting

`AUTH_SIGNIN_MAX` must stay unset on the server. Unset, sign-in throttles at 3
attempts per minute, which is the point. It exists only so the local e2e suite —
which signs in once per test — can run.
