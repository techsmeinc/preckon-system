"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL ?? undefined,
});

export const { signIn, signOut, signUp, useSession } = authClient;
