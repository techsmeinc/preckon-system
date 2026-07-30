import { betterAuth } from "better-auth";
import { pool } from "./db";
import { email } from "./integrations";
import { MIN_PASSWORD_LENGTH } from "./constants";

/**
 * Host-only Better Auth instance (§1.1). Owns credentials/sessions for TechSME
 * staff. The staff profile (role, status) lives in `host_user`, linked by
 * host_user.auth_user_id = user.id. This is a *separate identity pool* from the
 * tenant plane (§0.2) — tenant users never appear here.
 */
export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // Trust the configured URL plus any localhost / 127.0.0.1 / private-LAN origin
  // during local dev, so signing in works whether you open the app at
  // localhost:3000, 127.0.0.1:3000, or http://<your-LAN-ip>:3000. The function
  // is sometimes invoked without a request, so guard for that.
  trustedOrigins: (request?: Request) => {
    const configured = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    // `http://app:3000` is the in-cluster origin the docker-compose `seed` service
    // uses to reach this app by service name — trust it so seed:owner's sign-up
    // isn't rejected as INVALID_ORIGIN. Browser logins still use localhost:3000.
    const base = [configured, "http://localhost:3000", "http://127.0.0.1:3000", "http://app:3000"];
    const origin = request?.headers?.get?.("origin") ?? "";
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|(?:192\.168|10|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+)(?::\d+)?$/.test(origin))
      return [...new Set([...base, origin])];
    return base;
  },
  emailAndPassword: {
    enabled: true,
    // Staff are invited, not self-signup — the console has no public register.
    autoSignIn: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    // "Forgot password" flow. Better Auth mints a one-time token and calls this
    // with a ready-made reset URL (see BETTER_AUTH_URL + the /reset-password page).
    // With no live EMAIL_API_KEY the send is mocked and the link is logged to the
    // server console (§9) — copy it from there in local dev.
    sendResetPassword: async ({ user, url }) => {
      await email.send({
        to: user.email,
        subject: "Reset your Preckon Host password",
        body:
          `A password reset was requested for your Preckon Host account.\n\n` +
          `Reset your password: ${url}\n\n` +
          `If you didn't request this, you can ignore this email. The link expires in 1 hour.`,
      });
      // Dev convenience only — never print reset tokens to production logs.
      if (process.env.NODE_ENV !== "production") {
        console.info(`[auth] password reset link for ${user.email}: ${url}`);
      }
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1h
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12h, mirrors security.session_max_hours default
    updateAge: 60 * 60,
  },
});

export type Auth = typeof auth;
