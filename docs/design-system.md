# Design system - HR & Payroll

"Calm enterprise", adopted 2026-11-07. Replaces the earlier prototype-derived rules. Every screen, including all future ones, is built from the kit in `apps/web/src/ui`; do not hand-style new pages.

- **Product:** internal HR/payroll tool; data-dense tables and forms; desktop first, works at 375px.
- **Style:** flat and quiet. Light canvas, white surfaces, hairline borders, one soft card shadow. Deep teal brand (the company logo) used only for the sidebar, primary actions, active states and key figures.
- **Tokens** (`apps/web/src/styles.css`, `@theme`): `brand-50..900` (primary `brand-600` #0F5F63), `ink-50..900` neutrals, `sidebar` #0C2A2D, `canvas`, `line`, status colours `success/warning/danger/info`. The Tailwind `blue`, `gray` and `slate` scales are remapped onto these, so legacy classes still follow the palette; new code uses `brand-*` and `ink-*`.
- **Type:** IBM Plex Sans (self-hosted via @fontsource), Plex Mono for IDs. `tabular-nums` on money and hours. Page title 24px, card title 16px, table 14px, form text 16px on phones and 14px from md.
- **Shape:** 4px grid; `rounded-lg` (8px) controls, `rounded-card` (12px) cards, full pills for badges.
- **Shell:** full-width header (brand, user, account actions) over a grouped, collapsible left sidebar (Overview, Workforce, Pay & leave, Administration; collapse state saved). Phones keep the bottom tab bar with a "More" sheet.
- **Kit:** `Button`, `IconButton`, `Card`/`CardHeader`, `PageHeader`, `StatCard`, `StatusBadge`, `Table` parts, `Input`/`Select`/`Textarea`/`Field`, `EmptyState`, `Skeleton`, plus `Dialog` and `ConfirmDialog`. Every page starts with `PageHeader`.
- **Status:** always icon + word + colour via `StatusBadge`; never colour alone.
- **Icons:** Lucide only, 16px inline / 18-20px actions; icon-only buttons need a label. No emoji.
- **Accessibility:** text contrast at least 4.5:1; visible focus ring on everything; touch targets at least 44px on phones (36px allowed from md in dense toolbars); visible labels; skip link; dialogs trap focus and close on Esc; `prefers-reduced-motion` respected.
- **Responsive:** wide tables scroll inside their card, never the page; below md, table rows become labelled cards.
- **Async:** every request has loading and error states; actions give feedback within 100 ms.
- **Printed/PDF payroll report** keeps its own black-and-white document styling.
