// Logo.tsx — Preckon brand mark & lockup
// -----------------------------------------------------------------------------
// Drop into your components directory. The wordmark expects the General Sans
// font to be loaded (e.g. via next/font) and exposed as the CSS variable
// --font-display; a system fallback is included if it isn't.
//
// Design rule: teal lives on the reckoning point ONLY — the node and the "o".
// Everything else uses currentColor, so the logo adapts to light/dark simply
// by setting the surrounding text color.
// -----------------------------------------------------------------------------

import * as React from "react";

/** Intelligence teal — the reckoning-point accent. */
export const PRECKON_TEAL = "#15C2A8";

export interface PreckonMarkProps extends React.SVGProps<SVGSVGElement> {
  /** Rendered width in px. Height scales to keep the 48:56 aspect ratio. */
  size?: number;
  /** Node color. Defaults to intelligence teal. */
  accent?: string;
}

/**
 * The Set-Out P. The stem uses `currentColor`, so it inherits the surrounding
 * text color (navy on light surfaces, paper on dark). Only the reckoning node
 * carries the accent.
 *
 * @example
 * <span style={{ color: "#0B1B2B" }}><PreckonMark size={40} /></span>   // light
 * <span style={{ color: "#FBFCFE" }}><PreckonMark size={40} /></span>   // dark
 */
export function PreckonMark({ size = 32, accent = PRECKON_TEAL, ...props }: PreckonMarkProps) {
  return (
    <svg
      width={size}
      height={(size * 56) / 48}
      viewBox="0 0 48 56"
      fill="none"
      role="img"
      aria-label="Preckon"
      {...props}
    >
      <path
        d="M16 50V8h14a13 13 0 0 1 0 26H16"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={25} cy={21} r={3.6} fill={accent} />
    </svg>
  );
}

export interface PreckonLogoProps {
  /** Wordmark font-size in px; the mark scales with it. */
  size?: number;
  /** Accent for the node and the "o". Defaults to intelligence teal. */
  accent?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Horizontal lockup: Set-Out P + wordmark. The mark stem and every letter
 * except the "o" use `currentColor`, so the whole logo flips for light/dark by
 * setting the text color on a parent. Teal stays fixed on the node and the "o".
 *
 * @example
 * <header style={{ color: "#0B1B2B" }}><PreckonLogo size={22} /></header>
 */
export function PreckonLogo({ size = 24, accent = PRECKON_TEAL, className, style }: PreckonLogoProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.42,
        lineHeight: 1,
        color: "currentColor",
        ...style,
      }}
    >
      <PreckonMark size={size * 1.18} accent={accent} />
      <span
        style={{
          fontFamily: "var(--font-display, 'General Sans', Inter, system-ui, sans-serif)",
          fontWeight: 600,
          fontSize: size,
          letterSpacing: "-0.03em",
        }}
      >
        Preck<span style={{ color: accent }}>o</span>n
      </span>
    </span>
  );
}

export default PreckonLogo;
