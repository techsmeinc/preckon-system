# Construction Intelligence — Website Master Brief

**Purpose:** the single source of truth for designing and building the public marketing site. It replaces the earlier prompt. It locks one aesthetic, inherits our real brand, anchors positioning to actual competitors, defines a primary ICP and conversion path, and reconciles the module taxonomy — so the build can't drift into generic SaaS.

**Non-negotiable:** AIGCC does not appear anywhere on the public site (logos, pricing, partnership framing). Talks are ongoing; the site stands on its own.

---

## 1. The Big Idea — "The Line Becomes the Number"

Construction begins as lines on a drawing. Our platform turns lines into quantities, quantities into costs, costs into decisions. That transformation *is* the product, and it's the creative spine of the entire site.

One continuous **measured line** threads through the whole experience — it enters as a drawing stroke, picks up dimension ticks, becomes a row in a Bill of Quantities, resolves into a number, and lands as a procurement card. Every section is a station along that line. Scroll down the homepage and you are literally watching a drawing become an estimate.

Why this wins: it's blueprint-native (nobody else can credibly own it), it maps 1:1 to the product chain, and it gives us a visual grammar — dimension lines, leader lines, tick marks, callout bubbles — that reads as *technical precision* rather than decorative "AI startup." This is the through-line that makes the site feel like ours and not like a template.

**The site's whole homepage should be built to land one sentence:** *Turn a raw tender package into a costed, defensible BOQ in hours — not weeks.*

---

## 2. Aesthetic Lane (locked)

One lane, chosen deliberately for a conservative buyer (estimators, QS, EPC, government procurement):

**Stripe/Ramp light-first confidence + Linear-grade diagram precision + exactly ONE dark "intelligence" moment.**

- **Light-first**, because trust and legibility matter more to this buyer than dev-tool cool. Generous whitespace, restrained gradients, enterprise-credible.
- **Linear-grade precision** in every diagram and architecture visual — crisp, aligned, intentional. The diagrams are the proof of intelligence; they must be flawless.
- **One dark moment** — the AI/Intelligence section (and optionally a hero sub-state) where the blueprint goes to "night mode" and the knowledge graph glows teal. Restraint is the point: one dark room in a bright house.

Reference discipline: we are **not** "all nine" of the original references. We borrow Stripe's enterprise gradient restraint, Ramp's confident whitespace, and Linear's diagram craft. We explicitly reject the dark, dense dev-tool aesthetic as the dominant mode.

---

## 3. Brand Inheritance — what carries, what we modernize

**Carries from the decks (so an investor feels one company):**
- Deep navy + teal palette.
- The **icon-in-circle** motif — reused as the module/feature icon system and as nodes on the measured line.
- The end-to-end "document → BOQ → estimate → procurement" narrative.

**Deliberately modernized for web:**
- **Drop Bookman Old Style on the website.** It anchors the decks but reads dated against Stripe/Linear. The decks keep Bookman; the web moves to a modern type system (below). This is one intentional deck↔web divergence, not an accident.
- Replace the deck's flat icon fills with the lighter, line-based blueprint treatment.

---

## 4. Design System

### Color tokens
| Token | Hex | Role |
|---|---|---|
| `ink` (Blueprint Navy) | `#0B1B2B` | Primary text, dark surfaces, the "drawing ink" |
| `ink-deep` | `#06101C` | Dark-mode background ("blueprint night") |
| `teal` (Intelligence) | `#15C2A8` | Primary accent, the "intelligence" signal |
| `teal-press` | `#0FA593` | Hover/active accent |
| `teal-tint` | `#E8FAF6` | Soft accent surfaces, highlight wash |
| `slate-700` | `#334155` | Body text |
| `slate-500` | `#64748B` | Secondary text |
| `slate-400` | `#94A3B8` | Muted/labels |
| `paper` | `#FBFCFE` | Default page background (faint cool blueprint paper) |
| `surface` | `#FFFFFF` | Cards |
| `hairline` | `#E3E8EF` | Borders, dimension lines, grid |
| `signal` (Amber) | `#F5A524` | ONE highlight role only (live/new/key metric), <5% of any view |

**Signature gradient — "Intelligence Wash":** `#0B1B2B → #0E3A4A → #15C2A8`. Used sparingly: hero accent, the dark AI section, key CTA banners. Never as a full-page background.

### Typography
The mono is the secret weapon — it makes the site read as a *measurement/intelligence* product, not generic SaaS.
- **Display / headlines:** **General Sans** (SemiBold/Bold) — modern, characterful, premium grotesk.
- **Body / UI:** **Inter** — rock-solid, accessible, neutral.
- **Technical accent (signature):** **JetBrains Mono** — for *all* numbers, dimensions, BOQ rows, codes, data, and technical micro-labels. Every quantity and price on the site is set in mono. This is the typographic hook that ties to drawings and measurement.

