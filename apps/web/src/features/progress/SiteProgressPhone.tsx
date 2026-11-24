import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, Clock, Loader, Lock, LockOpen, Minus, Pencil, Plus, Save, Send, Trash2, Undo2, XCircle, type LucideIcon } from "lucide-react";
import {
  ALIGNMENT_OPTIONS,
  COMPLETION_OPTIONS,
  WIR_OPTIONS,
  type Alignment,
  type Completion,
  type SiteFloor,
  type SiteKpis,
  type WirStatus,
} from "../../api/siteProgress";
import { RowMenu } from "../../ui";
import { phoneButton } from "../../components/phoneUi";
import type { FloorRow } from "./FloorList";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

/** Short wording for the chips on a collapsed row; the full labels stay on the controls themselves. */
const ALIGNMENT_SHORT: Record<Alignment, string> = { NotComplete: "Not aligned", UnderProcess: "Aligning", Complete: "Aligned" };
const COMPLETION_SHORT: Record<Completion, string> = { NotStarted: "Not started", InProgress: "In progress", Completed: "Completed" };
const WIR_SHORT: Record<WirStatus, string> = {
  Pending: "WIR not sent",
  Submitted: "WIR submitted",
  AlignmentNotComplete: "WIR: not aligned",
  AlignmentUnderProcess: "WIR: aligning",
  AlignmentComplete: "WIR: aligned",
  Approved: "WIR approved",
  ApprovedWithComments: "WIR approved, notes",
  Rejected: "WIR rejected",
};

const NEUTRAL = "bg-ink-100 text-ink-700";
const ACTIVE = "bg-amber-100 text-amber-900";
const DONE = "bg-brand-100 text-brand-800";
const BAD = "bg-red-100 text-red-800";
const INFO = "bg-sky-100 text-sky-900";

function Chip({ tone, icon: Icon, children }: { tone: string; icon: LucideIcon; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      <Icon aria-hidden="true" size={12} strokeWidth={2.5} />
      {children}
    </span>
  );
}

/** Each status is an icon, a word and a tint, so it is never colour alone. */
function FloorChips({ floor }: { floor: SiteFloor }) {
  const alignment = floor.alignment;
  const completion = floor.completion;
  const wir = floor.wirStatus;
  const wirDone = wir === "Approved" || wir === "ApprovedWithComments";
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      <Chip tone={alignment === "Complete" ? DONE : alignment === "UnderProcess" ? ACTIVE : NEUTRAL} icon={alignment === "Complete" ? CheckCircle2 : alignment === "UnderProcess" ? Loader : CircleDashed}>
        {ALIGNMENT_SHORT[alignment]}
      </Chip>
      <Chip tone={completion === "Completed" ? DONE : completion === "InProgress" ? ACTIVE : NEUTRAL} icon={completion === "Completed" ? CheckCircle2 : completion === "InProgress" ? Loader : CircleDashed}>
        {COMPLETION_SHORT[completion]}
      </Chip>
      <Chip tone={wirDone ? DONE : wir === "Rejected" ? BAD : wir === "Submitted" ? INFO : NEUTRAL} icon={wirDone ? CheckCircle2 : wir === "Rejected" ? XCircle : wir === "Submitted" ? Send : Clock}>
        {WIR_SHORT[wir]}
      </Chip>
    </span>
  );
}

