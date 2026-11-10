import { Pencil, Trash2 } from "lucide-react";
import {
  ALIGNMENT_OPTIONS,
  COMPLETION_OPTIONS,
  WIR_OPTIONS,
  type Alignment,
  type Completion,
  type SiteFloor,
  type WirStatus,
} from "../../api/siteProgress";
import { IconButton, cx } from "../../ui";
import { AlignmentBadge, CompletionBadge, WirBadge } from "./FloorStatus";

export interface FloorRow {
  floor: SiteFloor;
  /** Position in the full (unfiltered) report, used by the edit and delete actions. */
  index: number;
}

interface FloorListProps {
  rows: FloorRow[];
  desktop: boolean;
  canEdit: boolean;
  /** Changes one or more fields of a floor in the draft; nothing is stored until the report is saved. */
  onChange: (index: number, patch: Partial<SiteFloor>) => void;
  /** Opens the dialog for the floor name and remarks. */
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

const GREEN = "border-emerald-200 bg-emerald-50 text-emerald-800";
const TEAL = "border-teal-200 bg-teal-50 text-teal-800";
const SKY = "border-sky-200 bg-sky-50 text-sky-800";
const SLATE = "border-slate-200 bg-slate-50 text-slate-700";
const AMBER = "border-amber-200 bg-amber-50 text-amber-800";
const ROSE = "border-rose-200 bg-rose-50 text-rose-800";

const ALIGNMENT_TONE: Record<Alignment, string> = { Complete: GREEN, UnderProcess: SKY, NotComplete: SLATE };
const COMPLETION_TONE: Record<Completion, string> = { Completed: GREEN, InProgress: SKY, NotStarted: SLATE };
const WIR_TONE: Record<WirStatus, string> = {
  Approved: GREEN,
  ApprovedWithComments: TEAL,
  Submitted: SKY,
  Rejected: ROSE,
  Pending: AMBER,
  AlignmentNotComplete: AMBER,
  AlignmentUnderProcess: AMBER,
  AlignmentComplete: AMBER,
};

/** A status chosen right in the row. The words are always shown, and the tint only reinforces them. */
function StatusSelect<T extends string>({
  label,
  value,
  options,
  tone,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  tone: string;
  onChange: (value: T) => void;
}) {
  const shown = options.find((o) => o.value === value)?.label ?? value;
  return (
    <>
      <span className="hidden text-sm font-medium print:inline">{shown}</span>
      <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(
        "h-11 w-full cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 md:h-9 print:hidden",
        tone,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    </>
  );
}

/** A whole-number count typed in place. Anything that is not a digit is ignored, so it can never be invalid. */
function CountInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <>
      <span className="hidden font-bold tabular-nums print:inline">{value}</span>
      <input
      aria-label={label}
      inputMode="numeric"
      value={String(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
        onChange(digits === "" ? 0 : Number(digits));
      }}
      className="h-11 w-full min-w-14 rounded-xl border border-slate-300 bg-slate-50 text-center text-sm font-bold tabular-nums text-slate-900 transition-colors hover:border-slate-400 focus:bg-white focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-500/30 md:h-9 md:w-16 print:hidden"
    />
    </>
  );
}

function Actions({ row, onEdit, onDelete }: { row: FloorRow } & Pick<FloorListProps, "onEdit" | "onDelete">) {
  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton icon={Pencil} label={`Edit ${row.floor.floor}`} onClick={() => onEdit(row.index)} />
      <IconButton icon={Trash2} tone="danger" label={`Delete ${row.floor.floor}`} onClick={() => onDelete(row.index)} />
    </div>
  );
}

const th = "px-3 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500";

/**
 * The floors. Editors change counts and statuses directly in the row; the pencil is for the name and remarks. Others
 * see read-only badges. A table on desktop and tablet, one card per floor on a phone.
 */
