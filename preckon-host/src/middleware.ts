import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Edge auth guard for the console. This is an OPTIMISTIC check — it only looks
// for the presence of the Better Auth session cookie so unauthenticated requests
// are bounced at the edge (no flash of the authed shell, no console HTML served
// to anonymous users). The real authorization boundary is still getAuthContext()
// on every API route (§0.5); this does not replace it.

// Public routes that must render without a session.
const PUBLIC = new Set(["/", "/forgot-password", "/reset-password"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never touch auth endpoints, Next internals, or public auth pages.
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    PUBLIC.has(pathname)
  ) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    // Preserve where they were headed so we can bounce back after login later.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on everything except static assets and files with an extension.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
