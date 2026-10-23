import { describe, expect, it } from 'vitest'

import type { Inventory } from '#features/filters/data/inventory'

import { filterOptions } from './filterOptions'

const inventory: Inventory = {
  owners: [{ id: 'u1', kind: 'user', name: 'u1' }],
  sources: [{ id: 's1', name: 'Laptop', owner_id: 'u1' }],
  accounts: [
    {
      id: 'a1',
      label: 'Work',
      owner_id: 'u1',
      organization_id: null,
      account_uuid: null,
      email: 'dev@example.com',
    },
    {
      id: 'a2',
      label: 'Unknown',
      owner_id: 'u1',
      organization_id: null,
      account_uuid: null,
      email: null,
    },
  ],
  services: [],
  models: ['claude-opus'],
  metrics: [],
  events: [],
  attributes: [],
}

describe('filterOptions', () => {
  it('names Sources by name, Accounts by label with their email, and models as they are', () => {
    expect(filterOptions(inventory, {})).toEqual({
      sources: [{ value: 's1', label: 'Laptop', description: undefined }],
      accounts: [
        { value: 'a1', label: 'Work', description: 'dev@example.com' },
        { value: 'a2', label: 'Unknown', description: undefined },
      ],
      models: [{ value: 'claude-opus', label: 'claude-opus' }],
    })
  })

  it('names the Owner only when the Inventory holds more than one', () => {
    const shared: Inventory = {
      ...inventory,
      owners: [
        { id: 'u1', kind: 'user', name: 'Ada' },
        { id: 't1', kind: 'team', name: 'Platform' },
      ],
      sources: [{ id: 's1', name: 'Laptop', owner_id: 't1' }],
    }

    expect(filterOptions(shared, {}).sources[0]?.description).toBe('Platform')
    expect(filterOptions(shared, {}).accounts[0]?.description).toBe('dev@example.com · Ada')
  })

  it('falls back to the id for an Owner the Inventory does not name', () => {
    const shared: Inventory = {
      ...inventory,
      owners: [
        { id: 'u1', kind: 'user', name: 'Ada' },
        { id: 'u2', kind: 'user', name: 'Grace' },
      ],
      sources: [{ id: 's1', name: 'Laptop', owner_id: 'gone' }],
    }

    expect(filterOptions(shared, {}).sources[0]?.description).toBe('gone')
  })

  it('offers a current pick the Inventory does not hold, first', () => {
    const options = filterOptions(inventory, { sourceId: 'old', model: 'claude-opus' })

    expect(options.sources[0]).toEqual({ value: 'old', label: 'old' })
    expect(options.models).toHaveLength(1)
  })

  it('is empty before the Inventory loads, apart from the current picks', () => {
    expect(filterOptions(undefined, { accountId: 'a1' })).toEqual({
      sources: [],
      accounts: [{ value: 'a1', label: 'a1' }],
      models: [],
    })
  })
})
