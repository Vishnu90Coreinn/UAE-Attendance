import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Small supporting line, e.g. a comparison or unit. */
  note?: string;
  /** Tints the icon: success, warning and danger read at a glance on money screens. */
  tone?: "brand" | "success" | "warning" | "danger";
  /** One short row: icon, label and value side by side. For summary strips above a list. */
  compact?: boolean;
  /** Makes a compact card a button, for cards that filter the list below them. */
  onClick?: () => void;
}

const ICON_TONES = {
  brand: "bg-brand-50 text-brand-600",
  success: "bg-green-50 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

export function StatCard({ label, value, icon: Icon, note, tone = "brand", compact, onClick }: StatCardProps) {
  if (compact) {
    const content = (
      <>
        {Icon && (
          <span aria-hidden="true" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${ICON_TONES[tone]}`}>
            <Icon size={18} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink-600">{label}</p>
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-semibold leading-tight tabular-nums text-ink-900">{value}</span>
            {note && <span className="truncate text-xs text-ink-500">{note}</span>}
          </p>
        </div>
      </>
    );
    return onClick ? (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-card border border-line bg-white px-4 py-3 text-left shadow-card transition hover:border-brand-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {content}
      </button>
    ) : (
      <Card className="flex items-center gap-3 px-4 py-3">{content}</Card>
    );
  }
  return (
    <Card className="p-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-600 sm:text-sm">{label}</p>
        {Icon && (
          <span className={`hidden size-9 shrink-0 items-center justify-center rounded-lg sm:inline-flex ${ICON_TONES[tone]}`}>
            <Icon aria-hidden="true" size={18} />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink-900">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
    </Card>
  );
}
