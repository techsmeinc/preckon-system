"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

// Entry: route to the workspace when signed in, else to sign-in.
export default function Home() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  useEffect(() => {
    if (isPending) return;
    router.replace(session?.user ? "/overview" : "/login");
  }, [isPending, session, router]);
  return (
    <div className="login-wrap"><div className="row" style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="spin" /> Loading…</div></div>
  );
}
