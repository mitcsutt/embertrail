/**
 * Text from the Hub made safe to print: every C0 and C1 control character (tabs and newlines
 * too, which break column alignment) and DEL becomes `?`, so a name can't drive the terminal
 * with an escape sequence (#122). `--json` output skips this and stays as the Hub sent it.
 */
export function printable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, '?')
}

/** Rows in aligned columns, two spaces apart. */
export function columns(unsafe: readonly (readonly string[])[]): string {
  const rows = unsafe.map((row) => row.map(printable))
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
