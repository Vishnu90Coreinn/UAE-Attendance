import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Layers, LayoutGrid, PanelTop, type LucideIcon } from "lucide-react";
import type { SiteKpis } from "../../api/siteProgress";
import { cx } from "../../ui";

interface SummaryBarProps {
  kpis: SiteKpis;
  /** Floors in the report, so the handover figure reads as "of N floors". */
  floorCount: number;
}

/** One headline figure: label and a big number, with a tinted icon chip. Colour carries meaning; the label always names it. */
function Kpi({ label, value, icon: Icon, chip, number }: { label: string; value: number; icon: LucideIcon; chip: string; number: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <dl className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className={cx("mt-1.5 text-3xl font-extrabold leading-none tabular-nums", number)}>{value.toLocaleString("en-US")}</dd>
      </dl>
      <span className={cx("shrink-0 rounded-xl p-2.5", chip)}>
        <Icon aria-hidden="true" size={18} />
      </span>
    </div>
  );
}

/** A count with its label as a rounded pill, e.g. "Approved 3". Faded when the count is zero so the live ones stand out. */
function Pill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-full border px-3 py-1 text-xs", tone, value === 0 && "opacity-60")}>
      <dt className="font-medium">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function PillGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-wrap items-center gap-2">
      <h3 className="mr-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="flex flex-wrap gap-2">{children}</dl>
    </div>
  );
}

const GREEN = "border-emerald-200 bg-emerald-50 text-emerald-800";
const SKY = "border-sky-200 bg-sky-50 text-sky-800";
const SLATE = "border-slate-200 bg-slate-50 text-slate-700";
const AMBER = "border-amber-200 bg-amber-50 text-amber-800";
const ROSE = "border-rose-200 bg-rose-50 text-rose-800";

/**
 * The report's figures: a handover headline and five coloured figures, then alignment and WIR as pills. On a phone only
 * the handover headline shows until "Show details" is opened; printing always shows everything.
 */
export function SummaryBar({ kpis, floorCount }: SummaryBarProps) {
  const [open, setOpen] = useState(false);
  const detail = cx(open ? "grid" : "hidden", "md:grid print:grid");
  return (
    <div className="payroll-summary mb-5 space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <div className="col-span-2 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white shadow-sm xl:col-span-1">
          <div role="group" aria-label="Site handover ready">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-brand-100">Site handover ready</h3>
            <p className="mt-1.5 text-4xl font-extrabold leading-none tabular-nums">{kpis.handoverReadyPercent}%</p>
            <div
              role="progressbar"
              aria-label="Site handover ready"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={kpis.handoverReadyPercent}
              className="mt-3 h-2 overflow-hidden rounded-full bg-white/25"
            >
              <div className="h-full rounded-full bg-white" style={{ width: `${kpis.handoverReadyPercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-brand-100">
              Completed and WIR approved, of {floorCount} {floorCount === 1 ? "floor" : "floors"}
            </p>
          </div>
          <button
            type="button"
            className="payroll-controls mt-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-white/15 text-sm font-medium text-white hover:bg-white/25 md:hidden"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide details" : "Show details"}
            <ChevronDown aria-hidden="true" size={16} className={cx("transition-transform", open && "rotate-180")} />
          </button>
        </div>

        <div role="group" aria-label="Installed" className={cx(detail, "col-span-2 grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-5 xl:grid-cols-5")}>
          <Kpi label="Frames" value={kpis.totalFrames} icon={LayoutGrid} chip="bg-blue-50 text-blue-600" number="text-slate-900" />
          <Kpi label="Fixed glass" value={kpis.totalGlass} icon={PanelTop} chip="bg-sky-50 text-sky-600" number="text-slate-900" />
          <Kpi label="Shutters" value={kpis.totalShutters} icon={Layers} chip="bg-violet-50 text-violet-600" number="text-slate-900" />
          <Kpi label="Floors done" value={kpis.completedFloors} icon={CheckCircle2} chip="bg-emerald-50 text-emerald-600" number="text-emerald-600" />
          <Kpi label="Not started" value={kpis.noProgressFloors} icon={AlertTriangle} chip={kpis.noProgressFloors === 0 ? "bg-slate-100 text-slate-500" : "bg-rose-50 text-rose-600"} number={kpis.noProgressFloors === 0 ? "text-slate-500" : "text-rose-600"} />
        </div>
      </div>

      <div className={cx(open ? "flex" : "hidden", "flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm md:flex print:flex")}>
        <PillGroup title="Alignment">
          <Pill label="Complete" value={kpis.alignmentComplete} tone={GREEN} />
          <Pill label="Under process" value={kpis.alignmentUnderProcess} tone={SKY} />
          <Pill label="Not complete" value={kpis.alignmentNotComplete} tone={SLATE} />
        </PillGroup>
        <PillGroup title="WIR">
          <Pill label="Approved" value={kpis.approvedWir} tone={GREEN} />
          <Pill label="Pending" value={kpis.pendingWir} tone={AMBER} />
          <Pill label="Rejected" value={kpis.rejectedWir} tone={ROSE} />
        </PillGroup>
      </div>
    </div>
  );
}
