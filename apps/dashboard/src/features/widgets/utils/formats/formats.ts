// How Widgets write numbers. All take an optional locale and default to the browser's.

export function formatUsd(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value)
}

/** A token count in short form: `12K`, `3.4M`. */
export function formatTokens(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

/** A fraction as a percentage: `0.125` reads `12.5%`. */
export function formatPercent(fraction: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    fraction,
  )
}

const units = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['min', 60_000],
  ['s', 1_000],
] as const

/** Milliseconds as the two largest units: `4 800 000` reads `1 h 20 min`. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${String(Math.round(ms))} ms`
  let rest = Math.round(ms / 1_000) * 1_000
  const parts: string[] = []
  for (const [unit, size] of units) {
    const count = Math.floor(rest / size)
    if (count > 0 && parts.length < 2) parts.push(`${String(count)} ${unit}`)
    rest -= count * size
  }
  return parts.join(' ')
}
