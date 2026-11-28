export type ReportPreset = "month" | "last" | "year" | "custom";

export interface ReportRange {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The range a preset stands for, worked out from today's date as yyyy-MM-dd text so no time zone can move a day. */
export function presetRange(preset: Exclude<ReportPreset, "custom">, today: string): ReportRange {
  const [year, month] = today.split("-").map(Number);
  if (preset === "month") return { from: `${year}-${pad(month)}-01`, to: today };
  if (preset === "year") return { from: `${year}-01-01`, to: today };
  const lastYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate();
  return { from: `${lastYear}-${pad(lastMonth)}-01`, to: `${lastYear}-${pad(lastMonth)}-${pad(lastDay)}` };
}

/** What is wrong with a typed range, or null when it can be reported. */
export function rangeProblem({ from, to }: ReportRange, today: string): string | null {
  if (!from || !to) return "Choose both dates.";
  if (from > to) return "The end date cannot be before the start date.";
  if (to > today) return "The report cannot end in the future.";
  return null;
}
