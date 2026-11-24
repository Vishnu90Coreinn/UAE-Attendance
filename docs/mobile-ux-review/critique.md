# Mobile UX review — supervisor on Android, 390×844

**Reviewer stance:** first-time user of this app, no code read for the critique. I signed in as the supervisor test account, opened every page the supervisor's bottom bar offers, and walked its main task. Numbers marked *measured* come from the live DOM at 390×844 (DPR 2). Taps and scrolls are my own walk-throughs.

**Not tested (so not claimed):** saving a day, "Copy from yesterday", the Export menu, Sign out, offline behaviour, an on-screen keyboard. I discarded every edit I made, so no seed data changed.

**Persona used for judgement:** outdoors, glare, one hand, gloves or dusty fingers, 06:00 start, marking 15+ workers before work begins, patchy signal.

---

## 0. Cross-cutting problems (affect every page)

| # | Impact | Problem | Evidence |
|---|---|---|---|
| X1 | **Critical** | **Sign-in lands on Worker Directory, not on the daily task.** The supervisor's one daily job costs an extra tap every morning. | After login the URL was `/workers`. |
| X2 | High | **Permanent chrome is 125 px (15 % of the screen)** before any page bar. The top bar spends 60 px on a truncated company name ("DE AKS BE GLASS & ALUMINIUM CO….") that never changes, while the page title sits below it. | Header 60 px, bottom bar 65 px (*measured*). |
| X3 | High | **Every page opens with 500–700 px of preamble**: H1, a one-sentence subtitle, stat cards, filters. Content starts on the second screen. | First content top: Attendance 516, Workers 631, Leave 636, Progress 716 px. |
| X4 | High | **Lists are built from tall label/value cards, not rows.** One record costs 246–444 px, so a 12-person site is 5+ screens. | Attendance 246, Workers ~250, Leave ~330 (estimated from a screenshot), Progress floor 444 px. |
| X5 | High | **Two different "unsaved changes" patterns.** Attendance: white bar, "N unsaved changes", "Save day", a Discard-or-Cancel dialog on leaving. Progress: dark floating panel, "Unsaved changes", "Save report", instant Discard, no dialog. | Seen on both pages. |
| X6 | Medium | **Stat cards stack vertically** as three full-width cards (Workers, Leave). Three numbers cost ~210 px. | Workers 3 cards, Leave 3 cards. |
| X7 | Medium | **Subtitle sentences on every page** ("Record daily status and hours, then save the day.") repeat what the title already says. | 40–60 px each. |
| X8 | Medium | **Small hit areas for links.** Worker names are 20 px tall links, phone numbers 18 px. The rest of the card is dead. Material guidance is 48 px. | *Measured* on Workers. |
| X9 | Medium | **Raw error text** on a failed call: "Request failed (502)". A site supervisor can't act on that. | Seen when the API was still starting. |
| X10 | Low | **Page `<title>` shows mojibake** ("Worker Directory Â· DE AKS BE"), and the worker profile keeps the title "Worker Directory". | Browser tab title. |
| X11 | Medium | **No sign of offline protection.** A 12-mark attendance sheet lives only in memory; a reload or crash loses it (my forced navigation dropped 12 marks without a word). On a site with patchy signal this is the worst failure mode. | Observed loss on navigation; offline itself *not tested*. |
| X12 | Low | **Type is small for sunlight.** Worker names 16 px, IDs/roles 12 px. Contrast is fine (≥ 6:1 everywhere I measured), so size is the problem, not colour. | *Measured*. |

---

## 1. Daily Attendance — the task that matters

**Walk-through (12 site workers, 2 exceptions: 1 sick, 1 absent, plus 2 h overtime on one person)**

| Path | Taps | Scrolls | Notes |
|---|---|---|---|
| Today, all manual | 1 (nav) + 12 + 1 save = **14** | **≈ 5** (page 3,991 px = 5.5 screens) | Each worker needs a find-then-tap. |
| Best case: Mark all present first | 1 nav + 1 bulk + 2 exceptions + ~3 for overtime (+) + 1 save = **≈ 8** | **≈ 4–5**, because the list has no jump or filter to the exceptions | Bulk button sits 516 px down, so afterwards you scroll back up to reach it. |

At first load, **one** worker's Present/Absent buttons are visible; the other 11 are below the fold.

### Problems, ranked by impact

