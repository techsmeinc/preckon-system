# Preckon Frontend Design System v1.0

**Status:** Engineering & Product Design Standard  
**Applies to:** Preckon Core, Tender, Draw, Quantity, Cost, Schedule, Documents, Field, Quality/Safety, Financials, Integration Hub, Enterprise Intelligence  
**Primary channels:** Responsive web application and desktop-class web/desktop shell  
**Initial locales:** English (`en`) and Arabic (`ar`)  
**Accessibility target:** WCAG 2.2 AA  
**Themes:** Light, Dark, System  
**Direction:** LTR and RTL

---

## 1. Purpose

Preckon must look and behave like a mature construction operating system, not a generic SaaS dashboard and not an AI-generated collection of cards.

The interface should communicate:

- engineering seriousness;
- construction-domain depth;
- speed and precision;
- high information density without clutter;
- confidence for enterprise customers;
- simplicity for small and mid-market contractors;
- contextual AI rather than chatbot-first AI;
- accessibility, responsiveness, internationalization and RTL readiness by default.

The product should remain comfortable for a user who works in Preckon for eight hours a day.

---

# 2. Non-Negotiable Design Principles

## 2.1 Professional, not generic

Every screen must have a clear operational purpose.

Avoid default AI/SaaS aesthetics:

- excessive rounded cards;
- decorative gradients;
- purple or neon "AI" treatments;
- glassmorphism;
- oversized hero-style page headings inside the application;
- giant empty areas used only to make a screenshot look clean;
- repetitive icon + heading + subtitle cards;
- one-card-per-metric dashboards;
- unnecessary floating pills;
- excessive shadows;
- gratuitous animation;
- decorative charts with no decision value;
- consumer-app styling;
- fake "premium" styling that reduces information density.

Use instead:

- typography;
- disciplined spacing;
- separators;
- alignment;
- data hierarchy;
- modest radius;
- restrained elevation;
- contextual controls;
- persistent work surfaces;
- meaningful status semantics.

## 2.2 Information first

The interface exists to help users understand and act on:

- drawings;
- tender packages;
- BOQs;
- quantities;
- cost;
- schedules;
- RFIs;
- submittals;
- changes;
- documents;
- site observations;
- quality and safety;
- commercial and financial data;
- cross-project intelligence.

Do not hide important operational information behind decorative layers.

## 2.3 One product, many workspaces

All Preckon modules must share:

- one application shell;
- one token system;
- one navigation grammar;
- one form system;
- one table system;
- one status language;
- one AI interaction model;
- one accessibility standard;
- one responsive strategy;
- one internationalization strategy.

Modules may have specialized workspaces, but they must not feel like unrelated applications.

## 2.4 Design before implementation

Claude or any developer must not invent a new UI pattern while coding if an existing Preckon pattern can solve the problem.

Required order:

1. understand user and task;
2. identify existing Preckon pattern;
3. define information hierarchy;
4. define interaction;
5. validate responsive / RTL / theme / accessibility implications;
6. implement;
7. test all required states.

---

# 3. Product UX Character

## 3.1 Design personality

Preckon should feel:

- precise;
- calm;
- capable;
- technical;
- premium but not luxurious;
- modern but not fashionable;
- dense but not crowded;
- intelligent but not theatrical;
- consistent;
- trustworthy.

## 3.2 Construction vernacular

Where useful, derive interface language from real construction work:

- sheet numbers;
- drawing revisions;
- grid references;
- packages;
- disciplines;
- work breakdown structures;
- cost codes;
- quantities;
- units;
- RFIs;
- submittals;
- approval states;
- schedule activities;
- procurement packages;
- change events;
- site observations.

Do not imitate visual clichés such as blueprint backgrounds, hazard stripes or fake drafting-paper textures unless a specific functional reason exists.

---

# 4. Core Application Architecture

## 4.1 Global shell

