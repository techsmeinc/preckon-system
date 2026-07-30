import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth serves login/logout/session/etc under /api/auth/*.
export const { GET, POST } = toNextJsHandler(auth);
