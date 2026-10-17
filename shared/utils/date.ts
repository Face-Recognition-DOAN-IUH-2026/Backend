/** UTC calendar date (YYYY-MM-DD) of a given instant, matching `toISOString().split('T')[0]`. */
export function toUtcDateStr(d: Date = new Date()): string {
  return d.toISOString().split('T')[0];
}
