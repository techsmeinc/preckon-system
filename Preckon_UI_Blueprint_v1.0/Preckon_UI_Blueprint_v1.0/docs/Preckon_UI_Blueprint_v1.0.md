# Preckon UI Blueprint v1.0

**Status:** Product + Engineering Implementation Blueprint  
**Scope:** Web-first, desktop-class Preckon application  
**Primary markets:** GCC + international  
**Initial languages:** English + Arabic  
**Direction:** LTR + RTL  
**Themes:** Light + Dark + System  
**Accessibility:** WCAG 2.2 AA target  
**Reference workspaces:** Project Command Center, Tender / BOQ, Draw

---

# 1. Product Experience Goal

Preckon must feel like a **serious construction operating system** rather than a generic SaaS dashboard.

The design should communicate:

- engineering precision;
- strong information hierarchy;
- operational speed;
- construction-domain depth;
- premium enterprise quality;
- accessibility;
- responsive behavior;
- Arabic/RTL readiness;
- AI embedded into workflows rather than shown as decoration.

The core design test:

> Would a quantity surveyor, estimator, planner, project manager, engineer or commercial manager comfortably use this interface for eight hours a day?

If not, redesign.

---

# 2. Application Shell

## 2.1 Desktop shell dimensions

Recommended baseline at 1440px width:

| Region | Size |
|---|---:|
| Global top bar | 56px |
| Expanded left navigation | 232px |
| Collapsed left navigation | 64px |
| Context header | 52px |
| Right intelligence panel | 360px default |
| Right panel min | 300px |
| Right panel max | 520px |
| Main content gutter | 20px |
| Dense workspace gutter | 12–16px |

The right panel is optional and must be resizable where the workflow benefits.

## 2.2 Desktop shell

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ PRECKON | Project Switcher | Global Search | Ask Preckon | Alerts | User   │
├───────────────┬──────────────────────────────────────────────┬────────────────┤
│               │ Context Header                               │                │
│ Module Nav    ├──────────────────────────────────────────────┤ Context / AI   │
│               │                                              │ Intelligence   │
│ Overview      │                                              │ Panel          │
│ Tender        │              Main Workspace                  │                │
│ Draw          │                                              │                │
│ Quantity      │                                              │                │
│ Cost          │                                              │                │
│ Schedule      │                                              │                │
│ Documents     │                                              │                │
│ Field         │                                              │                │
│ Quality       │                                              │                │
│ Financials    │                                              │                │
│ Integrations  │                                              │                │
└───────────────┴──────────────────────────────────────────────┴────────────────┘
```

---

# 3. Global Top Bar

## 3.1 Required controls

Left / start side:

- Preckon product mark;
- organization;
- active project / portfolio switcher.

Center:

- global search;
- command palette trigger;
- recent objects.

Right / end side:

- Ask Preckon;
- notifications;
- help;
- language selector;
- appearance selector;
- user menu.

In RTL, the visual order mirrors naturally through the application direction.

## 3.2 Global search

Search across:

- projects;
- drawings;
- documents;
- RFIs;
- submittals;
- tenders;
- BOQ items;
- schedule activities;
- cost codes;
- people;
- integrations.

Search result rows should show:

- object type;
- title;
- project;
- status;
- contextual metadata;
- recent activity.

## 3.3 Command palette

Shortcut recommendation:

`Ctrl/Cmd + K`

Use for:

- navigation;
- create action;
- search;
- switch project;
- open recent;
- Ask Preckon;
- theme/language switching;
- power-user actions.

---

# 4. Left Navigation

## 4.1 Module order

Recommended default:

1. Overview
2. Tender
3. Draw
4. Quantity
5. Cost
6. Schedule
7. Documents
8. Field
9. Quality & Safety
10. Financials
11. Intelligence
12. Integrations

Bottom group:

- Settings
- Help

## 4.2 Navigation rules

- persistent on desktop;
- collapsible to 64px;
- labels remain available via tooltip when collapsed;
- active module uses bar + typography + color, not color alone;
- no accordion explosion;
- secondary navigation belongs in module header or contextual sidebar;
- badges only for actionable counts;
- no decorative icons.

## 4.3 Compact mode

At 1024–1199px:

- default to collapsed nav;
- allow pin-open if space permits.

At tablet:

- module nav becomes overlay drawer.

At mobile:

- use simplified bottom/overflow navigation for field-oriented features, not desktop nav squeezed into a phone.

---

# 5. Context Header

Height: **52px**

Contains:

- breadcrumb/path;
- page/workspace title;
- current status if operationally relevant;
- view selector;
- primary action;
- 1–3 secondary actions;
- overflow menu.

Example:

```text
Tender / Tower A / Package 04     Bid Review
                                              Compare   Export   [Submit Review]
