import type { ReactNode } from "react";
import { Pencil, Phone } from "lucide-react";
import { Link, useInRouterContext } from "react-router-dom";
import type { Worker } from "../../api/workers";
import { RowMenu, type RowMenuItem } from "../../ui";
import { onboardingProgress, workerMenuItems, type RowActions } from "./WorkersTable";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** The row's tap target: a link to the profile, or plain content where there is no router (isolated tests). */
function RowLink({ worker, children }: { worker: Worker; children: ReactNode }) {
  const inRouter = useInRouterContext();
  const className = `flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-1.5 text-left active:bg-ink-50 ${focusRing}`;
  return inRouter ? (
    <Link to={`/workers/${worker.id}`} aria-label={`Open ${worker.fullName}`} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * The phone's worker directory: one grouped list of people, alphabetical, each row opening the profile. Calling someone
 * is one tap on the phone button. Managers and HR also get a "..." menu with edit and the rest; everyone else sees only
 * what a supervisor needs, with no ID numbers or pay in the list.
 */
export function WorkersPhoneList({
  workers,
  showOnboarding,
  actions,
  onPrint,
  busyId,
}: {
  workers: Worker[];
  /** Onboarding progress is an HR and management concern, so Supervisors do not see it. */
  showOnboarding: boolean;
  actions?: RowActions;
  onPrint?: (worker: Worker) => void;
  busyId: number | null;
}) {
  const sorted = [...workers].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return (
    <ul aria-label="Workers" className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-line bg-white shadow-card">
      {sorted.map((worker) => {
        const busy = busyId === worker.id;
        const { done, total } = onboardingProgress(worker);
        const place = [worker.department, worker.workLocation].filter(Boolean).join(" · ");
        const items: RowMenuItem[] = [
          ...(actions ? [{ label: "Edit", icon: Pencil, disabled: busy, onSelect: () => actions.onEdit(worker) }] : []),
          ...workerMenuItems(worker, actions, onPrint, busy),
        ];
        return (
          <li key={worker.id} aria-label={worker.fullName} className={`flex items-center gap-1 py-2 pl-3 pr-2 ${worker.isActive ? "" : "bg-ink-50"}`}>
            <RowLink worker={worker}>
              <span
                aria-hidden="true"
                className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  worker.isActive ? "bg-brand-100 text-brand-800" : "bg-ink-200 text-ink-600"
                }`}
              >
                {initials(worker.fullName)}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={`break-words text-base font-semibold leading-snug ${worker.isActive ? "text-ink-900" : "text-ink-600"}`}>
                    {worker.fullName}
                  </span>
                  {worker.category === "Employee" && (
                    <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">Office</span>
                  )}
                  {!worker.isActive && (
                    <span className="rounded-md bg-ink-200 px-1.5 py-0.5 text-xs font-semibold text-ink-700">Inactive</span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[0.8125rem] leading-snug text-ink-700">{worker.designation}</span>
                {place && <span className="block truncate text-xs leading-snug text-ink-600">{place}</span>}
                {showOnboarding && worker.isActive && done < total && (
                  <span className="mt-1 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                    Onboarding {done}/{total}
                    <span className="sr-only"> tasks complete</span>
                  </span>
                )}
              </span>
            </RowLink>
            {worker.phone && (
              <a
                href={`tel:${worker.phone.replace(/[^+\d]/g, "")}`}
                aria-label={`Call ${worker.fullName}`}
                className={`grid size-11 shrink-0 place-items-center rounded-full border border-brand-200 bg-brand-50 text-brand-700 active:bg-brand-100 ${focusRing}`}
              >
                <Phone aria-hidden="true" size={20} />
              </a>
            )}
            {items.length > 0 && <RowMenu label={`More actions for ${worker.fullName}`} items={items} />}
          </li>
        );
      })}
    </ul>
  );
}