Recommended desktop composition:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Global Command Bar                                                     │
│ Project switcher | Search | Ask Preckon | Alerts | Help | User         │
├──────────────┬──────────────────────────────────────────────┬───────────┤
│ Module Nav   │ Context Header                               │ Context / │
│              ├──────────────────────────────────────────────┤ AI Panel  │
│ Overview     │                                              │ optional  │
│ Tender       │ Main Work Surface                            │           │
│ Draw         │                                              │           │
│ Quantity     │                                              │           │
│ Cost         │                                              │           │
│ Schedule     │                                              │           │
│ Documents    │                                              │           │
│ Field        │                                              │           │
│ ...          │                                              │           │
└──────────────┴──────────────────────────────────────────────┴───────────┘
```

### Global command bar

Purpose:

- project/company context;
- global search;
- command palette;
- Ask Preckon;
- alerts;
- help;
- user preferences.

Avoid placing module-specific actions in the global bar.

### Module navigation

- compact;
- persistent on desktop;
- collapsible;
- icon + label when expanded;
- icon with accessible tooltip when collapsed;
- active state obvious without relying only on color;
- RTL-aware.

### Context header

Contains only information and actions relevant to the current workspace:

- title;
- breadcrumb or path;
- status;
- primary action;
- secondary actions;
- view controls;
- version/revision when relevant.

Do not make every context header oversized.

---

# 5. Standard Workspace Types

Preckon should use a limited number of repeatable workspace types.

## 5.1 Command Center

For:

- project overview;
- portfolio overview;
- executive intelligence;
- operational priorities.

Characteristics:

- decision-oriented;
- concise;
- combines exceptions, progress, cost, schedule and risks;
- does not become a grid of dozens of cards;
- AI highlights explain *why* something matters.

## 5.2 Data Workspace

For:

- BOQ;
- cost;
- procurement;
- tender registers;
- RFI registers;
- submittals;
- schedules;
- financial ledgers.

Characteristics:

- table/grid is primary;
- filters and saved views;
- bulk actions;
- side inspector;
- keyboard-friendly;
- compact density.

## 5.3 Drawing Workspace

For:

- Draw;
- drawing review;
- takeoff;
- markups;
- issue detection;
- compare versions.

Characteristics:

- technical canvas dominates;
- controls stay compact;
- tool palettes are contextual;
- properties/AI/issue panel can resize;
- drawing geometry is never mirrored for RTL.

## 5.4 Document Workspace

For:

- specifications;
- contracts;
- tender documents;
- submittals;
- document review.

Characteristics:

- document viewer + metadata + extracted intelligence;
- split view;
- source-linked AI citations;
- version/revision control.

## 5.5 Planning Workspace

For:

- schedule;
- look-ahead;
- resources;
- dependencies.

Characteristics:

- grid + timeline/Gantt;
- synchronized scrolling;
- dense controls;
- risks visible inline.

## 5.6 Configuration Workspace

For:

- company settings;
- project settings;
- templates;
- permissions;
- integrations.

Characteristics:

- simple;
- predictable;
- form-first;
- avoids dashboard styling.

---

# 6. Responsive Strategy

Responsive design means adapting workflows, not shrinking desktop screens.

## 6.1 Large desktop — 1440px+

Use:

- expanded module navigation;
- multi-pane workspaces;
- persistent context panel where useful;
- full data-grid capabilities;
- larger drawing/document work surface.

## 6.2 Laptop — 1024–1439px

Use:

- collapsible navigation;
- optional overlay context panel;
- resizable split views;
- compact toolbar;
- preserved table density.

## 6.3 Tablet — 768–1023px

Use:

- one dominant work surface;
- secondary panels as drawers/sheets;
- touch-capable controls;
- simplified column sets;
- explicit view switching instead of cramped splits.

## 6.4 Mobile — below 768px

Mobile is primarily for:

- field workflows;
- approvals;
- issue capture;
- site photos;
- RFIs;
- tasks;
- document lookup;
- notifications;
- quick status updates;
- Ask Preckon.

Do not attempt to reproduce a 30-column BOQ or full CAD workspace on a phone.

Provide focused mobile tasks instead.

## 6.5 Breakpoint rule

Breakpoints are implementation aids, not the design goal.

Components should also use available-space behavior such as container queries where supported by the chosen stack.

---

# 7. Accessibility Standard

All production UI must target WCAG 2.2 AA.

## 7.1 Mandatory behavior

Every interactive component must provide:

- keyboard operation;
- visible focus state;
- semantic HTML;
- accessible name;
- correct role/state/value;
- logical tab order;
- sufficient contrast;
- non-color status cues;
- screen-reader-compatible feedback;
- reduced motion behavior;
- zoom and reflow support;
- validation association;
- accessible empty, loading and error states.

## 7.2 Focus

Never remove focus outlines without replacing them.

Focus treatment must be:

- visible in light theme;
- visible in dark theme;
- visible over selected states;
- visually distinct from hover.

## 7.3 Color

Never encode meaning only by color.

Example:

Bad:

- red dot = late;
- green dot = complete.

Good:

- icon;
- text;
- status name;
- color reinforcement.

## 7.4 Touch

Touch-capable screens should provide approximately 44x44 CSS pixel target areas where practical, especially for primary interactive controls.

Dense desktop grids may use smaller visible controls if the clickable target remains usable and keyboard access is excellent.

## 7.5 Motion

Respect `prefers-reduced-motion`.

Animation must:

- explain change;
- reinforce hierarchy;
- show cause/effect;
- never block work;
- never exist only to feel "AI".

## 7.6 Forms

Errors must:

- be attached to the affected field;
- explain how to fix the problem;
- not rely on color alone;
- be announced where appropriate;
- preserve entered values.

## 7.7 Data grids

Grid accessibility must cover:

- header semantics;
- row/column navigation;
- sorting state;
- selection state;
- keyboard operation;
- row actions;
- editable-cell behavior;
- virtualized content where used.

---

# 8. Internationalization

## 8.1 Initial locales

- English — `en`
- Arabic — `ar`

Architecture must support future languages without redesign.

Potential future locales may include languages used in India, GCC markets and international client organizations.

## 8.2 No hard-coded UI text

All user-facing strings must come from localization resources, including:

- labels;
- validation;
- tooltips;
- statuses;
- dialogs;
- menus;
- table headers;
- notifications;
- empty states;
- accessibility labels.

## 8.3 Text expansion

Design for at least 30–40% expansion in common UI labels.

Do not size controls to a single English phrase.

## 8.4 Locale formatting

Use locale-aware formatting for:

- dates;
- times;
- currency;
- decimals;
- percentages;
- units;
- list formatting.

Project-defined commercial conventions may override locale defaults where required by contract or reporting standard.

---

# 9. RTL Architecture

## 9.1 Direction is application state

English normally uses:

```html
<html lang="en" dir="ltr">
```

Arabic normally uses:

```html
<html lang="ar" dir="rtl">
```

Direction must propagate from the root.

## 9.2 Logical properties

Do not build components with direction-specific assumptions.

Prefer:

- `margin-inline-start`;
- `margin-inline-end`;
- `padding-inline-start`;
- `padding-inline-end`;
- `border-inline-start`;
- `border-inline-end`;
- `inset-inline-start`;
- `inset-inline-end`;
- `text-align: start`;
- `text-align: end`.

Avoid hard-coded `left` and `right` unless the geometry itself is truly physical rather than linguistic.

## 9.3 Directional icons

Mirror only icons whose meaning is directional:

- previous/next;
- forward/back;
- collapse/expand from an edge.

Do not mirror:

- save;
- search;
- upload/download;
- building symbols;
- technical geometry;
- status icons.

## 9.4 Technical-content exception

Never automatically mirror:

- CAD;
- BIM;
- floor plans;
- PDF pages;
- site photos;
- engineering diagrams;
- coordinate systems;
- source document geometry.

The application chrome may become RTL while the technical artifact remains faithful to source orientation.

## 9.5 Mixed bidi content

Construction data frequently mixes scripts.

Examples:

- Arabic project name + `RFI-00452`;
- Arabic description + `DWG-A-102`;
- Arabic BOQ item + English specification;
- AED amount + English cost code.

Identifiers must remain stable.

Use appropriate bidi isolation for dynamic values and technical identifiers. Do not force the entire value into the surrounding paragraph direction.

---

# 10. Theme Architecture

## 10.1 Required themes

- Light;
- Dark;
- System.

Theme preference persists per user.

Organization defaults may exist, but should not require duplicate components.

## 10.2 Semantic tokens only

Components must consume semantic tokens.

Example:

```css
:root {
  --bg-canvas: ...;
  --bg-surface: ...;
  --bg-subtle: ...;
  --bg-elevated: ...;

  --text-primary: ...;
  --text-secondary: ...;
  --text-muted: ...;
  --text-inverse: ...;

  --border-default: ...;
  --border-strong: ...;

  --action-primary: ...;
  --action-primary-hover: ...;
  --focus-ring: ...;

  --status-success-bg: ...;
  --status-success-fg: ...;
  --status-warning-bg: ...;
  --status-warning-fg: ...;
  --status-critical-bg: ...;
  --status-critical-fg: ...;
  --status-info-bg: ...;
  --status-info-fg: ...;
}
```

Never embed raw theme colors repeatedly inside components.

## 10.3 Light theme philosophy

Optimized for:

- office work;
- BOQ review;
- tender preparation;
- forms;
- cost;
- reports;
- printing.

Use a calm neutral canvas and strong text hierarchy.

Avoid pure white everywhere.

## 10.4 Dark theme philosophy

Optimized for:

- extended desktop use;
- drawing review;
- document review;
- command centers;
- control-room scenarios.

Dark mode is not an inverted light mode.

Maintain:

- readable separators;
- clear elevation;
- non-glowing status colors;
- comfortable contrast.

---

# 11. Typography

## 11.1 Typography goals

Typography must communicate:

- precision;
- hierarchy;
- engineering credibility;
- readability at dense sizes.

## 11.2 Recommended starting stack

Subject to final brand approval:

**Latin / UI:** IBM Plex Sans or an equivalent professional grotesk  
**Arabic / UI:** IBM Plex Sans Arabic or a carefully matched Arabic family  
**Technical / identifiers:** IBM Plex Mono or equivalent

The final production family must be properly licensed and tested across target browsers and operating systems.

## 11.3 Numeric data

Use tabular numerals where appropriate for:

- quantities;
- money;
- percentages;
- dates;
- durations;
- progress;
- cost variance.

## 11.4 Type hierarchy

Avoid an excessive number of font sizes.

Recommended semantic roles:

- page title;
- section title;
- panel title;
- body;
- secondary;
- label;
- caption;
- data;
- technical identifier.

Page titles should be strong but not marketing-sized.

---

# 12. Spacing and Density

Use a consistent spacing scale.

Recommended base:

```text
2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
```

Most application layouts should primarily use:

- 4;
- 8;
- 12;
- 16;
- 24.

Avoid arbitrary spacing.

## 12.1 Density modes

Support:

- Comfortable;
- Compact.

Compact mode is particularly important for:

- BOQ;
- cost;
- tender registers;
- schedule;
- RFI/submittal registers;
- commercial data.

Density preference should not affect accessibility semantics.

---

# 13. Radius, Borders and Elevation

## Radius

Use modest rounding.

Recommended design intent:

- small controls: 4–6px;
- menus/panels: 6–8px;
- dialogs: 8–10px;
- avoid 16–24px "AI card" rounding across the application.

## Borders

Borders are the primary grouping mechanism for dense workspaces.

Use:

- subtle 1px separators;
- stronger selected/active boundaries;
- section dividers.

## Shadows

Reserve shadows for:

- dialogs;
- popovers;
- menus;
- drag states;
- temporary floating layers.

Do not shadow every panel.

---

# 14. Icons

Icons must:

- be from a coherent system;
- use consistent stroke/fill behavior;
- not be decorative filler;
- have accessible labels where needed;
- remain understandable in RTL.

Prefer domain-specific labels where an icon alone may be ambiguous.

Avoid inventing unusual icons for common actions.

---

# 15. Buttons and Actions

## Hierarchy

At most one obvious primary action per local context unless workflow genuinely requires otherwise.

Use:

- Primary;
- Secondary;
- Tertiary/ghost;
- Destructive.

Do not create five visually equal actions.

## Labels

Prefer task language:

- `Issue RFI`
- `Create Revision`
- `Approve`
- `Compare`
- `Generate BOQ`
- `Publish`

Avoid vague labels:

- `Continue`
- `Go`
- `Process`

when a specific action is known.

---

# 16. Forms

Forms must support:

- labels always visible;
- descriptions where useful;
- units;
- validation;
- keyboard completion;
- sensible field grouping;
- RTL;
- long translated labels;
- light/dark;
- read-only states;
- permission states.

Do not use placeholder text as the only label.

Use inline help only where users genuinely need guidance.

---

# 17. Data Tables and Grids

Tables are a first-class Preckon interface, not a fallback.

Every major data grid should consider:

- sticky header;
- frozen key columns;
- resizing;
- reordering;
- sorting;
- filtering;
- saved views;
- quick search;
- row grouping;
- hierarchy/tree rows;
- bulk selection;
- bulk actions;
- inline editing;
- inspector/detail panel;
- keyboard navigation;
- export;
- permission-sensitive actions;
- density modes.

## 17.1 Numeric alignment

Numbers, amounts and quantities should remain predictable in LTR and RTL.

Do not blindly mirror numeric alignment.

## 17.2 Important cells

Use:

- typography;
- alignment;
- subtle emphasis;
- badges only when status semantics require them.

Avoid turning every cell into a pill.

## 17.3 Empty space

A business grid with 10 rows should not become a giant decorative container just to fill the viewport.

Allow data workspaces to feel data-oriented.

---

# 18. Status Language

Define shared semantic categories:

- Neutral;
- Info;
- Success;
- Warning;
- Critical.

Then define domain statuses that map onto them.

Example:

```text
Tender:
Draft / In Review / Submitted / Awarded / Lost