```

Avoid:

- giant titles;
- redundant subtitles;
- “Welcome back” text;
- decorative descriptions.

---

# 6. Design Tokens

## 6.1 Brand approach

Use a restrained construction/engineering palette.

Primary visual identity:

- deep graphite / ink neutrals;
- Preckon teal-green accent;
- blue for informational states;
- amber for schedule/cost attention;
- red for critical;
- green for validated/success.

No purple AI gradient.

---

# 7. Light Theme Palette

| Token | Value | Usage |
|---|---|---|
| `canvas` | `#F5F7F8` | app background |
| `surface` | `#FFFFFF` | primary workspace |
| `surface-subtle` | `#F0F3F4` | grouped areas |
| `surface-raised` | `#FFFFFF` | dialogs/popovers |
| `text-primary` | `#172126` | main text |
| `text-secondary` | `#526068` | supporting text |
| `text-muted` | `#74828A` | tertiary text |
| `border` | `#D8DEE2` | default separators |
| `border-strong` | `#B8C2C8` | strong separators |
| `accent` | `#087E75` | Preckon action |
| `accent-hover` | `#066B64` | hover |
| `accent-subtle` | `#E6F3F1` | selected/soft state |
| `info` | `#1769AA` | info |
| `success` | `#2F7D4A` | success |
| `warning` | `#B56A00` | attention |
| `critical` | `#B42318` | critical |
| `focus` | `#0B78D0` | focus ring |

---

# 8. Dark Theme Palette

| Token | Value | Usage |
|---|---|---|
| `canvas` | `#101619` | app background |
| `surface` | `#161E22` | main workspace |
| `surface-subtle` | `#1B252A` | grouped areas |
| `surface-raised` | `#202B30` | overlays |
| `text-primary` | `#E8EEF0` | main text |
| `text-secondary` | `#B5C0C5` | secondary text |
| `text-muted` | `#89969D` | muted text |
| `border` | `#2A383E` | default separators |
| `border-strong` | `#43535B` | stronger separators |
| `accent` | `#39B8AA` | Preckon action |
| `accent-hover` | `#58C9BC` | hover |
| `accent-subtle` | `#143B38` | selected/soft state |
| `info` | `#5BA6E6` | info |
| `success` | `#65B77B` | success |
| `warning` | `#E0A23A` | warning |
| `critical` | `#F06D63` | critical |
| `focus` | `#69B7F5` | focus ring |

Dark mode must not use glowing borders or neon shadows.

---

# 9. Typography

## 9.1 Recommended pairing

**Latin UI:** IBM Plex Sans  
**Arabic UI:** IBM Plex Sans Arabic  
**Technical/monospace:** IBM Plex Mono

Alternative production font choices are acceptable if:

- licensed correctly;
- Arabic and Latin visually harmonize;
- numerals are clear;
- dense tables remain readable.

## 9.2 Type scale

| Role | Size | Weight | Line Height |
|---|---:|---:|---:|
| App page title | 20px | 600 | 28px |
| Section title | 16px | 600 | 24px |
| Panel title | 14px | 600 | 20px |
| Body | 14px | 400 | 20px |
| Dense body | 13px | 400 | 18px |
| Label | 12px | 500 | 16px |
| Caption | 11px | 400 | 16px |
| Technical ID | 12–13px | 500 mono | 18px |

Avoid 28–40px application headings except on true landing/onboarding screens.

## 9.3 Numbers

Use tabular numerals for:

- quantities;
- money;
- dates;
- percentages;
- durations;
- progress;
- variance.

---

# 10. Spacing

Base scale:

`2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48`

Primary application spacing:

- 4px micro;
- 8px control groups;
- 12px dense panels;
- 16px standard groups;
- 20px workspace gutters;
- 24px major sections.

Do not invent random values per screen.

---

# 11. Radius + Elevation

## Radius

- small controls: `4px`;
- buttons/inputs: `6px`;
- panels: `6px`;
- menus/popovers: `8px`;
- dialogs: `8–10px`;

Avoid large 16–24px dashboard rounding.

## Elevation

Persistent surfaces:

- prefer border over shadow.

