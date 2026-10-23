import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useReturnFocus } from './useReturnFocus'

const button = (label: string) => {
  const element = document.createElement('button')
  element.textContent = label
  document.body.append(element)
  return element
}
const closing = () => new Event('focus', { cancelable: true })

afterEach(() => {
  document.body.replaceChildren()
})

describe('useReturnFocus', () => {
  it('puts focus back on what had it when the overlay opened', () => {
    const opener = button('opener')
    opener.focus()
    const { result } = renderHook(() => useReturnFocus())
    result.current.onOpenAutoFocus(new Event('focus'))
    button('inside').focus()

    const event = closing()
    result.current.onCloseAutoFocus(event)

    expect(event.defaultPrevented).toBe(true)
    expect(opener).toHaveFocus()
  })

  it('leaves focus to the override when it takes the event', () => {
    const opener = button('opener')
    const next = button('next')
    opener.focus()
    const { result } = renderHook(() =>
      useReturnFocus((event) => {
        event.preventDefault()
        next.focus()
      }),
    )
    result.current.onOpenAutoFocus(new Event('focus'))

    result.current.onCloseAutoFocus(closing())

    expect(next).toHaveFocus()
  })

  it('uses the fallback when the opener left the page, is disabled, or nothing had focus', () => {
    const fallback = button('fallback')
    const gone = button('gone')
    const { result } = renderHook(() => useReturnFocus(undefined, () => fallback))
    gone.focus()
    result.current.onOpenAutoFocus(new Event('focus'))
    gone.remove()
    result.current.onCloseAutoFocus(closing())
    expect(fallback).toHaveFocus()

    const busy = button('busy')
    busy.focus()
    result.current.onOpenAutoFocus(new Event('focus'))
    busy.disabled = true
    fallback.blur()
    result.current.onCloseAutoFocus(closing())
    expect(fallback).toHaveFocus()

    fallback.blur()
    result.current.onOpenAutoFocus(new Event('focus'))
    result.current.onCloseAutoFocus(closing())
    expect(fallback).toHaveFocus()
  })

  it('leaves focus alone when neither the opener nor the fallback can take it', () => {
    const fallback = button('fallback')
    fallback.disabled = true
    const { result } = renderHook(() => useReturnFocus(undefined, () => fallback))
    const event = closing()
    result.current.onOpenAutoFocus(new Event('focus'))
    result.current.onCloseAutoFocus(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