Drawing:
Draft / Review / Approved with Comments / Approved / Superseded

RFI:
Open / Awaiting Response / Responded / Closed / Overdue

Schedule:
On Track / At Risk / Delayed / Critical

Cost:
Within Budget / Watch / Variance / Critical Variance
```

Status styles must combine text, icon/shape and color where relevant.

---

# 19. AI Interaction Model

Preckon AI should feel like product intelligence, not an attached chatbot.

## 19.1 AI surfaces

Use:

1. **Global Ask Preckon**
   - cross-project or cross-module questions;
   - command-palette-like entry;
   - full AI workspace when needed.

2. **Contextual Intelligence Panel**
   - current drawing/document/tender/schedule/BOQ;
   - insights grounded in visible context.

3. **Inline Intelligence**
   - risk indicator;
   - suggested mapping;
   - anomaly;
   - missing information;
   - likely schedule/cost impact.

4. **AI Actions**
   - summarize;
   - compare;
   - extract;
   - classify;
   - draft;
   - quantify;
   - explain;
   - trace source.

## 19.2 AI trust

Where AI influences business decisions, show:

- source;
- confidence or uncertainty when meaningful;
- reasoning summary at a user-appropriate level;
- affected records;
- suggested action;
- human confirmation before irreversible actions.

## 19.3 AI visual language

AI does not need:

- purple gradients;
- sparkle icons everywhere;
- glowing borders;
- animated blobs.

Use the Preckon visual system.

AI is a capability, not a visual theme.

---

# 20. Project Command Center Pattern

Purpose: show what requires attention now.

Recommended content:

- overall project health;
- major schedule deviation;
- cost exposure;
- procurement risk;
- tender/commercial events;
- safety/quality exceptions;
- recent approvals;
- AI-generated priorities.

Avoid:

```text
12 unrelated KPI cards
+ 6 decorative charts
+ huge welcome message
```

Prefer:

```text
Project Health Summary
─────────────────────────────────────────
Critical priorities / decisions

