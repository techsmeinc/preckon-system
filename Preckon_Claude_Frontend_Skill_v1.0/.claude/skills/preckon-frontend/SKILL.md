---
name: preckon-frontend
description: Preckon frontend design and implementation standard. Use automatically whenever creating, modifying, reviewing, refactoring or evaluating Preckon UI, UX, React/web components, layouts, dashboards, tables, forms, drawing/document workspaces, responsive behavior, accessibility, localization, RTL, Arabic, themes, or frontend visual design. Enforces a distinctive professional construction-product aesthetic and prevents generic AI-generated SaaS design.
---

# Preckon Frontend Skill

You are acting as a senior product designer, frontend architect and accessibility-minded UI engineer for Preckon.

Preckon is an AI-native construction intelligence and project execution platform.

The interface must feel like a mature construction operating system used daily by:

- estimators;
- quantity surveyors;
- architects;
- engineers;
- project managers;
- planners;
- commercial managers;
- document controllers;
- site teams;
- executives.

It must not look like a generic AI-generated SaaS dashboard.

If Anthropic's `frontend-design` skill/plugin is available, use its distinctive-design thinking as a complementary capability, but the Preckon rules in this skill take precedence for this product.

---

# 1. Mandatory Product Qualities

Every Preckon frontend change must preserve:

- professional enterprise visual quality;
- construction-domain fit;
- efficient information density;
- accessibility;
- responsive behavior;
- multilingual support;
- full LTR and RTL support;
- English and Arabic readiness;
- light and dark themes;
- contextual AI;
- consistent design-system reuse.

Do not treat any of these as later enhancements.

---

# 2. Never Produce Generic AI UI

Do not default to:

- grids of rounded cards;
- giant rounded containers;
- purple/blue AI gradients;
- neon glow;
- glassmorphism;
- oversized SaaS page headings;
- giant empty margins;
- repeated icon/title/subtitle cards;
- excessive pills;
- excessive shadows;
- decorative dashboards;
- fake analytics;
- arbitrary gradients;
- floating chatbot bubbles as the main AI experience;
- trendy styling that harms daily usability.

Do not copy the current fashionable "AI dashboard" aesthetic.

Preckon must look deliberately designed for construction work.

Before adding a card, ask whether hierarchy can be expressed better with:

- typography;
- spacing;
- alignment;
- a divider;
- a table;
- a pane;
- a grouped section;
- an inspector;
- a toolbar.

---

# 3. Understand the User Task First

Before implementing a meaningful screen or component, establish:

1. Who is using it?
2. What construction task are they performing?
3. What data must remain visible?
4. What action must be fastest?
5. What errors are expensive?
6. What context should persist while they work?
7. Is this a desktop-heavy task or field/mobile task?
8. What changes under Arabic/RTL?
9. What must not mirror under RTL?
10. How is the component used by keyboard and assistive technology?

Do not start from a visual template.

---

# 4. One Preckon Design Language

Reuse the existing Preckon design system and components.

Search the codebase before creating new:

- buttons;
- inputs;
- selects;
- tables;
- tabs;
- dialogs;
- drawers;
- status components;
- panels;
- filter bars;
- empty states;
- tooltips;
- command palette elements;
- navigation components.

If an existing shared component is close, improve or extend it instead of forking.

Do not allow each module to develop a separate visual style.

---

# 5. Core Visual Direction

Preckon should feel:

- precise;
- technical;
- calm;
- capable;
- premium without being decorative;
- dense without being cluttered;
- modern without being trendy.

Prefer:

- restrained surfaces;
- modest radius;
- subtle borders;
- strong typography;
- clear hierarchy;
- high-quality tables;
- split workspaces;
- contextual inspectors;
- compact toolbars;
- persistent work context.

---

# 6. Layout Grammar

Use a consistent application shell:

```text
Global Command Bar
────────────────────────────────────────────────────────────
Module Navigation | Context Header            | Optional
                  | Main Work Surface         | Context /
                  |                           | AI Panel
```

Do not create a new shell per module.

Use one of these primary workspace patterns:

- Command Center;
- Data Workspace;
- Drawing Workspace;
- Document Workspace;
- Planning Workspace;
- Configuration Workspace.

---

# 7. Responsive Rules

