import { useRef } from 'react'

export interface ReturnFocus {
  /** Spread onto the Sheet or Dialog content: remembers what had focus when it opened. */
  onOpenAutoFocus: (event: Event) => void
  /** Spread onto the same content: puts focus back there when it closes. */
  onCloseAutoFocus: (event: Event) => void
}

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  element?.isConnected === true && !element.matches(':disabled')

/**
 * Focus return for a Sheet or Dialog that is opened by state rather than by a `Trigger`, which is
 * what Radix returns focus to and so leaves focus on the page's `body` without one. `override` runs
 * first on close; if it prevents the event (to focus something else, such as a new item) nothing
 * is restored. An opener that left the page or is disabled is skipped. `fallback` names where to go
 * when there is no usable opener, as after a button that disables itself while it works.
 */
export function useReturnFocus(
  override?: (event: Event) => void,
  fallback?: () => HTMLElement | null,
): ReturnFocus {
  const opener = useRef<HTMLElement>(null)
  return {
    onOpenAutoFocus: () => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    },
    onCloseAutoFocus: (event) => {
      override?.(event)
      if (event.defaultPrevented) return
      const target = [opener.current, fallback?.()].find(usable)
      opener.current = null
      if (target === undefined) return
      event.preventDefault()
      target.focus()
    },
  }
}
