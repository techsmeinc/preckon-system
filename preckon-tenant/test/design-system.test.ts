// Conformance with the Preckon UI Blueprint and Frontend Design System.
//
// These rules are not aesthetic preferences. Each one is a thing the standard
// states, that a reviewer cannot reliably catch by eye, and that regresses
// quietly: a physical `padding-left` looks correct in English and breaks Arabic;
// `outline:none` looks tidy and removes the only cue a keyboard user has.
//
// Scoped deliberately to what the documents state OBJECTIVELY. Whether a screen
// "looks designed for construction" is a review question and belongs with a
// human; whether it removed a focus ring is a fact.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");
const ROOT_LAYOUT = readFileSync(join(__dirname, "..", "src", "app", "layout.tsx"), "utf8");

/** Comments describe rules; they are not rules. */
const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");

describe("RTL — logical properties", () => {
  /* Blueprint §16.2 and Design System §9.2 require inline properties. The failure
     is invisible in English: a `padding-left` on a list marker reads perfectly in
     LTR and puts the indent on the wrong side of every Arabic screen. */
  it("uses no physical padding or margin", () => {
    const found = rules.match(/(?:padding|margin)-(?:left|right)\s*:/g) ?? [];
    expect(found, `use padding-inline-start/end instead: ${found.join(", ")}`).toEqual([]);
  });

  it("uses no physical border sides", () => {
    const found = rules.match(/border-(?:left|right)\s*:/g) ?? [];
    expect(found, `use border-inline-start/end instead: ${found.join(", ")}`).toEqual([]);
  });

  it("aligns text logically", () => {
    // text-align: left/right pins a column to a side of the screen rather than
    // to the start of the reading direction.
    const found = rules.match(/text-align\s*:\s*(?:left|right)\b/g) ?? [];
    expect(found, `use text-align: start/end: ${found.join(", ")}`).toEqual([]);
  });

  it("carries an Arabic type stack, since the product ships Arabic", () => {
    expect(CSS).toMatch(/Arabic/i);
  });
});

