import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatTokens } from '#features/widgets/utils/formats'

export const periodSessions = periodStat({
  id: 'period-sessions',
  group: 'sessions',
  title: 'Sessions',
  description: 'How many Sessions started in the period, against the period before.',
  metric: 'claude_code.session.count',
  filters: ['source', 'account'],
  // A count in short form, as tokens are written: `42`, `1.2K`.
  format: (value) => formatTokens(value),
})