Floating surfaces:

- menu;
- popover;
- dialog;
- drag layer;

may use subtle elevation.

---

# 12. Core Component Inventory

## 12.1 Foundations

- DesignTokenProvider
- ThemeProvider
- LocaleProvider
- DirectionProvider
- AccessibilityPreferencesProvider
- DensityProvider

## 12.2 Navigation

- AppShell
- GlobalTopBar
- ProjectSwitcher
- ModuleNav
- Breadcrumbs
- ContextHeader
- CommandPalette
- GlobalSearch
- MobileNavigation

## 12.3 Actions

- Button
- IconButton
- SplitButton
- OverflowMenu
- Menu
- ContextMenu
- Tooltip
- ShortcutHint

## 12.4 Inputs

- TextField
- TextArea
- NumberField
- CurrencyField
- QuantityField
- UnitSelector
- Select
- MultiSelect
- Combobox
- DatePicker
- DateRange
- TimePicker
- Checkbox
- RadioGroup
- Switch
- FileUpload
- SearchField
- FilterBuilder

## 12.5 Data

- DataGrid
- TreeGrid
- PropertyGrid
- SummaryRow
- Status
- Progress
- Metric
- Delta
- Sparkline
- Timeline
- Gantt
- AuditTrail
- VersionHistory

## 12.6 Surfaces

- Panel
- Inspector
- Drawer
- Sheet
- Dialog
- Popover
- Tabs
- SplitPane
- ResizablePane
- Toolbar
- FilterBar

## 12.7 Feedback

- InlineAlert
- Toast
- EmptyState
- ErrorState
- Skeleton
- ProgressIndicator
- ValidationMessage
- PermissionNotice

## 12.8 AI

- AskPreckonLauncher
- IntelligencePanel
- AIInsight
- AIRecommendation
- AISourceCitation
- AIConfidence
- AIActionPreview
- HumanApprovalGate

## 12.9 Drawing / Document

- DrawingCanvas
- DrawingToolbar
- DrawingNavigator
- RevisionSelector
- LayerPanel
- MarkupTools
- IssueMarker
- TakeoffPanel
- DocumentViewer
- DocumentOutline
- CompareViewer
- SourceAnchor

---

# 13. Button System

## Primary

Use one primary action in a local context.

Examples:

- Submit Tender
- Publish Revision
- Approve
- Create RFI

## Secondary

For important alternatives:

- Compare
- Export
- Save Draft

## Tertiary

For low-emphasis actions:

- Reset
- Close
- View History

## Destructive

Use only for destructive actions:

- Delete
- Revoke
- Remove

---

# 14. Data Grid Standard

Preckon's enterprise value depends heavily on excellent grids.

## 14.1 Default capabilities

Every substantial grid must consider:

- sticky header;
- sort;
- filter;
- quick search;
- column resize;
- column reorder;
- show/hide columns;
- saved views;
- frozen columns;
- row selection;
- bulk actions;
- inline edit;
- row inspector;
- keyboard navigation;
- density toggle;
- export;
- hierarchy/grouping;
- virtual scrolling where needed.

## 14.2 Density

Comfortable row height: `40px`  
Compact row height: `32px`

## 14.3 Cell formatting

- descriptions: start aligned;
- IDs: stable bidi isolate;
- numbers: end aligned;
- quantity/currency: tabular;
- status: concise;
- actions: no more than 1–2 visible, remaining in overflow.

Do not use a pill for every value.

---

# 15. Accessibility Blueprint

Target WCAG 2.2 AA.

Mandatory:

- keyboard support;
- visible focus;
- semantic controls;
- accessible names;
- status not color-only;
- reduced motion;
- appropriate touch targets;
- screen reader labels;
- form errors associated to fields;
- logical heading hierarchy;
- table/grid semantics;
- zoom/reflow testing;
- ARIA only when native HTML is insufficient.

Focus ring:

- 2px;
- clearly separated from component border;
- visible in light/dark.

---

# 16. RTL + Multilingual Blueprint

## 16.1 Root direction

```html
<html lang="en" dir="ltr">
<html lang="ar" dir="rtl">
```

## 16.2 Use logical CSS

Required:

- `margin-inline-*`
- `padding-inline-*`
- `border-inline-*`
- `inset-inline-*`
- `text-align: start/end`

Avoid physical left/right rules unless the object has a physical orientation.

## 16.3 Technical exceptions

Never auto-mirror:

