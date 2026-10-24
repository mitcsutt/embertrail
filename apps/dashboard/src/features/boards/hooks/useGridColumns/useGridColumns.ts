import { useLayoutEffect, useState, type RefObject } from 'react'

/** The columns kiln-dnd would pick at this width: 12 from 48em, 8 from 40em, 4 below. */
export function columnsFor(width: number, rem: number): 4 | 8 | 12 {
  if (width >= 48 * rem) return 12
  return width >= 40 * rem ? 8 : 4
}

/**
 * How many columns a Board grid of this element's width has, by kiln-dnd's breakpoints, so a view
 * can hand the grid a Layout made for it. 12 until the element is measured (and where
 * `ResizeObserver` is missing), which is the stored Layout as it is.
 */
export function useGridColumns(ref: RefObject<HTMLElement | null>): 4 | 8 | 12 {
  const [columns, setColumns] = useState<4 | 8 | 12>(12)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const { width } = element.getBoundingClientRect()
      if (width > 0) setColumns(columnsFor(width, rem))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])
  return columns
}
