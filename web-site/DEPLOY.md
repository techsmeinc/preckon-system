# Deploying the Preckon site to www.preckon.com (IONOS)

Everything ready to upload lives in [`deploy/`](deploy/). It is also zipped as
`preckon-www.zip` for the IONOS File Manager.

**Canonical URL:** `https://www.preckon.com` — `preckon.com`, `http://`, and the old
`.html` URLs all 301 to it.

---

## What's in the bundle

| File | Purpose |
|---|---|
| `index.html` | Homepage, served at `/` |
| `preckon-*.html` | The seven inner pages, served at clean routes (see below) |
| `404.html` | Branded not-found page, wired via `ErrorDocument` |
| `.htaccess` | HTTPS + www redirects, clean URLs, caching, compression, security headers |
| `robots.txt` · `sitemap.xml` | Search-engine directives, pointing at the live domain |
| `og-image.png` | 1200×630 social preview card (generated from the brand system) |
| `favicon.*`, `icon-*.png`, `apple-touch-icon.png`, `site.webmanifest` | Icon set — must sit at the web root |

Not deployed: `brand/` and `docs/` from the source folder are design references, not
routes. `preckon-home.html` was dropped — the `.htaccess` 301s it to `/`.

## Routes

| English | العربية | Serves |
|---|---|---|
| `/` | `/ar/` | `index.html` |
| `/platform` | `/ar/platform` | `preckon-platform.html` |
| `/modules` | `/ar/modules` | `preckon-modules.html` |
| `/why` | `/ar/why` | `preckon-why.html` |
| `/security` | `/ar/security` | `preckon-security.html` |
| `/pricing` | `/ar/pricing` | `preckon-pricing.html` |
| `/about` | `/ar/about` | `preckon-about.html` |
| `/demo` | `/ar/demo` | `preckon-demo.html` |

---

## The Arabic site (`/ar/`)

A full translation, not a language toggle — every page has a real Arabic URL that
Google can index separately, paired to its English twin via `hreflang`.

**Terminology** is Gulf construction usage: مناقصة (tender), جدول الكميات (BOQ),
مسّاح كميات (quantity surveyor), حصر الكميات (takeoff), الأسعار الإفرادية (rates).
Numerals are Western (`1,240`, `C30/37`) per Gulf technical-document convention.

**Kept in Latin**, deliberately: `Preckon`, the six `*Logix` module names,
`Construction Copilot`, drawing/spec codes (`CONC.GR-30`, `REQ-014`, `C30/37`),
email addresses, and `TechSME Inc.`

**RTL handling.** `dir="rtl"` plus a stylesheet that mirrors every
left/right-anchored element (module edge bars, tier flags, panel borders,
the flow-pulse animation direction). Three things that specifically bite Arabic
sites are handled:

- **Letter-spacing is forced to `normal`.** The design tracks its mono labels
  widely; on Arabic that severs the cursive glyph joins and renders words as
  disconnected letters.
- **Numeric ranges are bidi-isolated.** `2–6` in an RTL paragraph otherwise
  renders as `6–2`, because the bidi algorithm resolves the dash between two
  numbers as right-to-left. Same for `01 / 06`.
- **The mono stack is Arabic-first.** JetBrains Mono has no Arabic glyphs, and
  its very wide space was being used between Arabic words. Genuine code chips
  get JetBrains Mono restored by class.

**Typography** is IBM Plex Sans Arabic (Google Fonts), with line-height raised
from 1.5 to 1.75 for body and 1.35 for headings — Arabic needs more leading.

**The language switcher** is now EN · العربية and navigates to the counterpart
page, replacing the old five-language dictionary that only translated nav labels.
FR/DE/ES were removed: they had no content behind them.

`ar/.htaccess` contains only `ErrorDocument 404 /ar/404.html` so Arabic visitors
get the Arabic not-found page. It deliberately holds no rewrite directives, so
the root `.htaccess` rules keep governing `/ar/*` URLs.

> **Before the Arabic site goes in front of buyers:** have a native Arabic-speaking
> QS or estimator read it. The translation is careful and terminology-checked, but
> construction vocabulary carries regional weight that only a practitioner catches.

