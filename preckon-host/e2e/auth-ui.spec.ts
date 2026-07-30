import { test, expect } from "@playwright/test";

// These tests cover the login/recovery UI added in this change: the password
// show/hide toggle, the "Forgot password?" link, and the reset-password screen.
// They render client-side only, so no database is required.

test.describe("Login page", () => {
  test("renders the host sign-in form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Sign in to the Host Console/i })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.locator("#pw")).toBeVisible();
    // Email must not be pre-filled with a dev credential.
    await expect(page.getByLabel("Work email")).toHaveValue("");
  });

  test("the SSO button is disabled until real SSO is wired (no fake door)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /continue with sso/i })).toBeDisabled();
  });

  test("password is hidden by default and the eye toggle reveals it", async ({ page }) => {
    await page.goto("/");
    const pw = page.locator("#pw");
    await pw.fill("SuperSecret123");

    // Starts masked.
    await expect(pw).toHaveAttribute("type", "password");

    const toggle = page.getByRole("button", { name: /show password/i });
    await expect(toggle).toBeVisible();

    // Reveal.
    await toggle.click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: /hide password/i })).toBeVisible();

    // Hide again.
    await page.getByRole("button", { name: /hide password/i }).click();
    await expect(pw).toHaveAttribute("type", "password");
  });

  test("the forgot-password link navigates to the recovery page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /forgot password\?/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { name: /Forgot your password\?/i })).toBeVisible();
  });
});

test.describe("Forgot password page", () => {
  test("send button is disabled until an email is entered", async ({ page }) => {
    await page.goto("/forgot-password");
    const send = page.getByRole("button", { name: /send reset link/i });
    await expect(send).toBeDisabled();
    await page.getByLabel("Work email").fill("admin@techsme.com");
    await expect(send).toBeEnabled();
  });

  test("can navigate back to sign in", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("link", { name: /back to sign in/i }).click();
    await expect(page).toHaveURL(/\/$|\/$/);
    await expect(page.getByRole("heading", { name: /Sign in to the Host Console/i })).toBeVisible();
  });
});

test.describe("Reset password page", () => {
  test("shows an expired-link state when no token is present", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /Link expired/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /request a new link/i })).toBeVisible();
  });

  test("shows an expired-link state when the token is rejected", async ({ page }) => {
    await page.goto("/reset-password?error=INVALID_TOKEN");
    await expect(page.getByRole("heading", { name: /Link expired/i })).toBeVisible();
  });

  test("with a token, shows the new-password form and validates length + match", async ({ page }) => {
    await page.goto("/reset-password?token=dummy-token-for-ui-test");
    await expect(page.getByRole("heading", { name: /Set a new password/i })).toBeVisible();

    const update = page.getByRole("button", { name: /update password/i });
    await expect(update).toBeDisabled();

    // Too short → inline error, no submission.
    await page.locator("#pw").fill("short");
    await page.locator("#pw2").fill("short");
    await update.click();
    await expect(page.getByText(/Password must be at least 12 characters/i)).toBeVisible();

    // Long enough but mismatched → mismatch error.
    await page.locator("#pw").fill("LongEnoughPassword1");
    await page.locator("#pw2").fill("DifferentPassword1");
    await update.click();
    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
  });

  test("password toggle works on the reset form", async ({ page }) => {
    await page.goto("/reset-password?token=dummy-token-for-ui-test");
    const pw = page.locator("#pw");
    await pw.fill("LongEnoughPassword1");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show password/i }).first().click();
    await expect(pw).toHaveAttribute("type", "text");
  });
});
