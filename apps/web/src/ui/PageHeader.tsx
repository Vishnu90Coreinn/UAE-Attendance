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
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0 md:flex-1">
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900 md:text-[1.75rem]">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:max-w-[62%] md:shrink-0 md:justify-end">{actions}</div>}
    </div>
  );
}
