import type { Metadata } from "next";
import "./globals.css";

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
