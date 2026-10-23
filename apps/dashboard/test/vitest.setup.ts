import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// TanStack Router restores scroll on navigation; jsdom doesn't implement it. Node-environment
// tests (the demo dataset and seed) have no window.
if (typeof window !== 'undefined') window.scrollTo = () => undefined