Pattern: prose in Inter, headlines in General Sans, **anything that is a measured value renders in mono** (e.g. `4,820 m²`, `$1,240,500`, `BOQ-04.12`). That single rule gives the whole site its precision texture.

### Grid & layout
A subtle **blueprint grid** as the substrate — faint `hairline` ruling, dimension-line dividers between sections (with tick marks and leader callouts), generous margins. Rounded cards (16–20px radius), soft elevation, glassmorphism only on the dark AI section.

### Components (design-system scope)
Hero (with the transformation animation) · measured-line section divider · icon-in-circle feature card · module card (Logix) · interactive platform architecture diagram · animated workflow timeline · competitor comparison matrix · stat/metric block (mono) · trust/security strip · CTA banner (Intelligence Wash) · pricing tier card · demo-request form · footer. Built on shadcn/ui primitives, Lucide for utility icons, custom SVG for the blueprint motif and diagrams.

### Motion principles
Purposeful, never decorative. Scroll-triggered reveals that *advance the line*. Micro-interactions on hover (cards lift, dimension ticks animate in). Animated gradients only in the Intelligence Wash. Respect `prefers-reduced-motion` — the line snaps to its end state instead of animating. 60fps or it doesn't ship.

---

## 5. Positioning & Messaging

### The one sentence the homepage is built around
*Turn a raw tender package into a costed, defensible BOQ in hours — not weeks.*

### Competitor-anchored, not strawman
We do **not** compare against generic "document-storage software." We own the wedge we already mapped:

> **Document → BOQ → Estimate → Procurement, end to end — upstream of raw drawings.**

- Takeoff tools (Togal.AI, Kreo, Beam, Realx) stop at takeoff.
- CostX is powerful but manual-heavy.
- RDash sits *downstream* — it manages a BOQ you've already produced. "RDash starts where you finish."

None of them generates the full chain from raw documents in one system. That's the line the whole site defends.

The "Why Construction Intelligence" page carries two comparisons: (1) honest capability matrix vs the real AI-takeoff field, and (2) the "stores vs understands" frame vs legacy/PM tools.

### Copy principles
Confident, technical, specific, true. Say the slightly unsexy precise thing. **Banned:** "Build Faster. Estimate Smarter.", "revolutionize", "supercharge", "next-generation", empty "AI-powered" without an object.

Good headline patterns:
- *From drawings to a defensible estimate — with the reasoning shown.*
- *Every quantity traceable to the line it came from.*
- *Your senior estimator's judgment, applied to every bid.*
- *Hours, not weeks. Audited, not guessed.*

---

## 6. ICP & Conversion Strategy

### Primary ICP (the wedge)
**Preconstruction / estimating leaders at mid-to-large GCs and EPC contractors** — the person who owns bid throughput and feels the 2–6 week manual takeoff/estimate cycle most acutely. Everything above the fold speaks to them.

**Secondary:** independent QS consultancies; infrastructure developers. **Credibility tier (not primary):** government/enterprise — addressed via the Security & Trust page.

### Funnel & CTAs
- **Primary CTA (high intent):** **Book a Demo** — present everywhere, the single conversion goal.
- **Secondary CTA (pre-launch pipeline + social proof):** **Join the Design Partner Program** — converts the "we're early" reality into a feature, not a gap.
- **Tertiary (low intent / nurture):** **Watch the 90-second platform overview** + interactive product tour.

