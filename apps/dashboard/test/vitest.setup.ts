import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// TanStack Router restores scroll on navigation; jsdom doesn't implement it.
window.scrollTo = () => undefined