1. **Wasted space — 246 px per worker for a decision that is "Present" 90 % of the time.** Five equal buttons (Present, Absent, Annual, Sick, Emergency) in a 2-column grid, with "Emergency Leave" alone in a half row, plus Basic hours and an overtime stepper. 12 workers = 3,084 px, ~2.5 workers per screen. *(measured)*
2. **Preamble: the first 516 px has no workers.** Title, subtitle, date row, a 90-px policy banner, a 150-px summary/bulk card. On load only the very top of worker 1 shows.
3. **Risky action — "Mark all present" has no confirmation and no undo.** One stray tap marks everyone present; present means paid hours. It did correctly leave my Sick Leave mark alone, but the button then vanishes, so there is no way back except re-tapping 12 rows. It also lives at the top, far from the thumb.
4. **Unclear state — marked and unmarked rows look almost identical.** Selected Present is green, selected Sick Leave is dark grey, and an unrecorded worker is just a card with no fill. The only count of stragglers is a text line ("0 present · 0 absent · 0 on leave · 12 not recorded") that isn't tappable. To find the 3 you missed you scroll the whole list.
5. **Unclear consequence — the key rule is in a banner, not where the risk is.** "Not recorded means no hours are counted" is a static line at the top; the Save bar says "12 unsaved changes" (edits, not "9 of 12 marked") and lets you save with unmarked workers silently.
6. **Risky navigation — leaving with unsaved marks offers only Cancel or a red "Discard changes".** No "Save and leave". Cancel works, but a reload or back swipe on a flaky connection loses everything. There is no draft.
7. **Overtime and basic hours shown for everyone.** "Basic hours 8.00" (read-only) and a − / 0 / + stepper appear on every marked-present card. Overtime is the exception, and it needs one tap per hour.
8. **Rare statuses take two thirds of every card.** Three leave types per worker, when leave is usually already approved elsewhere and flows into this sheet.
9. **Date row has four controls** (‹, native date field, ›, Today) at similar weight. "Today" looks disabled when it is today; the next-day arrow is disabled and faint. Going back one day should be one obvious control, not the native calendar.
10. **Secondary actions share the first screen.** "Copy from yesterday" and "Export ⌄" are equal-weight neighbours of the main action. Export (several days) is a back-office job; Copy-from-yesterday is a bulk overwrite (not tested) placed one slip away from the safe action.
11. **Weak selected-state encoding.** Selected Present = green fill with ✓; selected leave = dark slate with no icon. Different grammar for the same control.
12. **Header duplicates the page.** App bar (company name), H1 "Daily Attendance", bottom-bar label "Attendance" and the document title all say the same thing; the date, which does change, is on the 4th line.
13. **No search or jump** to a worker. Fine at 12, painful at 25.
14. **Subtitle and policy copy** ("Record daily status and hours, then save the day.") adds a line users read once.

### Restructure (see mockup, frame 1)

- Land here after login; app bar shows the page and a **single date pill** `‹ Today · Tue 24 Nov ›` with an ⓘ for shift rules.
- Rows of **68 px**: name 17 px + role, then **✓ and ✕ as 52 px buttons**, then ⋯ for leave and overtime (bottom sheet).
- Marked rows are **tinted** (green / red / amber); unmarked rows stay white. A **sticky progress strip** "7 of 12 marked" with tappable filters: Unmarked · Present · Absent · Leave.
- **Thumb-zone action bar:** `Mark 5 present` (undo toast, only touches unmarked rows) + `Save`. Saving with unmarked workers asks once: "5 not marked get no hours today."
- Draft autosaved locally; the leave dialog gets "Save and leave".
- Expected cost for the same scenario: **≈ 5 taps, ≤ 1 scroll** (exceptions first: ✕ on one, ⋯→Sick on one, ⋯ +2 h, then Mark rest present, then Save).

---

## 2. Worker Directory (the page supervisors land on)

**Walk-through:** find a worker and call them: scroll ~2 screens (page 4,308 px = 5 screens for 14 people) + tap the name + scroll to Contact + tap the number = **3 taps, ~3 scrolls**. By search: tap the field, type, tap the 20-px name link, scroll = **3 taps + typing**.

### Problems

1. **Wrong landing page** (see X1): a reference list is the home screen of a daily-action role.
2. **Wasted space — three stat cards ≈ 210 px**, for Total 14, Active 14, Onboarding open 9. Total equals Active, and "Onboarding open" is an HR concern. *(measured: first worker at 650 px)*
3. **Wasted space — 250-px cards.** Name, ID, Role, Onboarding bar, Status, sometimes Contact: 14 workers = 3,588 px.
4. **Filter block is ≈ 236 px** (search, two native selects, a checkbox) with the default "Workers and office staff", so a site supervisor sees the accountant and office staff by default.
5. **Tiny hit areas:** the name is the only link (20 px tall), phone numbers 18 px. Tapping the card does nothing.
6. **Noise, not information:** every row shows an "Active" chip (all are) and an Onboarding "0/6" bar that is the same grey on nine workers.
7. **Inconsistent cards.** Employee1–3 have three rows; Verify Tester has an Emirates ID, contact, email, department and site. Card height jumps from 240 to 360 px, so scanning is rhythmless.
8. **Privacy:** the full Emirates ID is printed in the list. Anyone glancing at a supervisor's phone on site reads it.
9. **No quick action.** Phone exists only on some cards and isn't a button. Nothing like Call or WhatsApp.
10. **Search placeholder is truncated** ("Search by name, ID, Emirates ID, pho…") and search scrolls away with the page.
11. **Nothing sticky.** After 4,000 px of scrolling there is no way to the top and the filters.
12. Sorting buttons (ID, WORKER, ROLE…) are in the DOM from the desktop table but not usable on a phone.