- CAD;
- BIM;
- drawing geometry;
- PDF pages;
- photographs;
- diagrams;
- coordinates.

## 16.4 Stable technical identifiers

Use bidi isolation around values such as:

- `RFI-00452`
- `DWG-A-102`
- `BOQ-CIV-001`
- `P6-WBS-04`

## 16.5 Translation expansion

Allow 30–40% text expansion.

Never hard-code component width based on English labels alone.

---

# 17. Responsive Blueprint

## 17.1 1440px+

Full desktop.

- nav expanded;
- multi-pane;
- 360px intelligence inspector;
- compact data density;
- full toolbar.

## 17.2 1200–1439px

- nav collapsible;
- right panel resizable;
- preserve grids;
- toolbar may collapse secondary actions.

## 17.3 1024–1199px

- nav collapsed by default;
- right panel overlay or narrower;
- view switching for complex three-pane screens.

## 17.4 768–1023px

- single main workspace;
- drawers replace persistent inspectors;
- reduced table columns;
- explicit detail view.

## 17.5 <768px

Purpose-built field mode.

Use:

- task list;
- document lookup;
- RFI;
- approval;
- photo/issue capture;
- alerts;
- Ask Preckon.

Do not render miniature desktop Draw or BOQ.

---

# 18. Reference Screen 1 — Project Command Center

## 18.1 Goal

Answer:

> What requires my attention now, and why?

Do not make this a 12-card KPI wall.

## 18.2 Desktop wireframe

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PRECKON | Sobha Marina ▾ | Search… | Ask Preckon | Alerts | EN/AR | Theme | User    │
├───────────────┬───────────────────────────────────────────────────────────┬─────────────┤
│ Overview      │ PROJECT COMMAND CENTER                     17 Aug 2026    │ PRIORITIES  │
│ Tender        ├───────────────────────────────────────────────────────────┤             │
│ Draw          │ PROJECT HEALTH                                             │ 1 CRITICAL  │
│ Quantity      │ Schedule   Cost       Progress    Quality/Safety           │ 4 AT RISK   │
│ Cost          │ At Risk    +2.8%      68%         Stable                   │             │
│ Schedule      ├───────────────────────────────────────────────────────────┤ ─────────── │
│ Documents     │ CRITICAL DECISIONS                                        │             │
│ Field         │                                                           │ Procurement │
│ Quality       │ ! Facade procurement may impact milestone M-14            │ package late│
│ Financials    │   Impact: 11–16 days     Owner: Commercial Manager        │             │
│ Intelligence  │                                                           │ Ask Preckon │
│ Integrations  │ ! Concrete package variation awaiting approval            │             │
│               ├───────────────────────────────────────────────────────────┤             │
│               │ DELIVERY                                                   │             │
│               │ Milestone trend          Cost forecast                    │             │
│               │ [meaningful chart]       [meaningful chart]               │             │
│               ├───────────────────────────────────────────────────────────┤             │
│               │ RECENT APPROVALS / CHANGES / RISKS                         │             │
└───────────────┴───────────────────────────────────────────────────────────┴─────────────┘
```

## 18.3 Content hierarchy

1. Project health
2. Critical decisions
3. Schedule / cost / delivery trend
4. Recent approvals/changes
5. Contextual AI priorities

## 18.4 Interaction rules

- clicking risk opens supporting records;
- AI priority must link to source;
- no fake confidence;
- metrics should have comparison context;
- charts must support an operational question.

## 18.5 Tablet

- priorities becomes drawer;
- charts stack one per row;
- health remains top.

## 18.6 Mobile

Show:

- project health;
- top 3 decisions;
- alerts;
- approvals;
- Ask Preckon.

Do not show full analytics wall.

---

# 19. Reference Screen 2 — Tender / BOQ Workspace

## 19.1 Goal

Allow estimators/QS/commercial users to:

- understand tender package;
- review extracted BOQ;
- compare source;
- edit;
- validate quantities/rates;
- see AI uncertainty;
- approve/export.

## 19.2 Desktop wireframe

```text
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Tender / Package 04 / BOQ Review       Rev 06      Compare  Export     [Submit Review]     │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ View: All Items ▾   Search items…   Filters  Group by ▾   Density ▾   Columns ▾            │
├───────────────────────────────────────────────────────────────────┬────────────────────────┤
│ ☐ Item  Description              Unit   Qty       Rate       Amount │ ITEM INSPECTOR         │
│ ───────────────────────────────────────────────────────────────── │                        │
│ ☐ 1.01  Excavation              m³     1,240     42.00     52,080 │ Source: Spec 03 31 00  │
│ ☐ 1.02  Backfill                m³       890     28.00     24,920 │ Drawing: C-102         │
│ ☐ 1.03  Blinding concrete       m³       180     95.00     17,100 │                        │
│ ☐ 1.04  Reinforced concrete     m³     2,410    460.00  1,108,600 │ AI confidence: Medium  │
│                                                                   │                        │
│ ...                                                               │ Assumptions            │
│                                                                   │ - 10% waste            │
│                                                                   │ - Rev 6 dimensions     │
│                                                                   │                        │
│                                                                   │ [View source]          │
│                                                                   │ [Accept] [Edit]        │
└───────────────────────────────────────────────────────────────────┴────────────────────────┘
```

## 19.3 Required capabilities

- large data sets;
- editable rows;
- row history;
- source provenance;
- revision comparison;
- grouped sections;
- filters;
- confidence/uncertainty;
- audit trail;
- user overrides;
- bulk accept/reject;
- keyboard navigation.

## 19.4 AI UX

AI is shown as:

- source-linked extraction;
- discrepancy;
- missing quantity;
- unusual rate;
- duplicated scope;
- drawing/spec mismatch.

Not as a detached chatbot.

## 19.5 RTL behavior

- application chrome mirrors;
- table flow may adapt;
- descriptions align to start;
- numeric columns remain predictable;
- technical IDs remain isolated;
- source PDF/drawing orientation remains original.

---

# 20. Reference Screen 3 — Draw Workspace

## 20.1 Goal

Provide a professional technical environment for:

- drawing review;
- markups;
- issue detection;
- quantity/takeoff;
- revisions;
- comparison;
- AI interpretation.

## 20.2 Desktop wireframe

```text
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ Draw / Tower A / Level 12 / A-102       Rev 17 ▾       Compare     Share     [Publish]    │
├───────┬──────────────────────────────────────────────────────────┬──────────────────────────┤
│       │ Toolbar: Select | Pan | Measure | Markup | Issue | View │ DRAWING INTELLIGENCE     │
│       ├──────────────────────────────────────────────────────────┤                          │
│Sheet  │                                                          │ Issues                   │
│Tree   │                                                          │ 12 detected              │
│       │                  TECHNICAL CANVAS                        │                          │
│A-101  │                                                          │ Selected issue           │
│A-102  │             preserve source orientation                 │ Missing dimension        │
│A-103  │                                                          │                          │
│       │                                                          │ Related BOQ items        │
│       │                                                          │ 4                        │
│       │                                                          │                          │
│       │                                                          │ Ask Preckon              │
│       │                                                          │ "Explain this issue…"    │
├───────┴──────────────────────────────────────────────────────────┴──────────────────────────┤
│ Status: Saved     Scale 1:100     Coordinates X/Y     Layers 23     Markups 6             │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 20.3 Panel behavior

