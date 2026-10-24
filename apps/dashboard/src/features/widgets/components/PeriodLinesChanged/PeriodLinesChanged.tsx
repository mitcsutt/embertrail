import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatTokens } from '#features/widgets/utils/formats'

export const periodLinesChanged = periodStat({
  id: 'period-lines-changed',
  group: 'output',
  title: 'Lines changed',
  description: 'Lines added and removed in the period, against the period before.',
  metric: 'claude_code.lines_of_code.count',
  filters: ['source', 'account'],
  // A count in short form, as tokens are written: `42`, `1.2K`.
  format: (value) => formatTokens(value),
})