### Restructure (mockup, frame 2)
One sticky search + one row of chips (All / Site / Office / Inactive). Rows of 68 px: initials, name, role · site, and a **48-px call button**. Whole row opens the profile. Stats collapse into one caption line. Emirates ID is not shown in the list.

---

## 3. Worker Profile

**Walk-through:** from the directory, tap name → read role/phone → scroll to Contact (1 tap, 1–2 scrolls); to reach their leave: 1 more tap on the Leave tab. Page = 1,224 px.

### Problems

1. **The most sensitive data comes first.** Personal (nationality, Emirates ID, passport) is above Contact and Work, in plain text.
2. **The phone number is not a button** and sits below the fold; a supervisor opens a profile mainly to call.
3. **Empty hero:** a 70-px gradient strip plus a generic avatar block spend ~200 px on decoration.
4. **Stacked label/value pairs** use two lines each plus 22-px gaps; four personal fields take ~280 px.
5. **No attendance information.** The question "how has this person been this month?" is the one a supervisor has, and the only tabs are Overview, Onboarding, Leave.
6. **"Onboarding" tab is an HR task** shown to a supervisor with no cue it is read-only.
7. **Back link is small text** ("← All workers", 14 px) in the top-left corner, the hardest reach on a large phone.
8. **Status "Active" is a tiny chip** while Role, ID, Site and department share one wrapped line ("EMP-005 · Glass Fixer · Installation · Abudhabi lane").
9. **Document title stays "Worker Directory"** on a profile (X10).
10. **No tap-to-copy** for Emirates ID / passport / phone.

### Restructure (mockup, frame 3)
Compact identity header with **Call / WhatsApp / Mark today** buttons; Work section first; a "This month" attendance strip; Emirates ID and passport masked with "Show".

---

## 4. Leave Management

**Walk-through:** add a leave request: scroll up if needed + tap New Leave Request + pick worker (native list of 14, no search) + pick type + 2 dates + Submit = **~7 taps** (dates default to today). Check what is pending: ~2 scrolls to reach the list (page 3,611 px).

### Problems

1. **Needs-attention is buried.** The list is sorted by start date, not by need: an approved request for 1 Dec is first, the two pending ones follow. Pending is the only state someone might act on.
2. **640 px before the first request:** title, two-line subtitle, CTA, three stat cards (~210 px), two selects, a collapsed report card.
3. **Stat cards waste space and mix units.** "Pending requests 2", "Approved days 5", "Rejected requests 0": requests, days and requests. A zero-card gets a full row.
4. **Request cards are ~330 px** for six label/value rows (type, start, end, days, status, photo). Start and end are separate rows; "Photo: None" is a dead row.
5. **Status is the fifth row.** The one fact (Pending / Approved) is below four others.
6. **Dead-end pending state for a supervisor.** The pending cards show no action and no "waiting for whom?".
7. **CTA is a left-aligned half-width button at the top** — not in thumb range and it scrolls away.
8. **Filters look duplicated.** Two native selects (status, worker) sit below stat cards that look like filters but are separate.
9. **"Monthly leave report" takes an 80-px card** with helper text ("follows the worker chosen above") that needs thought before use; it is a manager/HR job.
10. **New-request form: no worker search, and two date fields both default to today** with no day count until after submit. Heading copy ("Days are inclusive calendar days. Once approved, leave fills Daily Attendance…") is three lines before the first field.
11. **Photo upload shown while "Annual Leave" is selected** ("Leave document photo (optional)") — worth confirming it is meant to be sick-only, given the latest change.
12. **Dates written long form on separate rows** ("25 Nov 2026", "28 Nov 2026") instead of "25–28 Nov · 4 days".

### Restructure (mockup, frames 4–5)
Group by need: **"Needs a decision · 2"** first. Cards of ~96 px: name, type chip, "25–28 Nov · 4 days", status chip. Floating **+ New request** in the thumb zone. Form as a full sheet: type as three segmented buttons, one date-range line with a live day count, note upload only for Sick.

---

## 5. Site Progress

