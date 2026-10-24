import { periodStat } from '#features/widgets/components/PeriodStat'

export const periodCost = periodStat({
  id: 'period-cost',
  group: 'spend',
  title: 'Cost',
  description: 'What your Sessions cost in the period, against the period before.',
  metric: 'claude_code.cost.usage',
  filters: ['source', 'account', 'model'],
  format: (value, money) => money.format(value),
})
