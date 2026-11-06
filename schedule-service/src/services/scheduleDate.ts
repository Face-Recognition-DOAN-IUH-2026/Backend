/**
 * localDate — format a Date as the local `YYYY-MM-DD` calendar date.
 * Shared helper (kept out of ScheduleService to avoid a circular import when
 * domain services need the same local-date semantics as the facade).
 */
export function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
