import { useId, type KeyboardEvent } from "react";
import { cx } from "../../ui";
import type { AttendanceStatus } from "../../api/attendance";
import { isLeaveStatus, LEAVE_STATUSES } from "../../utils/leaveStatuses";

interface StatusSegmentsProps {
  workerName: string;
  value: AttendanceStatus;
  disabled: boolean;
  /** Called with the new status; null clears the entry (Not recorded). */
  onChange: (status: AttendanceStatus) => void;
}

const SEGMENTS = [
  { key: "p", label: "Present", short: "P", on: "border-green-600 bg-green-600 text-white" },
  { key: "a", label: "Absent", short: "A", on: "border-red-600 bg-red-600 text-white" },
  { key: "l", label: "Leave", short: "L", on: "border-amber-500 bg-amber-500 text-white" },
] as const;

const GROUP_ATTRIBUTE = "data-status-group";

/** Moves focus to the same control in the next or previous worker's row. */
function focusSibling(from: HTMLElement, step: 1 | -1) {
  const groups = [...document.querySelectorAll<HTMLElement>(`[${GROUP_ATTRIBUTE}]`)];
  const index = groups.indexOf(from.closest<HTMLElement>(`[${GROUP_ATTRIBUTE}]`)!);
  const target = groups[index + step];
  target?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
}

/**
 * One-click attendance status: Present, Absent or Leave. Leave then shows its type. Keyboard: P, A and L set the status and
 * move to the next worker; the up and down arrows move between workers; Backspace clears; left and right move between options.
 */
export function StatusSegments({ workerName, value, disabled, onChange }: StatusSegmentsProps) {
  const id = useId();
  const onLeave = isLeaveStatus(value);
  const selected = value === "Present" ? "Present" : value === "Absent" ? "Absent" : onLeave ? "Leave" : null;

  function choose(label: (typeof SEGMENTS)[number]["label"]) {
    if (label === "Leave") onChange(onLeave ? null : LEAVE_STATUSES[0]);
    else onChange(selected === label ? null : label);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const segment = SEGMENTS.find((s) => s.key === key);
    if (segment) {
      event.preventDefault();
      if (segment.label === "Leave") onChange(onLeave ? value : LEAVE_STATUSES[0]);
      else onChange(segment.label);
      focusSibling(event.currentTarget, 1);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      onChange(null);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
      const at = radios.indexOf(document.activeElement as HTMLElement);
      radios[(at + (event.key === "ArrowRight" ? 1 : -1) + radios.length) % radios.length]?.focus();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={`Status for ${workerName}`}
        {...{ [GROUP_ATTRIBUTE]: "" }}
        onKeyDown={onKeyDown}
        className="inline-flex overflow-hidden rounded-lg border border-ink-300 bg-white"
      >
        {SEGMENTS.map((segment, index) => {
          const checked = selected === segment.label;
          // One tab stop per row: the chosen segment, or the first when nothing is chosen.
          const tabbable = checked || (selected === null && index === 0);
          return (
            <button
              key={segment.label}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={segment.label}
              title={`${segment.label} (${segment.short})`}
              tabIndex={tabbable ? 0 : -1}
              disabled={disabled}
              onClick={() => choose(segment.label)}
              className={cx(
                "min-h-11 min-w-11 border-r border-ink-300 px-3 text-sm font-semibold last:border-r-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-9 md:min-w-9 md:px-2.5",
                checked ? segment.on : "text-ink-700 hover:bg-ink-50",
              )}
            >
              <span aria-hidden="true">{segment.short}</span>
            </button>
          );
        })}
      </div>
      {onLeave && (
        <select
          aria-label={`Leave type for ${workerName}`}
          id={`${id}-leave`}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as AttendanceStatus)}
          className="min-h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:bg-ink-100"
        >
          {LEAVE_STATUSES.map((leave) => (
            <option key={leave}>{leave}</option>
          ))}
        </select>
      )}
    </div>
  );
}
