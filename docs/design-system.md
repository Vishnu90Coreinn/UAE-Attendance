# Design system - HR & Payroll

"Calm enterprise", adopted 2026-11-07. Replaces the earlier prototype-derived rules. Every screen, including all future ones, is built from the kit in `apps/web/src/ui`; do not hand-style new pages.

- **Product:** internal HR/payroll tool; data-dense tables and forms; desktop first, works at 375px.
- **Style:** flat and quiet, refined 2026-11-25. Light mint-tinted canvas, white surfaces, hairline borders, a layered soft card shadow. Deep teal brand (the company logo) used only for the sidebar, primary actions, active states and key figures.
- **Tokens** (`apps/web/src/styles.css`, `@theme`): `brand-50..900` (primary `brand-600` #0F5F63; `brand-50` is a mint #E9F4EF), `mint-100`, `pistachio` (#D9E8A8, the call-to-action on dark panels only), `ink-50..900` neutrals, `sidebar` #0C2A2D, `canvas`, `line`, status colours `success/warning/danger/info`. The Tailwind `blue`, `gray` and `slate` scales are remapped onto these, so legacy classes still follow the palette; new code uses `brand-*` and `ink-*`.
- **Type:** Inter Variable for body, tables and forms; Plus Jakarta Sans Variable (`font-display`) for page and card titles, dialog titles and the big money figures; IBM Plex Mono for IDs. All self-hosted via @fontsource. `tabular-nums` on money and hours. Page title 24px, card title 16px, table 14px, form text 16px on phones and 14px from md.
- **Shape:** 4px grid; `rounded-lg` (10px) controls and buttons, `rounded-card` (16px) cards, full pills for badges and status.
- **Buttons:** the "Solid" style: flat fill with a 1px darker edge, no gradient and no glow; hover shifts the colour, press moves it 1px down; secondary is white with a hairline that turns teal on hover. Focus is the 2px brand outline.
- **Form controls:** inset hairline, soft 4px focus halo; native `<select>` gets a custom chevron (`select-control`). A richer listbox (icon, balance, share) is planned for account and partner pickers.
- **Motion:** 150ms colour changes, dialogs fade and scale in over a blurred backdrop (a phone sheet slides up), page heroes and grids rise in with `fade-up` (optional `--i` stagger), skeletons shimmer. All of it is switched off by `prefers-reduced-motion`.
- **Shell:** full-width header (brand, user, account actions) over a grouped, collapsible left sidebar (Overview, Workforce, Pay & leave, Administration; collapse state saved). Phones keep the bottom tab bar with a "More" sheet.
- **Kit:** `Button`, `IconButton`, `Card`/`CardHeader`, `PageHeader`, `StatCard`, `StatusBadge`, `Table` parts, `Input`/`Select`/`Textarea`/`Field`, `EmptyState`, `Skeleton`, plus `Dialog` and `ConfirmDialog`. Every page starts with `PageHeader`.
- **Status:** always icon + word + colour via `StatusBadge`; never colour alone.
- **Icons:** Lucide only, 16px inline / 18-20px actions; icon-only buttons need a label. No emoji.
- **Accessibility:** text contrast at least 4.5:1; visible focus ring on everything; touch targets at least 44px on phones (36px allowed from md in dense toolbars); visible labels; skip link; dialogs trap focus and close on Esc; `prefers-reduced-motion` respected.
- **Responsive:** wide tables scroll inside their card, never the page; below md, table rows become labelled cards.
- **Async:** every request has loading and error states; actions give feedback within 100 ms.
- **Printed/PDF payroll report** keeps its own black-and-white document styling.
