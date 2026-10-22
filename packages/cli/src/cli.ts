import { globalOptions, parse } from './args.ts'
import type { OptionSpec } from './args.ts'
import { makeContext } from './command.ts'
import type { Command } from './command.ts'
import { commands } from './commands/index.ts'
import { describeError, UsageError } from './errors.ts'
import type { Io } from './io.ts'
import { columns } from './output.ts'

const binary = 'embertrail'

function usageLine(command: Command): string {
  const positionals = (command.positionals ?? []).map((p) =>
    p.optional === true ? `[${p.name}]` : `<${p.name}>`,
  )
  return [binary, ...command.path, ...positionals, '[options]'].join(' ')
}

function optionLabel(name: string, spec: OptionSpec): string {
  const short = spec.short === undefined ? '' : `-${spec.short}, `
  const value = spec.type === 'string' ? ` <${spec.value ?? 'value'}>` : ''
  return `${short}--${name}${value}`
}

function commandHelp(command: Command): string {
  const options = { ...command.options, ...globalOptions }
  const lines = [`Usage: ${usageLine(command)}`, '', command.description ?? command.summary]
  if (command.positionals !== undefined && command.positionals.length > 0) {
    lines.push('', 'Arguments:')
    lines.push(columns(command.positionals.map((p) => [`  <${p.name}>`, p.description])))
  }
  lines.push('', 'Options:')
  lines.push(
    columns(
      Object.entries(options).map(([name, spec]) => [
        `  ${optionLabel(name, spec)}`,
        spec.required === true ? `${spec.description} (required)` : spec.description,
      ]),
    ),
  )
  return lines.join('\n')
}

/** The commands under `prefix`, or the whole tree for the empty prefix. */
function groupHelp(prefix: readonly string[]): string {
  const under = commands.filter((c) => prefix.every((word, i) => c.path[i] === word))
  const heading = [binary, ...prefix].join(' ')
  const rows = under.map((c) => [`  ${c.path.slice(prefix.length).join(' ')}`, c.summary])
  return [
    `Usage: ${heading} <command> [options]`,
    '',
    prefix.length === 0
      ? 'The Embertrail command-line tool: connect machines to a Hub and manage it.'
      : `Commands under ${heading}:`,
    '',
    'Commands:',
    columns(rows),
    '',
    `Run ${heading} <command> --help for a command's options.`,
  ].join('\n')
}

function leadingWords(argv: readonly string[]): string[] {
  const words: string[] = []
  for (const arg of argv) {
    if (arg.startsWith('-')) break
    words.push(arg)
  }
  return words
}

/**
 * Runs the CLI with `argv` (without `node` and the script). Returns the exit code: 0 on success,
 * 1 when the command failed, 2 when the command line was wrong.
 */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    const words = leadingWords(argv)
    const wantsHelp = argv.includes('--help') || argv.includes('-h')
    if (words.length === 0 && (wantsHelp || argv.length === 0)) {
      io.stdout(`${groupHelp([])}\n`)
      return 0
    }
    // The longest command whose words begin the arguments: `sources rename <id> <name>` leaves
    // the id and name as positionals.
    const command = commands
      .filter((c) => c.path.every((word, i) => words[i] === word))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (command === undefined) {
      const groups = [...words.keys()]
        .map((n) => words.slice(0, n + 1))
        .filter((prefix) => commands.some((c) => prefix.every((word, i) => c.path[i] === word)))
      const group = groups.at(-1)
      if (group !== undefined) {
        const known = group.length === words.length
        if (known && wantsHelp) {
          io.stdout(`${groupHelp(group)}\n`)
          return 0
        }
        throw new UsageError(
          `${known ? 'Missing a command after' : `Unknown command "${words.slice(0, group.length + 1).join(' ')}" under`} "${[binary, ...group].join(' ')}"; run ${[binary, ...group].join(' ')} --help`,
        )
      }
      throw new UsageError(`Unknown command "${words[0] ?? ''}"; run ${binary} --help`)
    }
    const args = parse(
      argv.slice(command.path.length),
      command.options ?? {},
      command.positionals ?? [],
    )
    if (args.flag('help')) {
      io.stdout(`${commandHelp(command)}\n`)
      return 0
    }
    await command.run(makeContext(io, args.flag('json')), args)
    return 0
  } catch (error) {
    io.stderr(`${describeError(error)}\n`)
    if (error instanceof UsageError) {
      io.stderr(`Run ${binary} --help for usage.\n`)
      return 2
    }
    return 1
  }
}
