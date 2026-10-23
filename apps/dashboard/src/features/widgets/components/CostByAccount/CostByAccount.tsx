import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { Bars } from '@mitcsutt/kiln-charts'

import type { Inventory } from '#features/filters/data/inventory'
import type { WidgetDefinition } from '#features/widgets/types/widget'

/** One Account's cost; `accountId` is `null` for cost that carries no Account. */
export interface AccountCost {
  accountId: string | null
  cost: number
}

export interface CostByAccountData {
  /** Most expensive first. */
  accounts: AccountCost[]
}

export const costByAccount: WidgetDefinition<CostByAccountData> = {
  id: 'cost-by-account',
  group: 'spend',
  title: 'Cost by Account',
  description: 'What each Account has cost in the period.',
  kind: 'bars',
  size: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  inventory: true,
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      group_by: ['embertrail.account_id'],
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    accounts: (response as OperationOutput<'queryMetrics'>).rows
      .flatMap((row) => {
        const id = row.group['embertrail.account_id']
        return row.value === null
          ? []
          : [{ accountId: id === undefined || id === null ? null : String(id), cost: row.value }]
      })
      .toSorted((a, b) => b.cost - a.cost),
  }),
  isEmpty: ({ accounts }) => accounts.length === 0,
  View: ({ data, label, inventory }) => (
    <Bars
      data={data.accounts.map(({ accountId, cost }, index) => ({
        account: accountName(accountId, inventory, data, index),
        cost,
      }))}
      x="account"
      label={label}
      height="fill"
      series={[{ key: 'cost', label: 'Cost' }]}
      format={{ style: 'currency', currency: 'USD' }}
    />
  ),
}

/**
 * An Account's label from the Inventory, or its id while the Inventory is missing. Two Accounts
 * with one label (an `Unknown` pair) stay apart by their email, or their id, so a bar is not
 * merged into its neighbour.
 */
function accountName(
  id: string | null,
  inventory: Inventory | undefined,
  { accounts }: CostByAccountData,
  index: number,
): string {
  if (id === null) return 'No Account'
  const account = inventory?.accounts.find((candidate) => candidate.id === id)
  const name = account?.label ?? id
  const twin = accounts.some(
    (other, position) =>
      position !== index &&
      other.accountId !== null &&
      (inventory?.accounts.find((candidate) => candidate.id === other.accountId)?.label ??
        other.accountId) === name,
  )
  return twin ? `${name} (${account?.email ?? id})` : name
}
