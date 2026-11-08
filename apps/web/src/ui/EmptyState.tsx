import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** Why it is empty and what the user can do. */
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-ink-100 text-ink-500">
          <Icon aria-hidden="true" size={22} />
        </span>
      )}
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
