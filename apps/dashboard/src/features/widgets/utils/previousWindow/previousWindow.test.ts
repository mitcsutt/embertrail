import { describe, expect, it } from 'vitest'

import { previousWindow } from './previousWindow'

// Windows as `resolveWindow` gives them: local midnights with the zone's offset, `to` exclusive.
const berlin = (from: string, to: string) => ({ from, to, tz: 'Europe/Berlin' })

const instant = (iso: string) => new Date(iso).toISOString()

describe('previousWindow', () => {
  it('compares today with yesterday', () => {
    const ctx = berlin('2026-11-04T00:00:00.000+01:00', '2026-11-05T00:00:00.000+01:00')
    const previous = previousWindow(ctx)
    expect(previous.days).toBe(1)
    expect(instant(previous.from)).toBe('2026-11-02T23:00:00.000Z')
    expect(previous.to).toBe(ctx.from)
  })

  it('compares the last 7 days with the 7 before them', () => {
    const ctx = berlin('2026-10-29T00:00:00.000+01:00', '2026-11-05T00:00:00.000+01:00')
    const previous = previousWindow(ctx)
    expect(previous.days).toBe(7)
    expect(previous.to).toBe(ctx.from)
    expect(instant(previous.from)).toBe('2026-10-21T22:00:00.000Z')
  })

  it('starts at a local midnight across a clock change', () => {
    // Berlin leaves summer time on 25 October 2026, so the window before is an hour longer.
    const ctx = berlin('2026-10-22T00:00:00.000+02:00', '2026-10-29T00:00:00.000+01:00')
    const previous = previousWindow(ctx)
    expect(previous.days).toBe(7)
    expect(instant(previous.from)).toBe('2026-10-14T22:00:00.000Z')
    expect(instant(previous.to)).toBe('2026-10-21T22:00:00.000Z')
  })

  it('counts days in the zone, not in UTC', () => {
    // New York leaves summer time on 1 November 2026, inside the window.
    const ctx = {
      from: '2026-10-06T00:00:00.000-04:00',
      to: '2026-11-05T00:00:00.000-05:00',
      tz: 'America/New_York',
    }
    expect(previousWindow(ctx).days).toBe(30)
  })
})
