/** Rows in aligned columns, two spaces apart. */
export function columns(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((widest, row) => {
    row.forEach((cell, column) => {
      widest[column] = Math.max(widest[column] ?? 0, cell.length)
    })
    return widest
  }, [])
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

/** Rows in aligned columns under a header row. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return columns([headers, ...rows])
}

/** `—` for a value a record does not have. */
export function dash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : value
}

/** A list's text: its table, or a line saying it is empty. */
export function listing(
  what: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return rows.length === 0 ? `No ${what}.` : table(headers, rows)
}