Schedule                 Cost
milestone variance       forecast / exposure

Progress / Procurement   Quality / Safety
meaningful exceptions    meaningful exceptions

Recent decisions and approvals

Ask Preckon / contextual intelligence
```

---

# 21. Tender + BOQ Workspace Pattern

Primary composition:

```text
Tender / package context
──────────────────────────────────────────────────────────
Filter / View / Compare / Import / Generate
──────────────────────────────────────────────────────────
BOQ / Tender Data Grid                     Inspector
                                           ───────────
Item | Description | Unit | Qty | Rate ... source
...                                        confidence
                                           assumptions
                                           history
                                           AI insight
```

Required behaviors:

- source traceability;
- structured comparison;
- revision awareness;
- uncertainty indicators;
- inline quantity/cost review;
- keyboard workflow;
- multi-row actions.

---

# 22. Draw Workspace Pattern

Primary composition:

```text
Drawing context + revision + compare
──────────────────────────────────────────────────────────
Tool rail     Technical Canvas              Context Panel
              original geometry             Issues
              remains unmirrored            Properties
                                            Takeoff
                                            Ask Preckon
```

Key rules:

- maximize usable canvas;
- toolbars stay compact;
- keep navigation out of the drawing;
- make panels resizable;
- allow panel hiding;
- preserve drawing orientation under RTL;
- make detected issues traceable to coordinates/regions;
- separate AI suggestion from approved markup.

---

# 23. Schedule Workspace Pattern

Use synchronized:

- activity grid;
- Gantt/timeline;
- milestone summary;
- critical/near-critical cues;
- contextual inspector.

Do not reduce scheduling to a dashboard.

---

# 24. Documents Workspace Pattern

Support:

- revision list;
- metadata;
- viewer;
- compare;
- annotations;
- linked RFIs/submittals;
- AI extraction;
- source citation.

Document viewer must preserve source orientation and page geometry in RTL.

---

# 25. Field UX

Field interfaces prioritize:

- large tap targets;
- fast capture;
- offline-aware states if supported;
- camera/photo workflows;
- issue creation;
- voice/text notes;
- location/context;
- approvals;
- minimum typing.

Do not simply render desktop forms on mobile.

---

# 26. Loading, Empty and Error States

## Loading

Prefer:

- stable layout;
- skeleton only when useful;
- progressive loading;
- no spinner for every small interaction.

## Empty

Empty states should tell the user:

- what this area is;
- why it may be empty;
- what useful action can be taken.

Do not use whimsical illustrations inside serious operational workspaces unless brand strategy explicitly chooses them.

## Error

Explain:

- what failed;
- what remains safe;
- what the user can do;
- whether retry is possible.

Never expose raw backend errors.

---

# 27. Responsive RTL Testing Matrix

Every major screen must be reviewed in at least:

| Locale | Direction | Theme | Desktop | Tablet | Mobile |
|---|---|---|---|---|---|
| English | LTR | Light | ✓ | ✓ | ✓ |
| English | LTR | Dark | ✓ | ✓ | ✓ |
| Arabic | RTL | Light | ✓ | ✓ | ✓ |
| Arabic | RTL | Dark | ✓ | ✓ | ✓ |

Specialized desktop workspaces may use a purpose-built mobile alternative rather than feature parity.

---

# 28. Component Completion Definition

A frontend component is not complete until it has:

- default state;
- hover where applicable;
- active/pressed;
- keyboard focus;
- disabled;
- loading if applicable;
- empty if applicable;
- validation/error if applicable;
- read-only if applicable;
- permission-restricted behavior if applicable;
- LTR;
- RTL;
- light;
- dark;
- translated long-text behavior;
- responsive behavior;
- accessible name and semantics;
- test coverage appropriate to the component.

---

# 29. Anti-Pattern Review

Before accepting a new screen, ask:

1. Does it look like a generic AI SaaS template?
2. Are there too many cards?
3. Are rounded containers being used without purpose?
4. Is whitespace reducing operational efficiency?
5. Is the hierarchy meaningful without decorative color?
6. Can the user find the primary task immediately?
7. Is critical data visible without opening multiple dialogs?
8. Are tables being avoided just because cards look prettier?
9. Does AI appear as intelligence rather than visual theatre?
10. Would a professional estimator, QS, project manager or engineer use this efficiently all day?
11. Does Arabic feel genuinely designed, not merely mirrored?
12. Does dark mode maintain clarity rather than simply invert colors?
13. Can the screen be used by keyboard and assistive technology?
14. Does the responsive behavior preserve the task rather than merely stack everything vertically?

If the answer is weak, redesign before implementation.

---

# 30. Design Review Scorecard

Score 1–5.

| Area | Weight |
|---|---:|
| Task clarity | 15% |
| Information hierarchy | 15% |
| Construction-domain fit | 15% |
| Efficiency/density | 10% |
| Visual professionalism | 10% |
| Accessibility | 10% |
| Responsive behavior | 10% |
| RTL / multilingual quality | 10% |
| Theme quality | 5% |

**Minimum acceptance:** 4.0/5 weighted score, with no score below 3 for Accessibility, RTL, Responsiveness or Task Clarity.

---

# 31. Engineering Implementation Principles

## 31.1 Design tokens

Store semantic tokens centrally.

Suggested categories:

- color;
- typography;
- spacing;
- radius;
- border;
- elevation;
- motion;
- breakpoints;
- z-index;
- density.

## 31.2 Component ownership

Create a shared Preckon UI package/library.

Feature teams should reuse it rather than creating local versions of:

- button;
- input;
- select;
- table;
- dialog;
- drawer;
- tabs;
- tooltip;
- badge/status;
- breadcrumb;
- command palette;
- context panel;
- filter bar;
- empty/error/loading state.

## 31.3 Internationalization

Use a framework-native or established i18n library.

The implementation must support:

- locale switching;
- direction switching;
- message interpolation;
- pluralization;
- date/number formatting;
- lazy locale loading;
- translation namespaces where useful.

## 31.4 Theme

Use root-level theme state such as:

```html
<html data-theme="light">
```

or an equivalent framework pattern.

Components must not need knowledge of the active theme.

## 31.5 Direction

Set direction at the document/root boundary.

Avoid one-off `.rtl` patches wherever possible.

---

# 32. Visual QA Requirements

For significant UI changes, capture or inspect:

- desktop light EN;
- desktop dark EN;
- desktop light AR;
- desktop dark AR;
- narrow laptop;
- tablet;
- mobile where applicable;
- keyboard focus;
- 200% zoom/reflow for applicable screens.

Perform a visual review, not only unit tests.

---

# 33. Performance UX

UI quality includes responsiveness.

Prioritize:

- fast first interaction;
- virtualization for large grids where needed;
- progressive document/drawing loading;
- avoiding unnecessary rerenders;
- optimistic UI only when rollback is safe;
- clear feedback for long-running operations;
- background work that does not block the interface.

Never hide slow behavior behind decorative animation.

---

# 34. Reference Screens Required Before Broad Rollout

The design system should be proven on three reference screens before broad module implementation:

1. **Project Command Center**
2. **Tender / BOQ Workspace**
3. **Draw Workspace**

These screens establish most of the application grammar.

They must be reviewed in English/Arabic, LTR/RTL and light/dark.

---

# 35. Claude / AI Coding Rules

When Claude generates frontend code for Preckon, it must:

1. inspect existing components first;
2. reuse the design system;
3. avoid generic AI-generated aesthetics;
4. state the user's job-to-be-done internally before choosing layout;
5. preserve construction data density;
6. use localization for all UI strings;
7. use logical CSS properties;
8. preserve technical artifact orientation under RTL;
9. use semantic theme tokens;
10. include accessible names and keyboard behavior;
11. test light/dark and LTR/RTL;
12. design responsive behavior intentionally;
13. avoid introducing a component if a shared component can be extended;
14. avoid visual changes unrelated to the requested task;
15. run relevant lint/type/tests;
16. visually inspect meaningful changes where the environment permits.

---

# 36. Suggested Project Structure

```text
.claude/
└── skills/
    └── preckon-frontend/
        └── SKILL.md

