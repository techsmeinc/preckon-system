"use client";
// "Get the desktop app", offered where the desktop app would help.
//
// Which is exactly two places: BIM Studio and the Drawing editor. Those are the
// tools the workstation contains, and the .dwg wall — the one thing a browser
// genuinely cannot get past — is hit in the editor. Anywhere else it is an
// advert, and an advert on every screen is how people learn to stop reading the
// screen.
//
// Hidden when it is already true. This component is compiled into the
// workstation too (it ships the real panel), and a button inviting you to
// download the app you are sitting in is the kind of detail that makes software
// feel unattended.

import { useEffect, useState } from "react";
import Link from "next/link";
import { desktop } from "@/lib/desktop";
import { useI18n } from "@/lib/i18n";

export function GetDesktop({ variant = "button" }: { variant?: "button" | "note" }) {
  const { t } = useI18n();
  // Read after mount. The server has no window, and markup that differs between
  // the server's HTML and the client's is a hydration mismatch.
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(desktop() === null); }, []);

  if (!show) return null;

  if (variant === "note") {
    return (
      <p className="csub dsk-note">
        <span>{t("studio.getDesktop")}</span>
        <Link className="btn btn-ghost" href="/desktop">
          <DesktopIcon />
          {t("studio.getDesktopCta")}
        </Link>
      </p>
    );
  }

  return (
    <Link className="mini sm dsk-btn" href="/desktop" title={t("studio.getDesktop")}>
      <DesktopIcon />
      {t("studio.getDesktopCta")}
    </Link>
  );
}

const DesktopIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="4" width="19" height="12" rx="1.5" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);
