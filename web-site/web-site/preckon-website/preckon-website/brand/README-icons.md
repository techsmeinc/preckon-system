# Preckon — favicon set & Logo component

## Files

**Drop these in `/public`:**

| File | Use |
|---|---|
| `favicon.svg` | Modern browsers (scalable) |
| `favicon.ico` | Legacy fallback (16/32/48) |
| `favicon-16.png`, `favicon-32.png` | PNG fallbacks |
| `apple-touch-icon.png` (180×180) | iOS home screen |
| `icon-192.png`, `icon-512.png` | PWA / Android (purpose `any`) |
| `maskable-icon-512.png` | PWA adaptive (purpose `maskable`) |
| `site.webmanifest` | Web app manifest |

**Add to your components:** `Logo.tsx`

---

## Next.js App Router (recommended)

Add the icons to `metadata` in `app/layout.tsx`:

```tsx
export const metadata = {
  title: "Preckon",
  description: "AI-native preconstruction — from drawings to a defensible estimate.",
  manifest: "/site.webmanifest",
  themeColor: "#0B1B2B",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};
```

> Alternatively, Next 15 auto-detects `app/favicon.ico`, `app/icon.png`, and
> `app/apple-icon.png` if you'd rather use the file-convention approach.

## Generic HTML `<head>`

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0B1B2B" />
```

---

## Logo component

The mark's stem and the wordmark letters use `currentColor`; teal is fixed on
the node and the "o". Flip light/dark by setting the text color on a parent.

```tsx
import { PreckonLogo, PreckonMark } from "@/components/Logo";

// Header (navy text on light)
<header style={{ color: "#0B1B2B" }}>
  <PreckonLogo size={22} />
</header>

// Footer (paper text on blueprint-night) — logo reverses automatically
<footer style={{ color: "#FBFCFE", background: "#06101C" }}>
  <PreckonLogo size={20} />
</footer>

// Mark alone (e.g. a loading state or nav collapse)
<span style={{ color: "#0B1B2B" }}>
  <PreckonMark size={32} />
</span>
```

The wordmark uses the `--font-display` CSS variable (General Sans) with a
system fallback, so wire General Sans via `next/font` and expose it as
`--font-display` to match the design system.
