// Shared, framework-agnostic constants safe to import from both server and
// client code (no server-only dependencies here).

// Minimum staff password length. Single source of truth: Better Auth enforces
// this server-side (auth.ts) and the reset-password UI mirrors it client-side.
export const MIN_PASSWORD_LENGTH = 12;
