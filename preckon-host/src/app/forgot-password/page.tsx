"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth-client";

// Step 1 of password recovery: request a reset link by email. We always show the
// same success message whether or not the address exists, to avoid leaking which
// staff emails are registered.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if ((res as any)?.error) {
        setError((res as any).error.message || "Could not send reset link.");
        return;
      }
      setSent(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={onSubmit} noValidate>
        <div className="brand">
          <svg viewBox="0 0 48 56" width="24" height="28" fill="none" aria-hidden="true">
            <path
              d="M16 50V8h14a13 13 0 0 1 0 26H16"
              stroke="var(--ink)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="25" cy="21" r="3.6" fill="var(--teal)" />
          </svg>
          <span className="wm">
            Preck<span className="o">o</span>n
          </span>
          <span className="host-pill">HOST</span>
        </div>
        <h1>Forgot your password?</h1>
        <p className="sub">Enter your work email and we&apos;ll send a reset link.</p>

        {sent ? (
          <>
            <div className="auth-ok" role="status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>
                If an account exists for <b>{email}</b>, a reset link is on its way.
                Check your inbox and follow the link within 1 hour.
              </span>
            </div>
            <Link className="btn btn-ghost" href="/">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                placeholder="you@preckon.com"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  margin: "0 0 12px",
                  fontSize: 12,
                  color: "var(--red)",
                  background: "var(--red-tint)",
                  border: "1px solid var(--red)",
                  borderRadius: 9,
                  padding: "9px 12px",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16v.4" />
                </svg>
                {error}
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={busy || !email}>
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <Link className="auth-back" href="/">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back to sign in
            </Link>
          </>
        )}
      </form>
    </div>
  );
}
