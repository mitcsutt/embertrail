// How the Session views write numbers and times; the browser's locale unless one is given.

export function formatCost(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value)
}

/** A token count in short form: `12K`, `3.4M`. */
export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

/** An ISO time in the Dashboard's zone, to the second when `seconds`; `–` for a missing one. */
export function formatTime(
  value: string | null,
  tz: string,
  { seconds = false }: { seconds?: boolean } = {},
  locale?: string,
): string {
  if (value === null) return '–'
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  }).format(new Date(value))
}

/** The id a Session is shown by: the start of a UUID is enough to tell Sessions apart. */
export const shortId = (id: string): string => id.slice(0, 8)
