import { LoadingState, buttonClass } from "../../ui";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, UserPlus } from "lucide-react";

export const primaryButtonClass = buttonClass("primary");

/** The live region for success messages. It stays mounted (and empty) so announcements are reliable. */
export function SuccessRegion({ message }: { message: string | null }) {
  return (
    <div role="status" className="empty:hidden">
      {message && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
          {message}
        </p>
      )}
    </div>
  );
}

/** A failed action (activate, deactivate, delete), announced to screen readers when it appears. */
export function ActionFailure({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <CircleAlert aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

export function LoadingNotice() {
  return (
    <LoadingState label="Loading workers..." withCards />
  );
}

export function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <CircleAlert aria-hidden="true" size={20} className="shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={buttonClass("secondary", "md", "text-danger")}
      >
        <RefreshCw aria-hidden="true" size={16} />
        Retry
      </button>
    </div>
  );
}

/** Shown when there are no workers; only people who can add one get the button. */
export function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="rounded-card border border-line bg-white px-4 py-10 text-center shadow-card">
      <p className="text-sm text-ink-600">
        No workers yet.
        {onAdd && " Add the first worker to start the directory."}
      </p>
      {onAdd && (
        <button type="button" onClick={onAdd} className={`${primaryButtonClass} mt-4`}>
          <UserPlus aria-hidden="true" size={16} />
          Add New Worker
        </button>
      )}
    </div>
  );
}
