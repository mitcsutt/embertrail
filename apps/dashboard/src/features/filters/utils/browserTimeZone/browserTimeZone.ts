/**
 * The browser's IANA zone, read once at the edge. Query requests carry this zone, never a fixed
 * offset: the Hub answers 422 to one.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
