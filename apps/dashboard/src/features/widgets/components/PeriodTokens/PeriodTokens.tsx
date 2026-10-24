import { periodStat } from '#features/widgets/components/PeriodStat'
import { formatTokens } from '#features/widgets/utils/formats'

export const periodTokens = periodStat({
  id: 'period-tokens',
  group: 'models',
  title: 'Tokens',
  description:
    'Every token counted in the period (input, output and cache), against the period before.',
  metric: 'claude_code.token.usage',
  filters: ['source', 'account', 'model'],
  format: (value) => formatTokens(value),
})
