import type { Config } from "tailwindcss";

// Self-contained design tokens (no shared preset). Mirrors the platform's HSL-channel
// token approach so the look is consistent, but this app owns its own palette.
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--color-background) / <alpha-value>)",
        foreground: "hsl(var(--color-foreground) / <alpha-value>)",
        card: "hsl(var(--color-card) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--color-primary) / <alpha-value>)",
          foreground: "hsl(var(--color-primary-foreground) / <alpha-value>)",
        },
        accent: { DEFAULT: "hsl(var(--color-accent) / <alpha-value>)" },
        success: { DEFAULT: "hsl(var(--color-success) / <alpha-value>)" },
        warning: { DEFAULT: "hsl(var(--color-warning) / <alpha-value>)" },
        muted: {
          DEFAULT: "hsl(var(--color-muted) / <alpha-value>)",
          foreground: "hsl(var(--color-muted-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--color-border) / <alpha-value>)",
        destructive: "hsl(var(--color-destructive) / <alpha-value>)",
      },
      borderRadius: { sm: "0.375rem", md: "0.625rem", lg: "0.875rem" },
    },
  },
} satisfies Config;
