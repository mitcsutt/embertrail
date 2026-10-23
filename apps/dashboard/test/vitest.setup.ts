import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// TanStack Router restores scroll on navigation; jsdom doesn't implement it. Node-environment
// tests (the demo dataset and seed) have no window.
if (typeof window !== 'undefined') window.scrollTo = () => undefined

// kiln-charts measures its frame with a ResizeObserver, which jsdom doesn't implement. Nothing is
// ever laid out in jsdom, so the stub never reports a size and charts render their frame and table.
const noop = () => undefined
if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe = noop
    unobserve = noop
    disconnect = noop
  }
}

// ...and reads the reader's colour scheme and motion preferences from matchMedia, which jsdom
// doesn't implement either. Nothing here matches.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }) as MediaQueryList
}
