import { describe, expect, it } from 'vitest'

import { routeKey, Router } from './router'

describe('Router', () => {
  const router = new Router<string>()
  router.add('GET', '/api/v1/things/{id}', 'one')
  router.add('GET', '/api/v1/things/count', 'count')
  router.add('DELETE', '/api/v1/things/{id}', 'delete')

  it('matches parameters and decodes them', () => {
    expect(router.match('GET', '/api/v1/things/a%20b')).toEqual({
      target: 'one',
      params: { id: 'a b' },
    })
  })

  it('prefers a literal segment over a parameter, whatever the order added', () => {
    expect(router.match('GET', '/api/v1/things/count')?.target).toBe('count')
  })

  it('matches on method', () => {
    expect(router.match('DELETE', '/api/v1/things/x')?.target).toBe('delete')
    expect(router.match('PUT', '/api/v1/things/x')).toBeUndefined()
  })

  it('keeps a malformed escape as sent', () => {
    expect(router.match('GET', '/api/v1/things/%E0')?.params).toEqual({ id: '%E0' })
  })

  it('keys routes by shape, not parameter name', () => {
    expect(routeKey('GET', '/a/{x}/b')).toBe(routeKey('GET', '/a/{y}/b'))
  })
})
