import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary and secondary actions, right-aligned on desktop. */
  actions?: ReactNode;
}

/**
 * Every screen starts with this: one h1 with the screen's actions level with it, a one-line description under both, and a rule that closes the header
 * off from the content. On a phone the actions fall below the description.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 grid gap-x-6 border-b border-line pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <h2 className="min-w-0 font-display text-2xl font-bold tracking-tight text-ink-900 md:text-[1.75rem]">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm text-ink-600 md:col-span-2 md:row-start-2">{description}</p>}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2 md:col-start-2 md:row-start-1 md:mt-0 md:max-w-xl md:justify-end">{actions}</div>}
    </div>
  );
}
