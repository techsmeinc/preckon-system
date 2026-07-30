# End-to-end tests (Playwright)

Automated browser tests for the Host Console, driven by [Playwright](https://playwright.dev).

## Run

```bash
npm run test:e2e          # headless run (starts `next dev` automatically)
npm run test:e2e:ui       # interactive UI mode
npm run test:e2e:report   # open the last HTML report
```

Playwright boots the Next.js dev server on port **3100** (override with `E2E_PORT`)
via the `webServer` block in `playwright.config.ts`, so you don't need a server
running beforehand. If one is already up on that port it is reused.

First-time setup installs the browser binary:

```bash
npx playwright install chromium
```

## What's covered

`auth-ui.spec.ts` — the login/recovery UI, which renders client-side only and
therefore needs **no database**:

- Login form renders; password is masked and the eye toggle reveals/hides it.
- "Forgot password?" link routes to `/forgot-password`.
- Forgot-password form gates the submit button on a valid email.
- `/reset-password` shows an "expired link" state with no/invalid token, and the
  new-password form with a token (client-side length + match validation).

## Adding DB-backed flows

Full sign-in and end-to-end reset (which hit MySQL + Better Auth) require a
running database and a seeded staff user (`npm run seed:owner`). Put those tests
behind a `@db` tag and run them with `npx playwright test --grep @db` once your
DB is up. In dev, the reset **link is logged to the server console** (email is
mocked unless `EMAIL_API_KEY` is set) — grab it from there to complete the flow.
