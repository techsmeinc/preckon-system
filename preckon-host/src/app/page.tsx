"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, authClient } from "@/lib/auth-client";
import { PasswordInput } from "@/components/PasswordInput";

// Host console login. Replicates the DS-01 `.login` markup from the mock.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the login form and go straight to the console.
  // Uses the async getSession (not the reactive useSession hook, which errors
  // during SSR) so this runs purely client-side after mount.
  useEffect(() => {
    let alive = true;
    authClient.getSession().then((res) => {
      if (alive && res.data?.user) router.replace("/overview");
    });
    return () => {
      alive = false;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signIn.email({ email, password });
      // Better Auth returns { error } on failure rather than throwing.
      if ((res as any)?.error) {
        setError((res as any).error.message || "Invalid email or password.");
        return;
      }
      router.push("/overview");
    } catch (err: any) {
      setError(err?.message || "Sign-in failed. Please try again.");
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
        <h1>Sign in to the Host Console</h1>
        <p className="sub">Platform operations. Staff access only.</p>

        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            placeholder="you@preckon.com"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <div className="lbl-row">
            <label htmlFor="pw">Password</label>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
          <PasswordInput
            id="pw"
            placeholder="••••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="restricted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Access is restricted and every action is audited.
        </div>
      </form>
    </div>
  );
}
