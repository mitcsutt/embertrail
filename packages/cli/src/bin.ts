#!/usr/bin/env node
import { run } from './cli.ts'
import { processIo } from './io.ts'

process.exitCode = await run(process.argv.slice(2), processIo())
