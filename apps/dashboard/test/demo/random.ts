// A seeded pseudo-random source, so the same options always make the same dataset.

export interface Random {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [min, max], both included. */
  int(min: number, max: number): number
  /** True with this probability. */
  chance(probability: number): boolean
  pick<T>(items: readonly T[]): T
  /** One of the items, in proportion to its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T
  /** A lowercase hex string of this length. */
  hex(length: number): string
}

/** mulberry32: small, fast and good enough for demo data. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (items) => items[int(0, items.length - 1)] as (typeof items)[number],
    weighted(items) {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0)
      let left = next() * total
      for (const [item, weight] of items) {
        left -= weight
        if (left < 0) return item
      }
      return (items.at(-1) as (typeof items)[number])[0]
    },
    hex: (length) => Array.from({ length }, () => int(0, 15).toString(16)).join(''),
  }
}
