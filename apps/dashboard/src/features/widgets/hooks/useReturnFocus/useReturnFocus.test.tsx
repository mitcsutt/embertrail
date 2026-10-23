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

  it('skips an opener that left the page, and uses the fallback when nothing had focus', () => {
    const fallback = button('fallback')
    const gone = button('gone')
    const { result } = renderHook(() => useReturnFocus(undefined, () => fallback))
    gone.focus()
    result.current.onOpenAutoFocus(new Event('focus'))
    gone.remove()
    result.current.onCloseAutoFocus(closing())
    expect(document.body).toHaveFocus()

    result.current.onOpenAutoFocus(new Event('focus'))
    result.current.onCloseAutoFocus(closing())
    expect(fallback).toHaveFocus()
  })
})