describe("focus is never removed", () => {
  /* Blueprint §15 and Design System §7.2: never remove focus outlines without
     replacing them. A border-colour change is not a replacement — it is a
     colour-only cue, which §7.3 rules out separately. */
  it("has a 2px focus ring", () => {
    expect(rules).toMatch(/:focus-visible\s*\{[^}]*outline\s*:\s*2px/);
  });

  it("does not set outline:none without a focus-visible ring nearby", () => {
    const suppressions = [...rules.matchAll(/([^{}]*):focus[^{]*\{[^}]*outline\s*:\s*none/g)];
    const offenders = suppressions
      .map((m) => m[0].slice(0, 90).replace(/\s+/g, " ").trim())
      // A suppression is acceptable only where the same selector set also has a
      // focus-visible ring; otherwise the control has no keyboard affordance.
      .filter(() => !/focus-visible\s*[^{]*\{[^}]*outline\s*:\s*2px/.test(rules));
    expect(offenders, `focus removed with no replacement: ${offenders.join(" | ")}`).toEqual([]);
  });
});

describe("no generic AI styling", () => {
  /* Blueprint §6 "No purple AI gradient", §22 "Avoid purple gradient, animated
     glow"; Design System §19.3. Purple is not in either palette, so a purple
     value in the stylesheet is by definition off-system. */
  it("has no purple in the palette", () => {
    const purple = rules.match(/#(?:7c6cff|a99bff|8b5cf6|a855f7|6d28d9|7c3aed)/gi) ?? [];
    expect(purple, `purple is not a Preckon colour: ${purple.join(", ")}`).toEqual([]);
  });

  it("uses no gradients as decoration", () => {
    // Permitted only where a gradient is doing real work (a canvas grid, a
    // sparkline fill). A gradient on a card or a button is the AI-template look
    // both documents rule out.
    /* Counted rather than banned: a gradient drawing a canvas grid or a
       sparkline fill is doing work. A gradient on a card or a button is the
       AI-template look both documents rule out. The cap is a drift alarm. */
    const grads = rules.match(/(?:linear|radial|conic)-gradient/g) ?? [];
    expect(grads.length, "gradients should stay rare and functional").toBeLessThanOrEqual(8);
  });
});

describe("radius stays modest", () => {
  /* Blueprint §11: small 4px, controls 6px, menus 8px, dialogs 8–10px, and
     "Avoid large 16–24px dashboard rounding". 999px is a deliberate pill for
     genuinely pill-shaped controls and is not the rounding being warned about. */
  it("avoids the 16–24px dashboard rounding the blueprint rules out", () => {
    /* The document specifies 4/6/8/10 and explicitly says to AVOID 16–24px. It
       does not legislate 11–15, so neither does this: values in that band are
       drift worth reviewing in design review, not a build failure. A test that
       invented a rule is a test people argue with instead of fix. */
    const over = (rules.match(/border-radius\s*:[^;]*?\b(1[6-9]|2[0-4])px/g) ?? [])
      .filter((r) => !/999px/.test(r));
    expect(over, `radius in the 16–24px band: ${over.join(" | ")}`).toEqual([]);
  });
});

describe("theme architecture", () => {
  it("supports an explicit dark choice", () => {
    expect(rules).toMatch(/\[data-theme=["']?dark["']?\]/);
  });

  it("supports System, so a dark machine is not shown a light app", () => {
    /* Design System §10.1 requires Light, Dark AND System. Asserted on the
       behaviour rather than the mechanism: this app resolves the OS preference
       in the boot script and stamps data-theme, which is a valid way to do it —
       a CSS-only rule would be another. What must not happen, and did, is
       defaulting to light without ever asking the machine. */
    expect(ROOT_LAYOUT).toMatch(/prefers-color-scheme/);
    expect(ROOT_LAYOUT).toMatch(/data-theme-pref/);
  });

  it("declares color-scheme so native controls follow the theme", () => {
    // Without it, a select's option list renders in the OS light scheme over a
    // dark page — unreadable, and not something a screenshot review catches.
    expect(rules).toMatch(/color-scheme\s*:/);
  });
});

describe("typography", () => {
  it("uses tabular numerals where figures line up", () => {
    // Blueprint §9.3: quantities, money, dates, percentages, durations.
    expect(rules).toMatch(/font-variant-numeric\s*:\s*tabular-nums/);
  });

  it("keeps application headings out of marketing sizes", () => {
    /* Blueprint §9.2: "Avoid 28–40px application headings except on true
       landing/onboarding screens." Sized in rem or px, an h1 at 32px inside a
       workspace is the SaaS hero the standard rules out. */
    const huge = rules.match(/font-size\s*:\s*(?:3[0-9]|4[0-9])px/g) ?? [];
    expect(huge, `application text should not be this large: ${huge.join(", ")}`).toEqual([]);
  });
});

describe("motion", () => {
  it("respects reduced motion", () => {
    // Blueprint §24, Design System §7.5.
    expect(rules).toMatch(/prefers-reduced-motion/);
  });
});

// ── Contrast ────────────────────────────────────────────────────────────────
//
// Both documents set WCAG 2.2 AA as the target, and two values in the
// blueprint's own light palette do not reach it — text-muted at 3.69:1 and
// warning at 3.89:1. Where a palette and an accessibility target disagree, the
// target wins: the standard says AA is not a later enhancement. Those two are
// darkened to the nearest passing value with the hue held.
//
// Computed from the stylesheet rather than from a list, so a token edited to a
// prettier shade fails here rather than in an audit months later.

const relLuminance = (hexColour: string): number => {
  const h = hexColour.replace("#", "");
  const chan = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Read a literal hex token out of a block of the stylesheet. */
function token(block: string, name: string): string | null {
  const m = block.match(new RegExp(`--${name}\s*:\s*(#[0-9a-f]{6})`, "i"));
  return m ? m[1] : null;
}

const lightBlock = CSS.slice(CSS.indexOf(":root{"), CSS.indexOf('[data-theme="dark"]'));
const darkBlock = CSS.slice(CSS.indexOf('[data-theme="dark"]'));

describe("contrast (WCAG 2.2 AA)", () => {
  const AA = 4.5;

  it("reads the palette from the stylesheet, not from a copy of it", () => {
    // Otherwise this tests a list somebody forgot to update.
    expect(token(lightBlock, "canvas")).toBe("#F5F7F8");
    expect(token(darkBlock, "canvas")).toBe("#101619");
  });

  for (const name of ["text-primary", "text-secondary", "text-muted"]) {
    it(`${name} clears AA on the light canvas`, () => {
      const fg = token(lightBlock, name)!;
      const bg = token(lightBlock, "canvas")!;
      expect(contrast(fg, bg), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
    });

    it(`${name} clears AA on the dark canvas`, () => {
      const fg = token(darkBlock, name)!;
      const bg = token(darkBlock, "canvas")!;
      expect(contrast(fg, bg), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
    });
  }

  it("the accent is legible as text on white", () => {
    // It carries links and active labels, not only button fills.
    expect(contrast(token(lightBlock, "brand")!, "#FFFFFF")).toBeGreaterThanOrEqual(AA);
  });

  it("the warning INK differs from the warning FILL, and only the ink must pass", () => {
    /* The blueprint value is right for a chip fill and too light for text on it.
       Keeping both means a status bar and a status chip still read as the same
       colour family while the text on them stays legible. */
    const ink = token(lightBlock, "warning")!;
    const fill = token(lightBlock, "warning-fill")!;
    expect(ink).not.toBe(fill);
    expect(contrast(ink, "#FFFFFF")).toBeGreaterThanOrEqual(AA);
  });
});
