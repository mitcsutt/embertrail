import { describe, expect, it } from 'vitest'

import { chartColorOrder } from './chartColorOrder'

describe('chartColorOrder', () => {
  it('orders models by name, whatever order the Inventory lists them', () => {
    const models = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7']
    expect(chartColorOrder({ models }).slice(0, 3)).toEqual([
      'claude-haiku-4-5',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ])
    expect(chartColorOrder({ models: models.toReversed() })).toEqual(chartColorOrder({ models }))
  })

  it('follows the models with token types in their usual order, unknown ones last', () => {
    expect(chartColorOrder({ models: ['m'], types: ['cacheRead', 'zzz', 'input', 'aaa'] })).toEqual(
      ['m', 'input', 'cacheRead', 'aaa', 'zzz'],
    )
  })

  it('does not change the lists it is given', () => {
    const models = ['b', 'a']
    chartColorOrder({ models })
    expect(models).toEqual(['b', 'a'])
  })
})