Left sheet tree:

- 220px default;
- collapsible.

Right panel:

- 360px default;
- resizable 300–520px;
- tabs:
  - Issues
  - Properties
  - Layers
  - Takeoff
  - Intelligence

Canvas:

- gets remaining space;
- never blindly mirrored in RTL.

## 20.4 Toolbar

Use compact icons with accessible labels.

Primary tools:

- select;
- pan;
- zoom;
- measure;
- markup;
- issue;
- compare;
- layers;
- fit;
- reset view.

Avoid floating bubble toolbars unless context-specific.

## 20.5 AI behavior

AI can:

- explain selected region;
- detect missing annotations;
- compare revisions;
- identify probable clashes;
- link drawing region to BOQ;
- identify specification references.

Every significant AI claim must be traceable back to:

- drawing region;
- source;
- revision;
- extracted evidence.

---

# 21. Theme Behavior by Workspace

## Light mode preferred use

- tender;
- BOQ;
- cost;
- forms;
- configuration;
- reporting.

## Dark mode preferred use

- Draw;
- document review;
- command center in operations/control-room use.

Users may choose either mode globally.

Never force a mode by module unless the user explicitly enables an optional workspace preference.

---

# 22. AI Visual Language

Use the same interface language as the rest of Preckon.

Recommended AI signifiers:

- subtle Preckon accent;
- small intelligence icon;
- source badge;
- confidence text;
- "AI suggested" label where needed.

