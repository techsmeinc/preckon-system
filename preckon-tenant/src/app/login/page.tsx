"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [email, setEmail] = useState("owner@aigcc.group");
  const [password, setPassword] = useState("preckon-tenant-2026");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session?.user) router.replace("/overview"); }, [session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) setErr(error.message ?? "Sign-in failed");
    else router.replace("/overview");
  }

  return (
    <div className="login-wrap">
      <div className="login">
        <div className="brand">
          <span className="wm">Preckon<span className="o">.</span></span>
          <span className="host-pill">TENANT</span>
        </div>
        <h1>Sign in to your workspace</h1>
        <p className="sub">The AI-native construction operating system.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {err && <div className="auth-err"><span>{err}</span></div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="restricted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          Demo tenant owner · owner@aigcc.group / preckon-tenant-2026
        </div>
      </div>
    </div>
  );
}
