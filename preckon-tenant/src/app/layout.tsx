import type { Metadata, Viewport } from "next";
import "./globals.css";

// Next injects width=device-width on its own, but not viewport-fit — and
// without that `env(safe-area-inset-*)` resolves to 0, so the padding that
// keeps the sidebar and the Copilot clear of a notch and a home indicator
// would quietly do nothing. themeColor paints the browser chrome to match the
// app, so a dark workspace does not sit under a white status bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F9FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1626" },
  ],
};

export const metadata: Metadata = {
  title: "Preckon — Tenant workspace",
  description: "Preckon Core + the Construction pack. Agents propose; humans dispose.",
};

// Set the theme AND the tenant's brand accent before first paint, so a
// white-labelled workspace never flashes Preckon teal on the way in. In
// production --brand is injected server-side from `tenant_theme` (§7); this is
// the local echo of that value so the toggle is instant.
// Locale is applied here too: an Arabic user must not see one frame of
// left-to-right layout before React hydrates and flips it.
const themeInit = `(function(){try{
  var t=localStorage.getItem('preckon-theme')||'light';
  document.documentElement.setAttribute('data-theme',t);
  var b=localStorage.getItem('preckon-brand');
  if(b) document.documentElement.style.setProperty('--brand',b);
  var l=localStorage.getItem('preckon-locale')||localStorage.getItem('preckon-tenant-locale');
  if(l==='en'||l==='ar'||l==='fr'){
    document.documentElement.setAttribute('lang',l);
    document.documentElement.setAttribute('dir', l==='ar' ? 'rtl' : 'ltr');
  }
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