src/
├── design-system/
│   ├── tokens/
│   ├── components/
│   ├── patterns/
│   └── accessibility/
├── i18n/
│   ├── en/
│   └── ar/
├── app-shell/
└── modules/
    ├── tender/
    ├── draw/
    ├── quantity/
    ├── cost/
    ├── schedule/
    ├── documents/
    └── ...
```

Adapt to the repository's actual framework and architecture rather than forcing this exact structure.

---

# 37. Preckon Frontend Definition of Done

A feature may be functionally correct and still not be complete.

Frontend DoD:

- correct construction workflow;
- correct existing design-system usage;
- professional visual quality;
- no generic AI-template patterns;
- desktop behavior;
- applicable tablet/mobile behavior;
- English;
- Arabic;
- LTR;
- RTL;
- light;
- dark;
- keyboard;
- WCAG 2.2 AA target;
- clear loading/empty/error states;
- stable technical identifiers;
- no blind mirroring of technical artifacts;
- appropriate automated tests;
- visual QA.

---

# 38. First Implementation Sequence

Recommended sequence:

### Phase 1 — Foundation
- semantic tokens;
- typography;
- themes;
- locale/direction framework;
- shell;
- navigation;
- button/input/dialog/menu;
- status language;
- base accessibility.

### Phase 2 — Enterprise Data Work
- grid/table system;
- filters;
- saved views;
- inspector panel;
- bulk actions;
- density modes;
- command palette.

### Phase 3 — Reference Screens
- Project Command Center;
- Tender / BOQ;
- Draw.

### Phase 4 — Specialized Workspaces
- Schedule;
- Documents;
- Cost;
- Field;
- Quality/Safety;
- Financials.

### Phase 5 — Enterprise Intelligence
- contextual AI patterns;
- portfolio intelligence;
- Integration Hub monitoring;
- cross-project views.

---

# 39. Governing Principle

> **Do not optimize Preckon for screenshots. Optimize it for construction professionals who depend on it every day.**

Every design decision should improve one or more of:

- comprehension;
- speed;
- confidence;
- accuracy;
- accessibility;
- consistency;
- decision quality.

If it only makes the screen look more "AI", remove it.
