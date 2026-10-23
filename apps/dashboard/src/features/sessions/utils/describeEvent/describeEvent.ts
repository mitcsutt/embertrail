import type { Schemas } from '@mitcsutt/embertrail-client'

type HubEvent = Schemas['Event']

const text = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined

/**
 * One line on what an Event was, from the attributes Claude Code sends that say the most: the
 * tool and whether it worked, the API status, how long it took, what it cost. An Event from
 * another sender shows its body, or nothing.
 */
export function describeEvent(event: HubEvent): string {
  const { attributes } = event
  const parts: string[] = []
  const tool = text(attributes.tool_name)
  if (tool !== undefined) parts.push(tool)
  if (attributes.success === false || attributes.success === 'false') parts.push('failed')
  const status = text(attributes.status_code)
  if (status !== undefined) parts.push(`status ${status}`)
  const duration = text(attributes.duration_ms)
  if (duration !== undefined) parts.push(`${duration} ms`)
  const cost = Number(attributes.cost_usd)
  if (Number.isFinite(cost) && attributes.cost_usd !== undefined) parts.push(`$${cost.toFixed(4)}`)
  return parts.length > 0 ? parts.join(' · ') : (event.body ?? '')
}
