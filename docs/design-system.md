# Design system - HR & Payroll

Decided on 2026-10-19 using the ui-ux-pro-max rules. The client's `Design.html` prototype is the visual reference; these rules refine it. Every UI slice follows this file.

- **Product:** internal HR/payroll admin tool; data-dense tables and forms; mostly desktop, but must work at 375px.
- **Style:** flat, minimal corporate. No glass, gradients or heavy shadows (`shadow-sm` on cards only).
- **Colour (Tailwind defaults, as in the prototype):** shell `slate-900`, nav `slate-800`, page `gray-100`, surface `white`, border `gray-200`, text `gray-800`, muted `gray-500`, primary `blue-600` (hover `blue-700`), success `green-600`, danger `red-600`, warning `amber`. Status is never colour-only: badge text plus colour.
- **Type:** one family, the system UI stack (Tailwind default). Form text 16px; table text 14px (data-dense exception); headings `text-2xl` / `text-lg`.
- **Spacing and shape:** Tailwind 4px scale; `rounded-lg` for cards and inputs, `rounded-full` for badges and chips.
- **Icons:** Lucide (`lucide-react`), 16px inline / 20px for actions, always with visible text or an `aria-label`. Never emoji: the prototype's edit/delete/approve/reject emoji become Lucide icons.
- **Accessibility:** text contrast at least 4.5:1; every interactive element has a visible `focus-visible` outline; touch targets at least 44px (`min-h-11`); visible labels on inputs (not placeholders); error messages say what to fix; dialogs trap focus and close on Esc; Layout has a skip link.
- **Responsive:** design for 375px first; wide tables scroll inside their own container, never the page; the tab bar scrolls inside its bar.
- **Async:** every request shows a loading and an error state; every action gives feedback within 100 ms.