export function FloorList({ rows, desktop, canEdit, onChange, onEdit, onDelete }: FloorListProps) {
  if (!desktop) {
    return (
      <ul className="space-y-3">
        {rows.map((row) => {
          const f = row.floor;
          return (
            <li key={f.floor} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words text-base font-bold text-slate-900">{f.floor}</h3>
                {canEdit && <Actions row={row} onEdit={onEdit} onDelete={onDelete} />}
              </div>
              {canEdit ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["frames", "Frames"],
                        ["glass", "Fixed glass"],
                        ["shutters", "Shutters"],
                      ] as const
                    ).map(([key, name]) => (
                      <div key={key}>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{name}</p>
                        <CountInput label={`${f.floor} ${name.toLowerCase()}`} value={f[key]} onChange={(v) => onChange(row.index, { [key]: v })} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Alignment</p>
                    <StatusSelect label={`${f.floor} alignment`} value={f.alignment} options={ALIGNMENT_OPTIONS} tone={ALIGNMENT_TONE[f.alignment]} onChange={(v) => onChange(row.index, { alignment: v })} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Completion</p>
                    <StatusSelect label={`${f.floor} completion`} value={f.completion} options={COMPLETION_OPTIONS} tone={COMPLETION_TONE[f.completion]} onChange={(v) => onChange(row.index, { completion: v })} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">WIR status</p>
                    <StatusSelect label={`${f.floor} WIR status`} value={f.wirStatus} options={WIR_OPTIONS} tone={WIR_TONE[f.wirStatus]} onChange={(v) => onChange(row.index, { wirStatus: v })} />
                  </div>
                </div>
              ) : (
                <>
                  <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    {(
                      [
                        ["Frames", f.frames],
                        ["Fixed glass", f.glass],
                        ["Shutters", f.shutters],
                      ] as const
                    ).map(([name, value]) => (
                      <div key={name}>
                        <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{name}</dt>
                        <dd className="text-lg font-bold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <AlignmentBadge status={f.alignment} />
                    <CompletionBadge status={f.completion} />
                    <WirBadge status={f.wirStatus} />
                  </div>
                </>
              )}
              {f.remarks && <p className="mt-3 break-words rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{f.remarks}</p>}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className={th}>Floor</th>
            <th scope="col" className={cx(th, "text-center")}>Frames</th>
            <th scope="col" className={cx(th, "text-center")}>Fixed glass</th>
            <th scope="col" className={cx(th, "text-center")}>Shutters</th>
            <th scope="col" className={th}>Alignment</th>
            <th scope="col" className={th}>Completion</th>
            <th scope="col" className={th}>WIR status</th>
            <th scope="col" className={th}>Site remarks</th>
            {canEdit && (
              <th scope="col" className={cx(th, "text-right print:hidden")}>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const f = row.floor;
            return (
              <tr key={f.floor} className="transition-colors hover:bg-slate-50/70">
                <th scope="row" className="px-3 py-3 text-left text-sm font-bold text-slate-900">{f.floor}</th>
                {canEdit ? (
                  <>
                    <td className="px-3 py-3 text-center"><CountInput label={`${f.floor} frames`} value={f.frames} onChange={(v) => onChange(row.index, { frames: v })} /></td>
                    <td className="px-3 py-3 text-center"><CountInput label={`${f.floor} fixed glass`} value={f.glass} onChange={(v) => onChange(row.index, { glass: v })} /></td>
                    <td className="px-3 py-3 text-center"><CountInput label={`${f.floor} shutters`} value={f.shutters} onChange={(v) => onChange(row.index, { shutters: v })} /></td>
                    <td className="min-w-44 px-3 py-3"><StatusSelect label={`${f.floor} alignment`} value={f.alignment} options={ALIGNMENT_OPTIONS} tone={ALIGNMENT_TONE[f.alignment]} onChange={(v) => onChange(row.index, { alignment: v })} /></td>
                    <td className="min-w-36 px-3 py-3"><StatusSelect label={`${f.floor} completion`} value={f.completion} options={COMPLETION_OPTIONS} tone={COMPLETION_TONE[f.completion]} onChange={(v) => onChange(row.index, { completion: v })} /></td>
                    <td className="min-w-52 px-3 py-3"><StatusSelect label={`${f.floor} WIR status`} value={f.wirStatus} options={WIR_OPTIONS} tone={WIR_TONE[f.wirStatus]} onChange={(v) => onChange(row.index, { wirStatus: v })} /></td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-3 text-center font-bold tabular-nums">{f.frames}</td>
                    <td className="px-3 py-3 text-center font-bold tabular-nums">{f.glass}</td>
                    <td className="px-3 py-3 text-center font-bold tabular-nums">{f.shutters}</td>
                    <td className="px-3 py-3"><AlignmentBadge status={f.alignment} /></td>
                    <td className="px-3 py-3"><CompletionBadge status={f.completion} /></td>
                    <td className="px-3 py-3"><WirBadge status={f.wirStatus} /></td>
                  </>
                )}
                <td className="max-w-64 break-words px-3 py-3 text-slate-600">{f.remarks || "-"}</td>
                {canEdit && (
                  <td className="px-3 py-3 print:hidden">
                    <Actions row={row} onEdit={onEdit} onDelete={onDelete} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
