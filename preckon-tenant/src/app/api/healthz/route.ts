import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// §X.1 liveness/readiness — checks DB reachability. Unauthenticated, tenant-less.
export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