Avoid:

- sparkles everywhere;
- purple gradient;
- animated glow;
- oversized AI avatar;
- dedicated chat bubble on every screen.

---

# 23. Iconography

Select one coherent icon family.

Icon size:

- 16px dense;
- 18px standard;
- 20px major toolbar;
- 24px only for prominent actions/states.

Stroke weight must remain visually consistent.

Directional icons must mirror under RTL.

---

# 24. Motion

Use short motion:

- 120–180ms controls;
- 180–240ms panel transitions;
- no decorative looping animation.

Respect reduced-motion preferences.

---

# 25. Forms and Validation

Field vertical rhythm:

- label;
- control;
- optional help/error.

Do not rely on placeholder as label.

Validation:

- explain issue;
- preserve input;
- announce error;
- scroll/focus intelligently;
- display a summary for long forms when appropriate.

---

# 26. Empty States

Use concise professional language.

Example:

**No RFIs match this view**

Adjust filters or create a new RFI.

Do not use large cartoon illustrations in dense enterprise workspaces.

---

# 27. Permission States

Do not simply hide all unauthorized functionality if awareness is useful.

Use:

- disabled action with explanation;
- permission notice;
- request-access path where product supports it.

Sensitive data may require complete hiding.

---

# 28. Error States

Error messages should explain:

- what failed;
- whether data was saved;
- whether retry is safe;
- what the user can do next.

Never display raw API/backend stack traces.

---

# 29. Design QA Matrix

Every major reference screen must be reviewed in:

- EN / LTR / Light / 1440;
- EN / LTR / Dark / 1440;
- AR / RTL / Light / 1440;
- AR / RTL / Dark / 1440;
- 1024 laptop;
- 768 tablet;
- mobile alternative where applicable;
- 200% zoom;
- keyboard-only.

---

# 30. Acceptance Scorecard

Rate 1–5.

| Category | Weight |
|---|---:|
| Construction workflow fit | 15% |
| Information hierarchy | 15% |
| Visual professionalism | 10% |
| Efficiency / density | 10% |
| Accessibility | 10% |
| RTL / Arabic | 10% |
| Responsive behavior | 10% |
| Table/data usability | 10% |
| Theme quality | 5% |
| AI integration quality | 5% |

Minimum:

- weighted total >= 4.0;
- no score below 3 for accessibility, RTL, responsive behavior, or task clarity.

---

# 31. Recommended Implementation Order

## Sprint Foundation A

- token architecture;
- font integration;
- light/dark/system;
- locale/direction provider;
- app shell;
- global top bar;
- navigation;
- context header.

## Sprint Foundation B

- buttons;
- form controls;
- menus;
- dialog/drawer;
- tooltip;
- status;
- feedback;
- accessibility utilities.

## Sprint Data

- grid;
- filters;
- saved views;
- bulk actions;
- inspector;
- density;
- keyboard navigation.

## Sprint Reference 1

- Project Command Center.

## Sprint Reference 2

- Tender / BOQ.

## Sprint Reference 3

- Draw.

Only after these reference screens are accepted should the team propagate patterns into other modules.

---

# 32. Engineering Guardrails

Do not merge frontend changes that:

- hard-code English strings;
- use raw colors instead of tokens;
- assume LTR;
- fail dark mode;
- introduce generic AI styling;
- duplicate existing components;
- break keyboard navigation;
- rely only on color for state;
- use inaccessible custom controls;
- blindly mirror technical artifacts;
- ignore narrow laptop layout.

---

# 33. Claude Code Usage

When Claude is asked to create or modify Preckon UI:

1. load the `preckon-frontend` skill;
2. inspect existing components;
3. identify the workspace type;
4. follow this blueprint;
5. preserve RTL/i18n/theme/accessibility;
6. render or visually inspect representative states when possible;
7. run relevant tests;
8. reject generic AI-generated styling.

Recommended starting command:

```text
Use the preckon-frontend skill.

Implement the requested Preckon screen using the existing design system.
Before coding, inspect the application shell, shared components, theme tokens,
i18n setup and RTL conventions.

Do not create generic SaaS cards or decorative AI visuals.
Optimize for construction professionals using the screen all day.

Validate:
- English LTR
- Arabic RTL
- light
- dark
- responsive laptop behavior
- keyboard accessibility
```

---

# 34. Governing Product Principle

**Preckon should look designed by an experienced construction-product team, not generated by an AI design template.**

Every screen must earn its space.