/** The headline: how much of the building is ready to hand over, with what has been installed so far. */
export function HandoverCard({ kpis, floorCount }: { kpis: SiteKpis; floorCount: number }) {
  return (
    <section aria-label="Handover" className="rounded-3xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-end justify-between gap-4">
        <div role="group" aria-label="Site handover ready">
          <p className="text-sm font-semibold text-ink-700">Ready for handover</p>
          <p className="mt-1 text-4xl font-bold leading-none tabular-nums text-ink-900">{kpis.handoverReadyPercent}%</p>
        </div>
        <p className="max-w-[10rem] pb-0.5 text-right text-xs leading-snug text-ink-600">
          Completed and WIR approved, of {floorCount} {floorCount === 1 ? "floor" : "floors"}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Site handover ready"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={kpis.handoverReadyPercent}
        className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100"
      >
        <div className="h-full origin-left rounded-full bg-brand-600 transition-transform duration-300 ease-out" style={{ width: "100%", transform: `scaleX(${kpis.handoverReadyPercent / 100})` }} />
      </div>
      <dl role="group" aria-label="Installed" className="mt-4 grid grid-cols-3 gap-2">
        {(
          [
            ["Frames", kpis.totalFrames],
            ["Fixed glass", kpis.totalGlass],
            ["Shutters", kpis.totalShutters],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col-reverse items-center rounded-2xl bg-ink-50 px-1 py-2.5 text-center">
            <dt className="text-xs font-medium text-ink-700">{label}</dt>
            <dd className="text-xl font-bold leading-tight tabular-nums text-ink-900">{value.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A whole-number count with minus and plus either side. Typing is allowed; anything but digits is ignored. */
function CountStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const button = `grid size-12 shrink-0 place-items-center rounded-xl border border-ink-300 bg-white text-ink-900 active:bg-ink-100 ${focusRing} disabled:opacity-40`;
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} className={button}>
        <Minus aria-hidden="true" size={20} />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={String(value)}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 7);
          onChange(digits === "" ? 0 : Number(digits));
        }}
        className={`min-h-12 w-16 min-w-0 rounded-xl border border-ink-300 bg-white text-center text-lg font-bold tabular-nums text-ink-900 ${focusRing}`}
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)} className={button}>
        <Plus aria-hidden="true" size={20} />
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  short,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  short: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 rounded-2xl bg-ink-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-12 rounded-xl px-1 text-sm font-semibold leading-tight transition-colors duration-150 ${focusRing} ${
            value === option.value ? "bg-brand-700 text-white" : "text-ink-800 active:bg-white"
          }`}
        >
          {short[option.value]}
        </button>
      ))}
    </div>
  );
}

const fieldLabel = "mb-1.5 block text-xs font-bold uppercase tracking-wide text-ink-600";

interface FloorAccordionProps {
  rows: FloorRow[];
  canEdit: boolean;
  /** Managers and the Administrator may lock and unlock floors. */
  canLock: boolean;
  onChange: (index: number, patch: Partial<SiteFloor>) => void;
  /** Opens the dialog to rename the floor (everything else is edited in place). */
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  /** Told when the site note gains or loses focus, so the page can keep its save bar out of the way of the keyboard. */
  onNoteFocus?: (active: boolean) => void;
}

/**
 * The floors as one grouped list. A row shows the floor with its three statuses; tapping it (the pencil says it can be
 * changed) opens everything in place: counts with plus and minus, a tap each for alignment and completion, the inspection,
 * and the site note. Updating a floor and saying why is one visit, with no second form. One floor is open at a time.
 */
export function FloorAccordion({ rows, canEdit, canLock, onChange, onEdit, onDelete, onNoteFocus }: FloorAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <ul aria-label="Floors" className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
      {rows.map((row) => {
        const f = row.floor;
        const open = openIndex === row.index;
        const editable = canEdit && !f.isLocked;
        const panelId = `floor-panel-${row.index}`;
        const menuItems = [
          ...(editable ? [{ label: "Rename floor", icon: Pencil, onSelect: () => onEdit(row.index) }] : []),
          ...(canLock && !f.isLocked ? [{ label: "Lock floor", icon: Lock, onSelect: () => onChange(row.index, { isLocked: true }) }] : []),
          ...(editable
            ? [
                {
                  label: "Delete floor",
                  icon: Trash2,
                  danger: true,
                  onSelect: () => {
                    setOpenIndex(null);
                    onDelete(row.index);
                  },
                },
              ]
            : []),
        ];
        return (
          <li key={f.floor} aria-label={f.floor} className="scroll-mt-[4.5rem]">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={`${f.floor}${f.isLocked ? " (locked)" : ""}`}
              onClick={(event) => {
                const item = event.currentTarget.closest("li");
                setOpenIndex(open ? null : row.index);
                // Bring the floor you opened to the top, so its controls are in view rather than below the fold.
                if (!open) requestAnimationFrame(() => item?.scrollIntoView?.({ block: "start" }));
              }}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ink-50 ${focusRing}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-base font-semibold leading-snug text-ink-900">
                  <span className="break-words">{f.floor}</span>
                  {f.isLocked && <Lock aria-hidden="true" size={14} className="shrink-0 text-ink-600" />}
                </span>
                <FloorChips floor={f} />
                {!open && f.remarks && <span className="mt-1.5 block truncate text-xs text-ink-600">{f.remarks}</span>}
              </span>
              {/* A pencil says "you can change this"; people who cannot edit (or a locked floor) get a plain arrow. */}
              {editable && !open ? (
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-700">
                  <Pencil size={16} />
                </span>
              ) : (
                <ChevronDown aria-hidden="true" size={20} className={`shrink-0 text-ink-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              )}
            </button>

            {open && (
              <div id={panelId} className="space-y-4 border-t border-ink-100 bg-ink-50 px-4 pb-4 pt-4">
                {f.isLocked && (
                  <div className="flex items-start gap-2 rounded-2xl bg-white px-3 py-2.5 text-sm text-ink-800">
                    <Lock aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-ink-600" />
                    <p className="min-w-0 flex-1">
                      {canLock ? "This floor is locked. Unlock it to make changes." : "A manager locked this floor. Ask them to unlock it to make changes."}
                    </p>
                    {canLock && (
                      <button
                        type="button"
                        aria-label={`Unlock ${f.floor}`}
                        onClick={() => onChange(row.index, { isLocked: false })}
                        className={phoneButton("primary", "sm", "shrink-0")}
                      >
                        <LockOpen aria-hidden="true" size={16} />
                        Unlock
                      </button>
                    )}
                  </div>
                )}

                {editable ? (
                  <>
                    <div className="space-y-2">
                      <span className={fieldLabel}>Installed so far</span>
                      {(
                        [
                          ["frames", "Frames"],
                          ["glass", "Fixed glass"],
                          ["shutters", "Shutters"],
                        ] as const
                      ).map(([key, name]) => (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-ink-800">{name}</span>
                          <CountStepper label={`${f.floor} ${name.toLowerCase()}`} value={f[key]} onChange={(value) => onChange(row.index, { [key]: value })} />
                        </div>
                      ))}
                    </div>
                    <div>
                      <span className={fieldLabel}>Alignment</span>
                      <Segmented label={`${f.floor} alignment`} value={f.alignment} options={ALIGNMENT_OPTIONS} short={ALIGNMENT_SHORT} onChange={(value) => onChange(row.index, { alignment: value })} />
                    </div>
                    <div>
                      <span className={fieldLabel}>Completion</span>
                      <Segmented label={`${f.floor} completion`} value={f.completion} options={COMPLETION_OPTIONS} short={COMPLETION_SHORT} onChange={(value) => onChange(row.index, { completion: value })} />
                    </div>
                    <div>
                      <label htmlFor={`wir-${row.index}`} className={fieldLabel}>
                        WIR inspection
                      </label>
                      <select
                        id={`wir-${row.index}`}
                        aria-label={`${f.floor} WIR status`}
                        value={f.wirStatus}
                        onChange={(event) => onChange(row.index, { wirStatus: event.target.value as WirStatus })}
                        className={`min-h-12 w-full rounded-xl border border-ink-300 bg-white px-3 text-base font-semibold text-ink-900 ${focusRing}`}
                      >
                        {WIR_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`note-${row.index}`} className={fieldLabel}>
                        Site note
                      </label>
                      <textarea
                        id={`note-${row.index}`}
                        aria-label={`${f.floor} site note`}
                        rows={3}
                        maxLength={500}
                        value={f.remarks}
                        placeholder="Say what changed, or what is holding this floor up"
                        onChange={(event) => onChange(row.index, { remarks: event.target.value })}
                        onFocus={() => onNoteFocus?.(true)}
                        onBlur={() => onNoteFocus?.(false)}
                        className={`block w-full resize-none rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-500 ${focusRing}`}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <dl className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["Frames", f.frames],
                          ["Fixed glass", f.glass],
                          ["Shutters", f.shutters],
                        ] as const
                      ).map(([name, value]) => (
                        <div key={name} className="flex flex-col-reverse items-center rounded-2xl bg-white px-1 py-2.5 text-center">
                          <dt className="text-xs font-medium text-ink-700">{name}</dt>
                          <dd className="text-xl font-bold tabular-nums text-ink-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {f.remarks && <p className="break-words rounded-2xl bg-white px-3 py-2.5 text-sm text-ink-800">{f.remarks}</p>}
                  </>
                )}

                <div className="flex items-center gap-2 border-t border-ink-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(null)}
                    className={phoneButton("primary", "md", "flex-1")}
                  >
                    Done
                  </button>
                  {menuItems.length > 0 && <RowMenu label={`More actions for ${f.floor}`} items={menuItems} />}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Floats above the tab bar only while the report has unsaved edits. */
export function ProgressSaveBar({
  changed,
  saving,
  canSave,
  onDiscard,
  onSave,
}: {
  /** How many floors differ from the saved report. */
  changed: number;
  saving: boolean;
  canSave: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 rounded-2xl border border-line bg-white p-2 pl-4 shadow-pop">
      <p role="status" className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
        {changed} {changed === 1 ? "floor" : "floors"} changed
      </p>
      <button
        type="button"
        onClick={onDiscard}
        aria-label="Discard changes"
        disabled={saving}
        className={phoneButton("secondary", "md", "px-4")}
      >
        <Undo2 aria-hidden="true" size={16} />
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        aria-label="Save report"
        disabled={saving || !canSave}
        aria-busy={saving}
        className={phoneButton("primary", "md")}
      >
        <Save aria-hidden="true" size={18} />
        Save
      </button>
    </div>
  );
}
