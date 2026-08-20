# Testing DocLogix

Verified against the deployment of 20 Aug 2026, 16:05. Everything below was
checked on the running server before it was written down.

## What is actually deployed

| | state |
|---|---|
| Modules | `src/lib/doc/` — 10 files: store, numbering, revision, compare, retrieval, index-store, review, retention, transmittal, transmittal-store |
| API routes | 7 groups under `/api/v1/projects/{pid}/` — documents, documents/{did}, revisions, revisions/{rid}/issue, documents/search, transmittals, transmittals/{tid}/send, transmittals/{tid}/acknowledge |
| Tables | 12, all live: `document_register`, `document_revision`, `numbering_scheme`, `transmittal`, `transmittal_item`, `transmittal_recipient`, `distribution_list`, `distribution_member`, `document_review`, `document_review_assignee`, `document_comment`, `source_region` |
| Migrations | 019, 020 applied |
| Unit tests | 206 across 6 files |
| Data in production | **none** — every DocLogix table has 0 rows |

**Do not test this through the Documents page.** There is a
`projects/{pid}/documents` screen and it does work — but it is the older intake
screen, which uploads files and runs the classifier against
`/projects/{pid}/files`. It does not read the register, revisions or
transmittals, and nothing on it will show a document registered by the steps
below. Open it while testing and you will conclude DocLogix is wired up when it
is not.

DocLogix itself has **no screens at all** — that is the open P0 on its sheet.
This guide is therefore curl-based, and "test it in the UI" is not yet an
option.

## Two ways to test, and both are worth doing

### 1. The logic, with no server at all — 30 seconds

The domain rules are pure functions with tests. This is the fastest way to see
what DocLogix actually enforces:

```bash
cd preckon-tenant
npx vitest run test/doc-numbering.test.ts test/doc-revision.test.ts \
              test/doc-compare.test.ts test/doc-transmittal.test.ts \
              test/doc-governance.test.ts test/doc-retrieval.test.ts
```

Expect **206 passing**. Read the test names as the specification — they state
the rules in words (`"C outranks P"`, `"sending freezes the revision"`,
`"a hold outranks retention, including expired retention"`).

### 2. The API, against the deployment

#### Prerequisites

Use one of the scratch projects rather than a real one — these create real rows:

| project | id |
|---|---|
| `testing` | `019fb946-3efb-7e75-893f-5a6145d53b97` |
| `Test Project` | `019fb6a4-7d85-77f2-b0f0-bdab90d5357a` |

Sign in and keep the cookie. Every call needs it; `artifact.read` is required
for GET and `artifact.edit` for POST, so use an owner account.

```bash
BASE=https://app.preckon.com
PID=019fb946-3efb-7e75-893f-5a6145d53b97

curl -s -c jar.txt -X POST "$BASE/api/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@cedarstone.build","password":"<the password>"}'
```

A bare call without the cookie returns `401` — that is the correct answer and a
quick way to confirm the route is alive:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/projects/$PID/documents"   # 401
```

#### Step 1 — register a document

No numbering scheme has been configured, and that is fine: the register falls
back to the built-in ISO 19650 scheme. Its segments are `project`,
`originator`, `volume`, `level`, `type` (enum), `role` (enum), and `number`,
which is **allocated, not supplied**.

```bash
curl -s -b jar.txt -X POST "$BASE/api/v1/projects/$PID/documents" \
  -H 'content-type: application/json' -d '{
    "title": "Ground floor general arrangement",
    "segments": {"project":"PRK","originator":"TSM","volume":"ZZ","level":"00","type":"DR","role":"A"},
    "doc_type": "drawing",
    "discipline": "architecture",
    "confidentiality": "internal",
    "required_by": "2026-09-30"
  }'
```

Expect `201` and `{"id":"…","document_number":"PRK-TSM-ZZ-00-DR-A-0001"}`.

**Worth testing deliberately:** send `"type":"XX"` (not in the enum). You should
get `422` with an `issues` array **and no number consumed** — register the valid
one afterwards and confirm it is still `0001`. Gaps in a register are questions
somebody has to answer later, so the code validates before it allocates.

A file is deliberately not required. A register whose rows only appear once the
document arrives cannot tell you what is late, which is most of what it is for.

#### Step 2 — list the register

```bash
curl -s -b jar.txt "$BASE/api/v1/projects/$PID/documents" | head -c 600
curl -s -b jar.txt "$BASE/api/v1/projects/$PID/documents?discipline=architecture&q=ground"
```

The response carries `documents` and `schemes` — the scheme is returned so a
registration form can be rendered, with an `example` number showing the shape.

#### Step 3 — raise a revision

```bash
DID=<id from step 1>
curl -s -b jar.txt -X POST "$BASE/api/v1/projects/$PID/documents/$DID/revisions" \
  -H 'content-type: application/json' \
  -d '{"scheme":"alpha","suitability":"S2","description":"First issue for comment"}'
