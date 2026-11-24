import { LogIn, LogOut, MapPinOff } from "lucide-react";
import type { Punch } from "../../api/staff";
import { hoursText } from "./staffUi";

/** Sign-in and sign-out pairs as a vertical timeline, with the time spent between them. */
export function Timeline({ punches }: { punches: Punch[] }) {
  if (punches.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-600">Nothing yet. Your first sign-in will appear here.</p>;
  }
  return (
    <ol className="px-5 py-4">
      {punches.map((p, index) => {
        const next = punches[index + 1];
        const gap = next && p.kind === "In" ? minutesBetween(p.time, next.time) : null;
        const isIn = p.kind === "In";
        return (
          <li key={p.id} className="relative flex gap-4 pb-5 last:pb-0">
            {index < punches.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-ink-200" />}
            <span
              aria-hidden="true"
              className={`relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full ${isIn ? "bg-brand-600 text-white" : "bg-ink-200 text-ink-800"}`}
            >
              {isIn ? <LogIn size={15} /> : <LogOut size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold text-ink-900">{isIn ? "Signed in" : "Signed out"}</span>
                <span className="font-mono text-sm tabular-nums text-ink-700">{p.time.slice(0, 5)}</span>
              </p>
              {gap !== null && <p className="text-sm text-ink-600">{hoursText(gap / 60)} at work</p>}
              {p.outsideOffice && (
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-900">
                  <MapPinOff aria-hidden="true" size={14} /> Outside the office area. Your manager will see this.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}