---

## Upload — option A: IONOS File Manager (no tools needed)

1. IONOS control panel → **Hosting** → your webhosting package for `preckon.com`
   → **File Manager** (or **Web Storage**).
2. Open the document root for `preckon.com`. Usually `/` or `/preckon.com/`
   — it's whichever folder the domain's *Destination* points at, shown under
   **Domains & SSL → preckon.com → Destination**.
3. Delete any IONOS placeholder page already there (typically `index.html`
   or `default.html`).
4. Upload `preckon-www.zip` and use the File Manager's **Extract** action, so the
   files land at the root of that folder — *not* inside a `deploy/` subfolder.
5. Confirm `.htaccess` came across. Some file managers hide dotfiles — enable
   "show hidden files". **If `.htaccess` is missing, the clean URLs won't work.**

## Upload — option B: SFTP

Get the host, username and port from IONOS → **Hosting → SFTP/SSH access**
(the password is one you set there — IONOS does not display it).

```bash
# from web-site/
sftp -P <port> <user>@<host>
> cd <document-root>
> put -r deploy/*
```

Or with WinSCP: connect, navigate to the document root, drag the *contents* of
`deploy/` (not the folder itself) across. Enable hidden files so `.htaccess` transfers.

`push.sh` in this folder wraps the same thing with `lftp` if you have it installed.

---

## DNS / domain settings

In the screenshot, `preckon.com` is already **Managed by IONOS Webhosting**, so the
A record already points at your webspace and nothing needs to change. Just confirm:

1. **Domains & SSL → preckon.com → Destination** points at the folder you uploaded to.
2. **`www.preckon.com` exists** and points to the same destination. If `www` isn't
   listed as a subdomain, add it — the site's canonical host is `www`, so without it
   the redirect in `.htaccess` sends visitors to a hostname that doesn't resolve.
3. **SSL is active** for both `preckon.com` and `www.preckon.com`
   (Domains & SSL → SSL Certificates). IONOS includes a free certificate; issue it
   before you test, or the forced-HTTPS redirect will land on a certificate warning.

> Order matters: get the certificate issued **before** uploading `.htaccess`, or your
> first visit will be an HTTPS redirect to an untrusted certificate.

---

## Verify after upload

```bash
curl -sI http://preckon.com/            | head -3   # -> 301 https://www.preckon.com/
curl -sI https://preckon.com/           | head -3   # -> 301 https://www.preckon.com/
curl -sI https://www.preckon.com/       | head -3   # -> 200
curl -sI https://www.preckon.com/platform | head -3 # -> 200
curl -sI https://www.preckon.com/preckon-platform.html | head -3  # -> 301 /platform
curl -sI https://www.preckon.com/nope   | head -3   # -> 404

# Arabic
curl -sI https://www.preckon.com/ar/          | head -3   # -> 200
curl -sI https://www.preckon.com/ar/pricing   | head -3   # -> 200
curl -sI https://www.preckon.com/ar/index.html | head -3  # -> 301 /ar/
curl -s  https://www.preckon.com/ar/ | grep -o '<title>[^<]*</title>'   # Arabic title
```

Then in a browser: theme toggle, mobile width, and the nav on every page.

If clean URLs 404 while `/preckon-platform.html` works, `.htaccess` either didn't
upload or `AllowOverride` is off — the latter is rare on IONOS shared hosting;
re-check the upload first.

---

---

## The demo form — REQUIRED SETUP

The form on `/demo` and `/ar/demo` posts to `submit.php`, which emails the request
to sales, sends the visitor a confirmation in their language, and appends every
submission to a CSV backup.

**It will not send mail until you do these two things:**

### 1. Create the sending mailbox

IONOS → **Email** → create `no-reply@preckon.com` and set a password.

It must be a real mailbox on a domain you control. The notification is sent *from*
this address with the visitor's address in `Reply-To` — so hitting Reply in your
inbox still replies to them. Sending directly "from" the visitor's address would
fail SPF/DMARC and land in spam.

While you are there, create `sales@`, `support@` and `hello@preckon.com` — all three
are linked across the site.

### 2. Fill in `config.php`