```

**Worth testing deliberately:** raise several in a row and watch the codes. The
alpha sequence **skips I and O** (they read as 1 and 0 on a drawing sheet), and
a preliminary `P` revision is outranked by a contract `C` revision. Try
`"scheme":"iso19650"` on another document to see the other convention.

#### Step 4 — issue it

```bash
RID=<revision id>
curl -s -b jar.txt -X POST \
  "$BASE/api/v1/projects/$PID/documents/$DID/revisions/$RID/issue"
```

Issuing plans supersession of the previous revision and applies it atomically —
there is no moment where two revisions are both current. Verify with SQL below.

#### Step 5 — transmit

```bash
curl -s -b jar.txt -X POST "$BASE/api/v1/projects/$PID/transmittals" \
  -H 'content-type: application/json' -d "{
    \"purpose\": \"For construction\",
    \"subject\": \"GA drawings, revision A\",
    \"revision_ids\": [\"$RID\"],
    \"recipients\": [{\"party\":\"Main Contractor\",\"kind\":\"to\"}]
  }"

TID=<transmittal id>
curl -s -b jar.txt -X POST "$BASE/api/v1/projects/$PID/transmittals/$TID/send"
curl -s -b jar.txt -X POST "$BASE/api/v1/projects/$PID/transmittals/$TID/acknowledge" \
  -H 'content-type: application/json' \
  -d '{"party":"Main Contractor","ack":"acknowledged"}'
```

**Worth testing deliberately:** a transmittal carries **revisions, not
documents** — so what was sent stays what was sent even after the document moves
on. Send it, then raise revision B, then re-read the transmittal: it must still
show A. Also try recalling it (`acknowledge` accepts a recall with a `reason`) —
a recall never deletes the record of what went out.

#### Step 6 — search

```bash
curl -s -b jar.txt "$BASE/api/v1/projects/$PID/documents/search?q=ground+floor+slab&budget=2000"
```

Meaning-based chunking with hybrid ranking and budget packing. Note the honest
limit: **no embeddings are generated**, so this is lexical-plus-structural
rather than semantic, and it is the reason Retrieval/RAG is still graded Partial.

## Verifying in the database

```bash
ssh root@74.208.182.201
cd /opt/preckon-tenant
docker compose exec -T db mysql -uroot -ppreckon preckon_tenant -e "
  SELECT document_number, title, status FROM document_register ORDER BY created_at DESC LIMIT 5;
  SELECT r.revision_code, r.suitability, r.status, d.document_number
    FROM document_revision r JOIN document_register d ON d.id = r.document_id
   ORDER BY r.created_at DESC LIMIT 10;
  SELECT t.purpose, t.status, COUNT(i.id) items
    FROM transmittal t LEFT JOIN transmittal_item i ON i.transmittal_id = t.id
   GROUP BY t.id ORDER BY t.created_at DESC LIMIT 5;"
```

After step 4 exactly one revision per document should be current, and the prior
one `superseded`. If two are current, that is a real bug — say so.

## Cleaning up afterwards

```sql
-- Scratch project only. Order matters: children first.
DELETE FROM transmittal_recipient WHERE transmittal_id IN (SELECT id FROM transmittal WHERE project_id = '<PID>');
DELETE FROM transmittal_item      WHERE transmittal_id IN (SELECT id FROM transmittal WHERE project_id = '<PID>');
DELETE FROM transmittal           WHERE project_id = '<PID>';
DELETE FROM document_revision     WHERE document_id IN (SELECT id FROM document_register WHERE project_id = '<PID>');
DELETE FROM document_register     WHERE project_id = '<PID>';
```

## What you cannot test yet, and why

| | |
|---|---|
| Any screen | Not built. The open P0 on the DocLogix sheet — everything is API-only. |
| OCR of scanned drawings | Absent. Text must already be extractable. |
| Semantic search quality | No embeddings generated yet; ranking is lexical and structural. |
| Review and distribution endpoints | `review.ts`, `retention.ts` and the distribution tables are built and tested, but have no HTTP routes yet — test them through the unit tests in section 1. |

That last row is the honest gap between "built" and "usable by a person": five
of the ten modules are reachable over HTTP, and the rest are reachable only from
code.
