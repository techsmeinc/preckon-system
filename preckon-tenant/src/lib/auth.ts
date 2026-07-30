import { betterAuth } from "better-auth";
import { pool } from "./db";
import { email } from "./integrations";
import { MIN_PASSWORD_LENGTH } from "./constants";

/**
 * Tenant-plane Better Auth instance (§1.1). Owns credentials/sessions for tenant
 * users. The authorization profile (tenant, roles, status) lives in `app_user`,
 * linked by app_user.auth_user_id = user.id. Separate identity pool from the Host.
 */
export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
  trustedOrigins: (request?: Request) => {
    const configured = process.env.BETTER_AUTH_URL ?? "http://localhost:3100";
    const base = [configured, "http://localhost:3100", "http://127.0.0.1:3100"];
    const origin = request?.headers?.get?.("origin") ?? "";
    if (
      origin &&
      /^https?:\/\/(localhost|127\.0\.0\.1|(?:192\.168|10|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+)(?::\d+)?$/.test(
        origin
      )
    )
      return [...new Set([...base, origin])];
    return base;
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      await email.send({
        to: user.email,
        subject: "Reset your Preckon password",
        body: `Reset your password: ${url}\n\nIf you didn't request this, ignore this email.`,
      });
      if (process.env.NODE_ENV !== "production") {
        console.info(`[auth] password reset link for ${user.email}: ${url}`);
      }
    },
    resetPasswordTokenExpiresIn: 60 * 60,
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
  },
});

export type Auth = typeof auth;