```php
'to'       => 'sales@preckon.com',      // where demo requests land
'from'     => 'no-reply@preckon.com',   // the mailbox you just made
'smtp' => [
    'enabled'  => true,
    'host'     => 'smtp.ionos.com',
    'port'     => 587,
    'secure'   => 'tls',
    'username' => 'no-reply@preckon.com',
    'password' => '...',                // <-- the mailbox password
],
```

Confirm the SMTP host against IONOS → Email → your mailbox → settings; IONOS
occasionally uses a different host per region.

Setting `'enabled' => false` falls back to PHP `mail()`. The form still works, but
deliverability is meaningfully worse — unauthenticated mail from shared hosting is
frequently spam-filtered. Use SMTP.

### What it does

| | |
|---|---|
| **Notification** | To `sales@`, subject `Demo request — Company (Name)`, with `Reply-To` set to the visitor |
| **Auto-reply** | Confirmation to the visitor, in English or Arabic per the form they used |
| **CSV backup** | Every submission appended to `_data/leads.csv` — written *before* mail is attempted, so a lead survives an SMTP outage |
| **Reference** | Each submission gets `PRECKON-DEMO-XXXXX`, shown on screen and in both emails |

### Spam handling

No captcha. Three layers instead: an off-screen honeypot field, a time trap
(submissions completed in under 3 seconds are bots), and per-IP rate limiting
(5/hour, configurable). Bots get a fake success response so they do not retry with
a different payload shape.

Server-side validation is independent of the JavaScript — the endpoint cannot be
bypassed by posting directly, and CR/LF is rejected in any field that reaches a
mail header.

### If mail fails

The visitor sees an error telling them to email `sales@preckon.com` directly, and
the endpoint returns HTTP 500. **The lead is still in `_data/leads.csv`.** Check
that file if you suspect anything went missing; the CSV is the source of truth.

`_data/` and `_lib/` are blocked from web access by `.htaccess`, and `config.php`
is denied too — so even if PHP were disabled, the SMTP password would not be served
as plain text.

### Requirements

PHP 5.5+ (any IONOS package qualifies). No Composer, no database, no third-party
service. PHPMailer is vendored in `_lib/PHPMailer/`.

### Testing after upload

Submit the form yourself from `https://www.preckon.com/demo`. You should get the
success panel with a reference, a notification at `sales@`, and a confirmation at
whatever address you entered. Then repeat on `/ar/demo` and confirm the reply
arrives in Arabic. If the success panel does not appear, open the browser console —
the response body carries the reason.

---

## Known gaps — these ship as-is unless you address them

1. **Privacy policy link is `#`** on the demo form, next to fields collecting name,
   company and email. The form now stores and transmits that data, so this matters
   more than it did. A real privacy page is needed for EU/UK visitors.
2. **Security claims are unverified.** `/security` states AES-256, TLS 1.2+, RLS and
   SSO/RBAC as fact. Confirm each matches what Preckon actually implements before
   this page is public — the source README flagged the same thing. SOC 2 is correctly
   marked in progress.
3. **Mailboxes must exist**: `no-reply@` (required by the form), plus `sales@`,
   `support@` and `hello@preckon.com`, which are linked sitewide.
4. **Arabic enquiries need an Arabic responder.** The form tags each submission with
   its locale, and the CSV has a `locale` column — but routing Arabic leads to
   someone who can reply in Arabic is a process decision, not a code one.
5. **Arabic is a full translation** (see the `/ar/` section above) but has not been
   reviewed by a native construction professional. FR/DE/ES were removed from the
   switcher — they were nav labels with no content behind them.
6. **Pricing tiers carry no figures** — intentional, per the source README.
7. **Fonts load from Google Fonts and Fontshare via `@import`.** Third-party requests
   on every page view; self-host them for speed and for EU privacy comfort.
8. **No analytics or cookie consent** is installed.
9. **Back up `_data/leads.csv`.** It is the only copy of a lead if mail ever fails,
   and it is not covered by any IONOS backup you have configured.

## Updating the site later

Edit the files in `deploy/`, re-upload the changed ones. HTML is cached for 10
minutes, images for a year — if you change an image, rename it, or it will be stale
in visitors' browsers.
