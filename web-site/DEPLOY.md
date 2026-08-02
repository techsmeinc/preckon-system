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

| URL | Serves |
|---|---|
| `/` | `index.html` |
| `/platform` | `preckon-platform.html` |
| `/modules` | `preckon-modules.html` |
| `/why` | `preckon-why.html` |
| `/security` | `preckon-security.html` |
| `/pricing` | `preckon-pricing.html` |
| `/about` | `preckon-about.html` |
| `/demo` | `preckon-demo.html` |

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
```

Then in a browser: theme toggle, mobile width, and the nav on every page.

If clean URLs 404 while `/preckon-platform.html` works, `.htaccess` either didn't
upload or `AllowOverride` is off — the latter is rare on IONOS shared hosting;
re-check the upload first.

---

## Known gaps — these ship as-is unless you address them

1. **The demo form does not send anything.** `/demo` validates input and shows a
   success message, then discards it. Every lead from launch onward is lost until a
   submit handler is wired to a real endpoint (Formspree, HubSpot, or a mail script).
   This is the highest-priority item.
2. **Security claims are unverified.** `/security` states AES-256, TLS 1.2+, RLS and
   SSO/RBAC as fact. Confirm each matches what Preckon actually implements before
   this page is public — the source README flagged the same thing. SOC 2 is correctly
   marked in progress.
3. **Privacy policy link is `#`** on the demo form, next to a field collecting name,
   company and email. That's a compliance gap for EU/UK visitors, and the site is
   translated into five languages.
4. **Mailboxes must exist**: `sales@`, `support@`, `hello@preckon.com` are linked
   sitewide. Set them up in IONOS → Email.
5. **Pricing tiers carry no figures** — intentional, per the source README.
6. **Fonts load from Google Fonts and Fontshare via `@import`.** Third-party requests
   on every page view; self-host them for speed and for EU privacy comfort.
7. **Translations are nav-chrome only.** The language switcher changes five nav labels;
   all body copy stays English. Don't promote the non-English versions.
8. **No analytics or cookie consent** is installed.

## Updating the site later

Edit the files in `deploy/`, re-upload the changed ones. HTML is cached for 10
minutes, images for a year — if you change an image, rename it, or it will be stale
in visitors' browsers.
