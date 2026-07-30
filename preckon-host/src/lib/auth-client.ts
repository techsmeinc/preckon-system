"use client";
import { createAuthClient } from "better-auth/react";

// Client-side Better Auth (login/logout/session in the console UI).
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined" ? window.location.origin : process.env.BETTER_AUTH_URL,
});

export const { signIn, signOut, useSession, requestPasswordReset, resetPassword } =
  authClient;
