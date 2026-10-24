import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatUsd } from '#features/widgets/utils/formats'

export const periodCost = periodStat({
  id: 'period-cost',
  group: 'spend',
  title: 'Cost',
  description: 'What your Sessions cost in the period, against the period before.',
  metric: 'claude_code.cost.usage',
  filters: ['source', 'account', 'model'],
  format: (value) => formatUsd(value),
})
