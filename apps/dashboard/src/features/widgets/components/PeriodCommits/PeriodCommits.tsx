import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatTokens } from '#features/widgets/utils/formats'

export const periodCommits = periodStat({
  id: 'period-commits',
  group: 'output',
  title: 'Commits',
  description: 'Commits made in the period, against the period before.',
  metric: 'claude_code.commit.count',
  filters: ['source', 'account'],
  // A count in short form, as tokens are written: `42`, `1.2K`.
  format: (value) => formatTokens(value),
})
