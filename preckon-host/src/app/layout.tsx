import type { Metadata, Viewport } from "next";
import "./globals.css";

// See the tenant layout: viewport-fit is what makes env(safe-area-inset-*)
// resolve to anything on a notched phone, and themeColor stops a dark console
// from sitting under a white status bar. The console defaults to dark, so the
// dark value leads.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A1626" },
    { media: "(prefers-color-scheme: light)", color: "#F4F7FB" },
  ],
};

export const metadata: Metadata = {
  title: "Preckon · Host Console",
  description: "Preckon platform-operator control plane.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a flash (matches the mock). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("preckon-host-theme")||"dark";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}`,
          }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions inject attributes
          (e.g. data-listener-added) into <body> before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
