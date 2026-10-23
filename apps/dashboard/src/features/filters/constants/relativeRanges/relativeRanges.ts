import type { RelativeRange } from '#features/filters/types/filters'

/** The relative ranges in the order the filter bar offers them. */
export const relativeRangeNames = [
  'today',
  'yesterday',
  'this-week',
  'last-7-days',
  'last-30-days',
  'last-90-days',
] as const satisfies readonly RelativeRange[]

const labels: Record<RelativeRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-7-days': 'Last 7 days',
  'last-30-days': 'Last 30 days',
  'last-90-days': 'Last 90 days',
}

export const relativeRanges: readonly { value: RelativeRange; label: string }[] =
  relativeRangeNames.map((value) => ({ value, label: labels[value] }))

export const defaultRange: RelativeRange = 'last-7-days'
