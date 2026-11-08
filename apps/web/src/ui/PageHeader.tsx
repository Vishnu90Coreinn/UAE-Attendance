import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary and secondary actions, right-aligned on desktop. */
  actions?: ReactNode;
}

/** Every screen starts with this: one h1, an optional one-line description, and the screen's actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
