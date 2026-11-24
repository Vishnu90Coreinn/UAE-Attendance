import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

/**
 * A short confirmation floating just above the tab bar. A saved day or report is confirmed where the thumb and the eye
 * already are, not in a banner at the top of a page the user has scrolled away from. It dismisses itself, and can
 * carry one action such as Undo.
 */
export function PhoneToast({
  message,
  action,
  lift = false,
  error = false,
  onDone,
}: {
  message: string | null;
  action?: { label: string; onClick: () => void };
  /** True while a save bar is showing, so the toast sits above it instead of on top of it. */
  lift?: boolean;
  /** True when the message reports a failure: an alert icon instead of a tick. */
  error?: boolean;
  /** Called when the toast has been up long enough; the page clears its message. */
  onDone: () => void;
}) {
  const done = useRef(onDone);
  const hasAction = Boolean(action);
  done.current = onDone;
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => done.current(), hasAction ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [message, hasAction]);

  if (!message) return null;
  return (
    <div
      role="status"
      className={`fixed inset-x-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900 py-1 pl-4 pr-1 text-sm font-semibold text-white shadow-pop ${
        lift ? "bottom-[calc(9.25rem+env(safe-area-inset-bottom))]" : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {!action && (error ? <CircleAlert aria-hidden="true" size={18} className="shrink-0 text-amber-300" /> : <CircleCheck aria-hidden="true" size={18} className="shrink-0 text-brand-300" />)}
      <span className="min-w-0 flex-1 py-2.5">{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDone();
          }}
          className="inline-flex min-h-11 items-center rounded-xl px-3 font-bold text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