Objection handling is designed in, not bolted on: a "How accurate is it?" explainability answer, a "What about our data?" security answer, and a "We already have estimators" answer (we make them faster, we don't replace judgment — human review is a feature).

### Pre-launch social-proof strategy (on purpose)
No empty logo bars. Instead: a **Design Partner Program** section, founder/domain credibility, "built with practicing estimators and QS" framing, and the live transformation demo as the proof. When pilots land, they slot into a pre-designed slot.

---

## 7. Canonical Module Taxonomy (reconciled)

The platform is **Construction Intelligence** — six product modules + one copilot, each an intelligence layer:

| Module | Layer | Does |
|---|---|---|
| **TenderLogix** | Tender Intelligence | Reads tender packages, scope, contracts; extracts requirements & structure |
| **DrawLogix** | Drawing Intelligence | Interprets drawings (PDF/CAD), recognizes elements, measures |
| **DocLogix** | Specification Intelligence | Parses specs; ties spec clauses to elements and items |
| **QuantLogix** | Quantity Intelligence | Generates the BOQ / takeoff from drawings + specs |
| **CostLogix** | Cost Intelligence | Turns quantities into costed, defensible estimates |
| **ProcureLogix** | Procurement Intelligence | Produces procurement packages / RFQs from the estimate |
| **Construction Copilot** | Orchestration | Conversational layer across all six, with explainability + human review |

**✅ Locked.** TenderLogix is folded in as the **Tender Intelligence** module (the prior standalone product becomes the platform's tender layer). The canonical structure is **six modules + Construction Copilot**. The investor deck (currently five modules) should be reconciled up to match this six-module taxonomy.

---

## 8. Sitemap (tightened for a pre-launch enterprise SaaS)

Cut from 13 thin pages to a focused set. Build sequence noted.

1. **Home** — the showpiece; the full transformation story end to end. *(Build first.)*
2. **Platform** — interactive architecture; the seven intelligence layers and how they chain.
3. **Modules** — one page, deep anchors per Logix module (not six separate pages).
4. **How It Works** — the upload → analyze → review → generate flow, with human review surfaced.
5. **Why Construction Intelligence** — competitor matrix + "stores vs understands."
6. **Security & Trust** — *new, essential* (see §10).
7. **Pricing** — Starter / Professional / Enterprise + usage-based; Enterprise = "Talk to sales."
8. **About** — mission, vision, technology, roadmap, Design Partner Program, founder credibility.
9. **Book a Demo / Contact** — the conversion destination (demo, sales, support).

Industries becomes a *section* on Home + Platform, not a full page, until we have proof points per vertical.

---

## 9. Security & Trust (the missing essential)

The product ingests sensitive tender and design documents — for this buyer, security is a homepage-adjacent concern, not fine print. The page covers:
- **Data handling** — where documents live, encryption in transit/at rest, retention controls, and that customer documents are not used to train shared models.
- **Tenant isolation** — per-tenant separation (row-level security), so one client's data never touches another's.
- **Provider independence as a security story** — multiple AI providers, no lock-in, no single vendor seeing all data.
- **Human-in-the-loop** — every AI output is reviewable and traceable; nothing auto-commits.
- **Auditability** — immutable audit trail of who changed what.
- **Compliance trajectory** — SOC 2 path stated honestly (in progress, not claimed).

---

## 10. Signature Interactions

- **Hero — the transformation:** a real drawing fragment animates — strokes resolve into recognized elements, dimension ticks snap on, a BOQ row writes itself in mono, a cost number counts up, a procurement card slides in. Loops subtly; replays on scroll-in. This is the single most important asset on the site.
- **The measured line** as scroll guide — the dimension line connecting sections animates its ticks as you progress.
- **Interactive platform diagram** — hover a layer to light its node and show its I/O; click to expand.
- **Animated workflow timeline** on How It Works.
- **Count-up metrics** in mono. Glassmorphic knowledge-graph in the dark AI section. Premium skeleton loading states. Subtle, restrained particle field only in the Intelligence Wash.

All motion respects `prefers-reduced-motion`.

---

## 11. Tech Architecture

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion · shadcn/ui · Lucide · `next/font` for General Sans + Inter + JetBrains Mono · custom SVG for blueprint motif and diagrams. Light + dark mode (dark = "blueprint night"). SEO-optimized (per-page metadata, OG images using the brand system, structured data), fast (image optimization, route-level code splitting, target LCP < 2s), WCAG 2.1 AA (contrast checked against the tokens above, keyboard nav, reduced-motion, semantic landmarks). Matches the TenderLogix stack conventions so it's familiar to the team.

---

## 12. SEO / Metadata

Per-page title + description targeting the real searches this buyer makes (e.g. "AI BOQ generation," "automated quantity takeoff from drawings," "construction estimating automation"). Branded OG images generated from the design system. JSON-LD `SoftwareApplication` + `Organization`. One H1 per page carrying the page's specific promise.

---

## 13. Build Sequence (gated, one artifact at a time)

1. **Design system + tokens + core components** — colors, type, the blueprint motif, the measured-line divider, card system, button/CTA, in a single foundation file. *(Gate.)*
2. **Homepage** — the full showpiece, the one page that has to be world-class. *(Gate.)*
3. Then expand page by page in sitemap order, each gated on sign-off.

No one-shotting all nine pages — that guarantees shallow output. We make the foundation and the homepage genuinely excellent first, then scale the established system across the rest.

---

*All decisions locked. Module taxonomy resolved (§7): six modules + Construction Copilot, TenderLogix folded in as Tender Intelligence. Ready to build, starting with the design system.*
