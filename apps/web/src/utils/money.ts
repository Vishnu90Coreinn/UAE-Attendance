/** An hourly rate as shown on screen: always two decimals, for example 12.50. */
export function formatRate(rate: number): string {
  return rate.toFixed(2);
}
