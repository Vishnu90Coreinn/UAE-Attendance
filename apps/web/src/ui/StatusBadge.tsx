import { CheckCircle2, CircleSlash, Clock, Info, XCircle, type LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<StatusTone, { cls: string; icon: LucideIcon }> = {
  success: { cls: "bg-green-50 text-green-800 ring-green-200", icon: CheckCircle2 },
  warning: { cls: "bg-amber-50 text-amber-900 ring-amber-200", icon: Clock },
  danger: { cls: "bg-red-50 text-red-800 ring-red-200", icon: XCircle },
  info: { cls: "bg-sky-50 text-sky-800 ring-sky-200", icon: Info },
  neutral: { cls: "bg-ink-100 text-ink-700 ring-ink-300", icon: CircleSlash },
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: string;
  /** Override the default icon for the tone. */
  icon?: LucideIcon;
  /** "soft" is a tinted pill with a dot: calmer for dense tables. The word is always shown. */
  variant?: "icon" | "soft";
}

const DOTS: Record<StatusTone, string> = {
  success: "bg-green-600",
  warning: "bg-amber-500",
  danger: "bg-red-600",
  info: "bg-sky-600",
  neutral: "bg-ink-400",
};

/** Status is always an icon, a word and a colour together, never colour alone. */
export function StatusBadge({ tone, children, icon, variant = "icon" }: StatusBadgeProps) {
  const { cls, icon: DefaultIcon } = TONES[tone];
  if (variant === "soft") {
    return (
      <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium", cls.replace(/ring-\S+/, ""))}>
        <span aria-hidden="true" className={cx("size-1.5 rounded-full", DOTS[tone])} />
        {children}
      </span>
    );
  }
  const Icon = icon ?? DefaultIcon;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", cls)}>
      <Icon aria-hidden="true" size={14} />
      {children}
    </span>
  );
}
