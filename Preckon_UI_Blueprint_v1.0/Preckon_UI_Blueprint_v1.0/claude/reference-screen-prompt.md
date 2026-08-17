# Preckon Reference Screen Implementation Prompt

Use the `preckon-frontend` Claude skill and the Preckon UI Blueprint v1.0.

Build the selected reference screen as a production-quality application workspace.

## Non-negotiable rules

- Do not create a generic AI SaaS dashboard.
- Do not use excessive cards, gradients, pills, shadows or oversized headings.
- Use the Preckon application shell.
- Use semantic theme tokens.
- Support English/LTR and Arabic/RTL.
- Support light/dark/system.
- Use CSS logical properties.
- Preserve drawing/PDF geometry under RTL.
- Meet WCAG 2.2 AA intent.
- Make keyboard focus visible.
- Use responsive behavior designed for the task, not naive stacking.
- Reuse shared components before adding new ones.
- AI must be contextual and source-linked.

## Required visual checks

Render/inspect where tooling allows:

1. English + LTR + Light at 1440px
2. English + LTR + Dark at 1440px
3. Arabic + RTL + Light at 1440px
4. Arabic + RTL + Dark at 1440px
5. 1024px laptop
6. 768px tablet
7. keyboard focus states

## Reference screens

### Project Command Center
Prioritize critical decisions, schedule/cost exposure, delivery status and AI priorities.

### Tender / BOQ
Prioritize a professional editable data grid, source traceability, revision comparison and inspector.

### Draw
Prioritize technical canvas, compact toolbars, sheet/revision navigation and contextual intelligence.

Before coding, explain only the important UX/layout choices. Then implement.
