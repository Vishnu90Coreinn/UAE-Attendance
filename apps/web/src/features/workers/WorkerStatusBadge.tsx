import { CheckCircle2, CircleSlash } from "lucide-react";

/** Status as an icon, a word and a colour, so it never relies on colour alone. */
export function WorkerStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 ring-1 ring-green-200">
      <CheckCircle2 aria-hidden="true" size={16} />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-300">
      <CircleSlash aria-hidden="true" size={16} />
      Inactive
    </span>
  );
}
