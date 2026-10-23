import { describe, expect, it } from 'vitest'

import { bucketedRows, groupLabel, valuedRows } from './aggregateRows'

const response = {
  rows: [
    { bucket: '2026-10-01T00:00:00+00:00', group: { model: 'opus' }, value: 2 },
    { bucket: '2026-10-02T00:00:00+00:00', group: {}, value: null },
    { group: { model: 'sonnet' }, value: 1 },
  ],
}

describe('aggregateRows helpers', () => {
  it('valuedRows drops the rows without a value', () => {
    expect(valuedRows(response).map((row) => row.value)).toEqual([2, 1])
  })

  it('bucketedRows also drops the rows without a bucket', () => {
    expect(bucketedRows(response).map((row) => row.bucket)).toEqual(['2026-10-01T00:00:00+00:00'])
  })

  it('groupLabel reads a group key and names a missing one Unknown', () => {
    const row = { group: { model: 'opus' }, value: 2 }
    expect(groupLabel(row, 'model')).toBe('opus')
    expect(groupLabel(row, 'tool')).toBe('Unknown')
  })
})
