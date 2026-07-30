"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "@/lib/auth-client";
import { PasswordInput } from "@/components/PasswordInput";
import { MIN_PASSWORD_LENGTH as MIN_LEN } from "@/lib/constants";

// Step 2 of password recovery. Better Auth redirects the reset link here with a
// one-time `?token=…` (or `?error=…` when the link is invalid/expired).
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const invalidLink = !token || !!linkError;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await resetPassword({ newPassword: password, token: token! });
      if ((res as any)?.error) {
        setError((res as any).error.message || "Could not reset password.");
        return;
      }
      setDone(true);
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

        {done ? (
          <>
            <h1>Password updated</h1>
            <p className="sub">You can now sign in with your new password.</p>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => router.push("/")}
            >
              Go to sign in
            </button>
          </>
        ) : invalidLink ? (
          <>
            <h1>Link expired</h1>
            <p className="auth-note">
              This password reset link is invalid or has expired. Request a fresh
              one to continue.
            </p>
            <Link className="btn btn-primary" href="/forgot-password">
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <h1>Set a new password</h1>
            <p className="sub">Choose a password with at least {MIN_LEN} characters.</p>

            <div className="field">
              <label htmlFor="pw">New password</label>
              <PasswordInput
                id="pw"
                placeholder="••••••••••••"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pw2">Confirm password</label>
              <PasswordInput
                id="pw2"
                placeholder="••••••••••••"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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

            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || !password || !confirm}
            >
              {busy ? "Updating…" : "Update password"}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="login-wrap" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
