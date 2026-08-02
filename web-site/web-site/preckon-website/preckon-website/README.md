# Preckon — Marketing Site

The complete Preckon marketing website: eight pages on one design system (DS-01), one brand, all cross-linked and validated. Built with hand-authored HTML/CSS/JS so it drops straight into a static host or ports cleanly into your Next.js app.

---

## Pages

| File | Suggested route | What it is |
|---|---|---|
| `index.html` | `/` | **Homepage** — hero transformation, the shift, modules, how it works, dark intelligence layer, why us, industries, security, pricing, design partners, FAQ |
| `preckon-home.html` | — | Redirect to `index.html` (kept in case any old link points here) |
| `preckon-platform.html` | `/platform` | Interactive layered architecture (Copilot / six-module chain / Foundation) |
| `preckon-modules.html` | `/modules` | Deep-dive per Logix module, each with a product mock, + Construction Copilot |
| `preckon-why.html` | `/why` | Positioning — value-chain coverage map, capability matrix, stores-vs-understands |
| `preckon-security.html` | `/security` | Trust path, security pillars, honest compliance posture, security FAQ |
| `preckon-pricing.html` | `/pricing` | Two-part pricing model, three tiers, usage metering, comparison table |
| `preckon-about.html` | `/about` | Mission & vision, story, founder, tech philosophy, roadmap |
| `preckon-demo.html` | `/demo` | Demo-request form (client-side validated) + contact routes |

## Brand & design references (not routes)

| File | Purpose |
|---|---|
| `brand/preckon-design-system.html` | DS-01 — color tokens, type, the measured-line motif, components |
| `brand/preckon-identity-final.html` | Locked logo system — lockups, color, spacing, app icons, rules |
| `brand/preckon-logo-concepts.html` | The three logomark routes that were explored |
| `brand/Logo.tsx` | React component — `PreckonMark` + `PreckonLogo`, currentColor-aware |
| `brand/README-icons.md` | Icon/favicon install guide |
| `brand/preckon-mark*.svg`, `brand/preckon-logo-*.svg` | Production logo source files |
| `docs/…-Master-Brief.md` | Original strategy brief (pre-dates the Preckon rename; kept for reference) |

## Assets (place at web root / in `/public`)

`favicon.svg` · `favicon.ico` · `favicon-16.png` · `favicon-32.png` · `apple-touch-icon.png` · `icon-192.png` · `icon-512.png` · `maskable-icon-512.png` · `site.webmanifest`

> The pages now reference these with **relative** paths (`favicon.svg`, `site.webmanifest`) so the favicon shows when the pages and assets are served together in one folder. If you deploy pages at nested routes, switch these back to root-absolute (`/favicon.svg`).

---

## Theme & languages

**Dark / light toggle.** Every page has a theme toggle in the nav. It defaults to the visitor's system preference (`prefers-color-scheme`), can be flipped manually, and remembers the choice (`localStorage`, wrapped so it never breaks if storage is blocked). Theme is applied in a tiny `<head>` script before paint, so there's no flash. Dark mode is a `[data-theme="dark"]` token override — the light design is untouched.

**Language switcher.** The nav also has a language selector (EN · AR · FR · DE · ES). It switches `<html lang>` and `dir` (Arabic flips to RTL) and translates the **site chrome** (nav labels + primary CTA) via a small client-side dictionary — enough to prove the mechanism end to end.

> **Important — this is scaffolding, not full localization.** Only the nav/CTA strings are translated. The full page copy is still English, and RTL is basic (text direction flips, but decorative absolutely-positioned elements aren't mirrored yet). Do **not** ship machine-translated marketing copy to Middle-East / European buyers — technical construction terminology mistranslates badly and hurts credibility. For production, move i18n into the Next.js layer (`next-intl` or the App Router i18n) with **professionally translated** message catalogs per locale, proper RTL styling (CSS logical properties), and localized routes (`/ar`, `/fr`, …). The switcher UI and the `data-i18n` hooks already in the markup give that work a clean starting point.

---

## Deploy

### Option A — static host (Netlify, Vercel static, GitHub Pages, S3)
1. Upload all `preckon-*.html` + `index.html` + the asset files, with the assets at the **site root**.
2. `index.html` redirects `/` → the homepage. Done.
3. Optional: use your host's rewrites to serve clean URLs (`/platform` → `preckon-platform.html`).

### Option B — Next.js (recommended, matches your stack)
1. Create a route per page (`app/platform/page.tsx`, etc.); move each page's markup into the component.
2. Lift the shared `<style>` block into `globals.css`; port the CSS variables in `:root` into your Tailwind v4 `@theme`.
3. Load the three fonts via `next/font` and expose them as `--font-display` (General Sans), `--font-body` (Inter), `--font-mono` (JetBrains Mono) — the pages and `Logo.tsx` already reference those variables.
4. Put the icon files in `/public` and wire them via `metadata.icons` (see `README-icons.md`).
5. Use `Logo.tsx` for the nav/footer brand instead of the inline SVG.
6. Move the small per-page `<script>` blocks (reveals, the platform diagram, modules scrollspy, demo-form validation) into client components (`"use client"`).

---

## Before you go live — confirm these placeholders

- **Demo form** — currently front-end only (validates + shows success, but doesn't send). Wire the submit handler in `preckon-demo.html` to your CRM or an endpoint (Formspree, a Next.js route handler, HubSpot, etc.).
- **Email addresses** — `sales@ / support@ / hello@preckon.com` are placeholders on your domain; set up the mailboxes/routing.
- **Privacy notice** — the link on the demo form points to `#`; add a real privacy page.
- **Security specifics** — `preckon-security.html` states `AES-256`, `TLS 1.2+`, RLS, SSO/RBAC as the intended posture. Confirm each matches what's actually implemented before publishing. SOC 2 is deliberately marked **in progress** — keep it honest.
- **Founder & About** — the founder statement is placeholder copy in your voice; replace with your own words and add real bio detail. The avatar is an "MM" monogram (swap for a photo if you like); no founding year is stated — add one to the facts strip if desired.
- **Pricing** — tiers are qualitative (no dollar figures) while public pricing is being finalized. Add numbers when set.
- **Fonts** — General Sans loads from Fontshare and Inter/JetBrains Mono from Google Fonts via `@import`. For production, self-host (or use `next/font`) for speed and reliability.
- **OG/social images** — add per-page Open Graph images (generate them from the brand system) for good link previews.
- **Analytics** — add your analytics/consent tooling.

---

## What's validated

- Every internal link resolves — each cross-page link hits an existing file and every `#anchor` exists on its target page.
- No trace of the old "Construction Intelligence" name; every page carries the Preckon mark and teal-`o` wordmark.
- Navigation is uniform across all eight pages (Platform · Modules · Why us · Security · Pricing → dedicated pages; Book a demo → the demo page).
- Consistent nav, footer, favicon head, and `prefers-reduced-motion` handling on every page; `<style>`/`<script>`/`<section>` tags balanced throughout.

*One design system. One brand. Eight pages. From drawings to a defensible estimate.*
