import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Small supporting line, e.g. a comparison or unit. */
  note?: string;
}

export function StatCard({ label, value, icon: Icon, note }: StatCardProps) {
  return (
    <Card className="p-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-600 sm:text-sm">{label}</p>
        {Icon && (
          <span className="hidden size-9 shrink-0 sm:inline-flex items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon aria-hidden="true" size={18} />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink-900">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
    </Card>
  );
}