**Walk-through:** update one floor's three statuses and a count: scroll ~2 (first floor top at 716 px) + ~3 taps per select (open, choose) × 3 + type a count + Save report = **≈ 12 taps, 2 scrolls per floor**. Page: 1,647 px for only two floors; ten floors ≈ 5,000 px.

### Problems

1. **One floor = 444 px, about a screen.** Name, three unlabeled counts, three full-width selects, a notes box.
2. **Six taps to set three statuses.** Each native select is an open + choose pair; they could be three-segment buttons, one tap each.
3. **Delete sits 4 px from Edit** (both 44×44), a red trash next to a pencil, and deleting a floor happens **instantly** (staged, not confirmed). The only warning is a dark bar saying "Unsaved changes", not "1 floor removed".
4. **Pencil is ambiguous.** The fields are already editable inline, so what does Edit do?
5. **Three counts with no meaning.** FRAMES / FIXED GLASS / SHUTTERS show 26, 26, 26 with no "of N", unit, or +/−. Typing a number brings up the keyboard, which will cover the field.
6. **Unsaved pattern differs from Attendance** (X5), and the dark panel overlaps the WIR select it should help with.
7. **Hero card is ≈ 190 px** ("Site handover ready 50%" plus "Show details") above the first floor, repeating what the floor cards show.
8. **Exports first.** PDF and CSV buttons sit above the project selector; they are the least frequent action on the page.
9. **Stale data isn't flagged.** "Last updated by admin on 12 Nov 2026, 18:05" is plain gray text; twelve days old is the headline for a site-progress page.
10. **Three similar tints** (green, blue, amber) on three different dimensions make the floors hard to compare at a glance; there is no single floor status.
11. **Filter block (≈ 120 px)** for a list of two: search, Filters, and a primary-coloured Add floor equal in weight to Save.
12. **Notes box has no label** (a stray raw string "dfgdfg" shows as a grey box).
13. **Names read inconsistently** ("First Floor", "2 nd Floor").

### Restructure (mockup, frame 6)
Compact summary strip, floors as **accordion rows** (76 px: name + three status pills), expanding to steppers and **segmented controls** (one tap each). Export, Add floor and Delete (with confirm) go in overflow menus. Same sticky action bar pattern as Attendance. A "12 days old" warning chip beside the update time.

---

## 6. HR Letters

**Walk-through:** ask HR for a certificate: tap New request (3 rows of chips down) + worker select + (certificate preselected) + optional note + Send = **4–5 taps**. Check status: **horizontal scroll** to find it.

### Problems

1. **A desktop table on a phone.** The table is 738 px wide in a 356-px viewport. **Status starts at x = 422, off-screen.** Reference and Actions are further right. The most useful column needs a swipe.
2. **Worker column breaks into four lines** ("Rajesh / Nair / (EMP- / 008)").
3. **"10 Nov 2026 by superv…" is cut off**; the requester is unreadable.
4. **Filter chips wrap to three rows (≈ 130 px)** and four of five read "0". The five chips use hard-to-tell jargon (Requested, Awaiting approval, Returned by manager, Approved).
5. **"Returned by manager" is a to-do** and gets the same weight as zero-count states.
6. **New request is three rows down**, left-aligned, out of thumb range.
7. **Certificate preselected as "Salary Certificate"** — the sensitive option as the default invites a wrong submit.
8. **Worker picker is a native select** of 14 names (no search).
9. **No action shown for an approved letter** without scrolling sideways; the supervisor sees "Approved" only after a swipe.
10. **Mostly empty screen** below the single row; no hint what happens next ("HR will respond within…").
11. **Title and subtitle repeat the nav label** ("HR Letters" / "Ask HR for a certificate…").

### Restructure (mockup, frame 7)
Cards, not a table: worker, certificate, a **status chip at the top-right**, "Requested 10 Nov by you", reference. One row of three chips with counts (Needs me, In progress, Done). Floating New request. Certificate has no default.

---

## 7. Sign-in and account sheet (brief)

- Sign-in is clean: two fields, a 44-px field, show-password toggle. It rendered nearly blank for about a second (fade-in) on a cold load. Error text was "Request failed (502)" (X9).
- The account bottom sheet (Change password / Sign out) is well formed. Sign out is one tap; I did not test a confirmation.

---

## Priority order if you only do five things

1. Land on Attendance (X1) and rebuild attendance rows to ≈ 68 px with ✓ / ✕ and ⋯ (Attendance 1–2).
2. Make marked vs unmarked obvious, add the undoable "Mark rest present" and a pre-save check (Attendance 3–6).
3. Draft-save marks locally (X11, Attendance 6).
4. Turn the Letters table and Leave/Workers cards into compact rows with status first (Letters 1, Leave 1–5, Workers 3).
5. Unify the unsaved bar and make Progress statuses one-tap segmented controls (X5, Progress 2–6).
