const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11" becomes "November 2026"; anything that is not a YYYY-MM period is returned unchanged. */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  const name = match ? monthNames[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : period;
}
