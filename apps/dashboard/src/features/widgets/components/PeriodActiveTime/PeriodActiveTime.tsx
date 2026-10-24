import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatDuration } from '#features/widgets/utils/formats'

export const periodActiveTime = periodStat({
  id: 'period-active-time',
  group: 'rhythm',
  title: 'Active time',
  description:
    'Time at the keyboard and time Claude spent working in the period, against the period before.',
  metric: 'claude_code.active_time.total',
  filters: ['source', 'account'],
  // The Metric counts seconds.
  format: (seconds) => formatDuration(seconds * 1_000),
})
