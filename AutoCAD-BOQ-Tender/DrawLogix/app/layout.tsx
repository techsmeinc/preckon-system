import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "DrawLogix — DXF Editor",
  description: "AutoCAD-style DXF editor with an AI copilot.",
};

// The editor is DB-backed and tenant-scoped — never statically prerendered.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: some browser extensions inject attributes (e.g.
          data-listener-added) into the DOM before React hydrates — harmless, but it
          would otherwise trip a hydration mismatch warning. */}
      <body className="h-screen overflow-hidden bg-[#0d1017]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