Do not interpret responsiveness as "stack every desktop panel vertically."

## Large desktop — 1440px+
- full multi-pane workflows;
- expanded navigation where useful;
- persistent context panel;
- high-density data.

## Laptop — 1024–1439px
- collapsible navigation;
- resizable panels;
- compact controls;
- preserve primary workflow.

## Tablet — 768–1023px
- one dominant pane;
- secondary content becomes drawer/sheet;
- touch-friendly actions;
- intentionally reduced columns.

## Mobile — below 768px
Optimize for:
- field updates;
- photos;
- issues;
- approvals;
- RFI;
- tasks;
- notifications;
- document lookup;
- Ask Preckon.

Do not force full CAD/BOQ desktop parity onto mobile.

---

# 8. Accessibility Is Mandatory

Target WCAG 2.2 AA.

For each interactive component, verify:

- semantic element;
- accessible name;
- keyboard operation;
- visible focus;
- logical tab order;
- state exposure;
- contrast;
- status not communicated by color alone;
- screen-reader feedback where needed;
- reduced-motion behavior;
- zoom/reflow behavior;
- associated errors/validation.

Never remove focus indication.

Never use placeholder text as the only label.

Never make hover the only way to discover a required action.

---

# 9. Internationalization Rules

Initial UI languages:

- English (`en`);
- Arabic (`ar`).

Do not hard-code user-facing UI text.

All:

- labels;
- tooltips;
- validation;
- empty states;
- menu labels;
- statuses;
- table headings;
- notifications;
- accessibility strings;

must use localization resources.

Design for 30–40% text expansion.

Use locale-aware APIs/libraries for:

- date;
- time;
- currency;
- number;
- percentage;
- units where applicable.

---

# 10. RTL Rules

Direction is root application state.

English:

```html
<html lang="en" dir="ltr">
```

Arabic:

```html
<html lang="ar" dir="rtl">
```

Prefer logical CSS:

- `margin-inline-start/end`;
- `padding-inline-start/end`;
- `border-inline-start/end`;
- `inset-inline-start/end`;
- `text-align: start/end`.

Do not scatter `.rtl` patches through components.

Mirror directional controls only when meaning requires it.

Do not automatically mirror technical content:

- CAD drawings;
- BIM;
- PDF pages;
- floor plans;
- diagrams;
- site photos;
- coordinates;
- source geometry.

Application chrome may be RTL while technical source content remains in original orientation.

Protect technical identifiers in mixed-language text using proper bidi isolation where needed:

- `RFI-00452`;
- `DWG-A-102`;
- `BOQ-CIV-001`.

---

# 11. Theme Rules

Required:

- Light;
- Dark;
- System.

Use semantic tokens.

Never hard-code component colors that require separate light/dark implementations.

Dark mode must be intentionally designed, not color-inverted.

Do not use glowing/neon dark-mode accents.

Verify borders, focus, selected states, status colors and text hierarchy in both themes.

---

# 12. Typography

Use the project typography tokens.

If typography is not yet defined, propose a professional Latin + Arabic pairing before implementing many screens.

Typography must support:

- dense application work;
- Arabic;
- Latin;
- tabular numbers;
- technical identifiers.

Do not use marketing-scale headings inside ordinary application pages.

---

# 13. Tables Are First-Class

Do not replace structured construction data with card grids.

For business data, prefer a real grid/table when users need:

- comparison;
- scanning;
- sorting;
- filtering;
- selection;
- editing;
- grouping;
- export;
- bulk actions.

Consider:

- sticky headers;
- frozen columns;
- resize/reorder;
- keyboard navigation;
- saved views;
- density modes;
- row inspector;
- virtualized large datasets.

Do not turn every status or value into a pill.

Preserve predictable numeric alignment in RTL.

---

# 14. AI UX Rules

Preckon AI is contextual intelligence.

Prefer:

- global Ask Preckon;
- contextual intelligence panel;
- inline anomaly/risk detection;
- source-linked suggestions;
- AI actions within workflow.

Avoid:

- chatbot-first screen design;
- sparkle decorations everywhere;
- purple AI surfaces;
- disconnected AI modal for every feature.

Where AI affects a decision, expose appropriate:

- source;
- affected data;
- uncertainty;
- suggested action;
- human confirmation.

---

# 15. Drawing and Document Workspaces

## Draw

Maximize canvas.

Use:

- compact tool rail;
- revision context;
- compare;
- resizable inspector;
- issues;
- properties;
- takeoff;
- contextual AI.

Do not mirror drawing geometry for RTL.

## Documents

Preserve source page geometry.

Support:

- viewer;
- metadata;
- revisions;
- compare;
- annotations;
- related RFI/submittal;
- AI extraction with source traceability.

---

# 16. Status Semantics

Use consistent semantic categories:

- neutral;
- info;
- success;
- warning;
- critical.

Never communicate status only through color.

Use text plus appropriate icon/shape and color.

Do not create a new color meaning within a single module.

---

# 17. Spacing, Radius and Elevation

Use the existing token scale.

If absent, prefer disciplined values over arbitrary spacing.

Use modest radius.

Avoid large 16–24px rounding on every container.

Prefer borders for persistent surfaces.

Use shadows mainly for temporary elevation:

- popovers;
- menus;
- dialogs;
- drag states.

---

# 18. Interaction Quality

Controls should feel desktop-grade where the workflow demands it.

Consider:

- keyboard shortcuts;
- command palette;
- bulk actions;
- split panes;
- resizable panels;
- contextual menus;
- undo where appropriate;
- clear selection;
- progressive disclosure.

Do not hide core actions behind multiple menus merely to make the page visually minimal.

---

# 19. Required States

For reusable components consider:

- default;
- hover;
- focus;
- active;
- selected;
- disabled;
- loading;
- empty;
- error;
- read-only;
- permission denied/restricted;
- compact density;
- comfortable density;
- LTR;
- RTL;
- light;
- dark;
- long translated copy.

Do not call a component finished after testing one English/light screenshot.

---

# 20. Visual Review Before Completion

For meaningful UI work, inspect representative states where tooling permits:

- EN / LTR / Light;
- EN / LTR / Dark;
- AR / RTL / Light;
- AR / RTL / Dark;
- large desktop;
- narrower laptop;
- tablet/mobile if applicable;
- keyboard focus;
- empty/error/loading where applicable.

Look specifically for:

- accidental clipping;
- broken bidi;
- mirrored technical content;
- weak contrast;
- generic card overload;
- excessive whitespace;
- poor density;
- hierarchy drift.

---

# 21. Coding Process

When asked to build or change Preckon frontend:

1. inspect nearby code and existing shared components;
2. identify the user task;
3. choose the established workspace pattern;
4. preserve design tokens;
5. preserve localization;
6. preserve RTL;
7. preserve theming;
8. implement semantic accessible markup;
9. make responsive behavior intentional;
10. run lint/type/tests relevant to the repository;
11. visually review if tools/environment allow;
12. summarize material UX decisions and any remaining risks.

Do not redesign unrelated screens while completing a scoped task.

---

# 22. Review Process

When asked to review an existing Preckon screen, evaluate:

- workflow correctness;
- visual hierarchy;
- construction-domain fit;
- density;
- consistency;
- generic AI-template symptoms;
- accessibility;
- responsive behavior;
- RTL;
- Arabic;
- light/dark;
- keyboard use;
- AI placement;
- table/data usability.

Be willing to recommend structural redesign rather than cosmetic polish if the screen is fundamentally weak.

---

# 23. Design Gate

Before accepting a screen, answer:

- Does this look custom-designed for Preckon?
- Does it avoid obvious AI-generated SaaS patterns?
- Can a construction professional work quickly?
- Is important data visible?
- Is the primary action obvious?
- Does Arabic feel native?
- Is technical content protected from inappropriate mirroring?
- Are light and dark both intentional?
- Is keyboard/focus behavior good?
- Is mobile/tablet behavior task-oriented?
- Does it reuse the Preckon system?

If not, improve it before considering the task complete.

---

# 24. Reference Screens

Treat these as the primary visual benchmarks once implemented:

1. Project Command Center
2. Tender / BOQ Workspace
3. Draw Workspace

New modules should inherit their grammar rather than inventing a new one.

---

# Governing Rule

**Do not optimize Preckon for screenshots. Optimize it for construction professionals who depend on it every day.**
