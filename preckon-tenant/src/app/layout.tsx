import type { Metadata } from "next";
import "./globals.css";

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
