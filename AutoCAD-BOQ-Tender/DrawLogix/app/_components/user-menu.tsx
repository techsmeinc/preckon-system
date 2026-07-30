"use client";

import { roleLabel } from "@/auth/roles";
import { logoutAction } from "@/server/auth-actions";

/** Small header widget: who's signed in + their role + a sign-out button. */
export function UserMenu({ name, role, dark }: { name: string; role: string; dark?: boolean }) {
  const chip = dark ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" : "border-border bg-card text-foreground hover:bg-muted";
  const sub = dark ? "text-slate-400" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-xs font-semibold">{name}</p>
        <p className={`text-[10px] ${sub}`}>{roleLabel(role)}</p>
      </div>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${dark ? "bg-indigo-500/30 text-indigo-200" : "bg-primary/10 text-primary"}`}>
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
      <form action={logoutAction}>
        <button type="submit" className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${chip}`} title="Sign out">
          Sign out
        </button>
      </form>
    </div>
  );
}
