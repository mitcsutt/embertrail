import { parseArgs } from 'node:util'

import { UsageError } from './errors.ts'

export interface OptionSpec {
  type: 'string' | 'boolean'
  description: string
  /** The value's placeholder in help, such as `url` for `--hub <url>`. */
  value?: string
  /** Repeatable: `--scope a --scope b`. */
  multiple?: boolean
  required?: boolean
  short?: string
}

export interface PositionalSpec {
  name: string
  description: string
  optional?: boolean
}

/** Options every command takes. */
export const globalOptions: Record<string, OptionSpec> = {
  json: { type: 'boolean', description: 'Print JSON instead of text' },
  help: { type: 'boolean', short: 'h', description: 'Show this help' },
}

/** The parsed command line of one command. */
export class Args {
  private readonly values: Record<string, string | boolean | (string | boolean)[] | undefined>
  readonly positionals: readonly string[]

  constructor(
    values: Record<string, string | boolean | (string | boolean)[] | undefined>,
    positionals: readonly string[],
  ) {
    this.values = values
    this.positionals = positionals
  }

  flag(name: string): boolean {
    return this.values[name] === true
  }

  string(name: string): string | undefined {
    const value = this.values[name]
    return typeof value === 'string' ? value : undefined
  }

  list(name: string): string[] {
    const value = this.values[name]
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  }

  /** The positional argument at `index`; the parser has checked that required ones exist. */
  positional(index: number): string {
    const value = this.positionals[index]
    if (value === undefined) throw new UsageError(`Missing argument ${String(index + 1)}`)
    return value
  }
}

export function parse(
  argv: readonly string[],
  options: Record<string, OptionSpec>,
  positionals: readonly PositionalSpec[],
): Args {
  const all = { ...options, ...globalOptions }
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        Object.entries(all).map(([name, spec]) => [
          name,
          {
            type: spec.type,
            ...(spec.short === undefined ? {} : { short: spec.short }),
            ...(spec.multiple === true ? { multiple: true } : {}),
          },
        ]),
      ),
    })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const args = new Args(parsed.values, parsed.positionals)
  if (args.flag('help')) return args
  const required = positionals.filter((p) => p.optional !== true).length
  if (parsed.positionals.length < required) {
    const missing = positionals.slice(parsed.positionals.length, required).map((p) => p.name)
    throw new UsageError(`Missing ${missing.map((name) => `<${name}>`).join(' ')}`)
  }
  if (parsed.positionals.length > positionals.length) {
    throw new UsageError(`Unexpected argument "${parsed.positionals[positionals.length] ?? ''}"`)
  }
  for (const [name, spec] of Object.entries(options)) {
    if (spec.required === true && parsed.values[name] === undefined) {
      throw new UsageError(`Missing --${name}`)
    }
  }
  return args
}
