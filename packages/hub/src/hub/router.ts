import type { HttpMethod } from '../module/define'

/** Malformed escapes stay as sent; the op's input schema decides whether they're valid. */
function decode(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Two routes with the same key collide: same method, same shape. */
export function routeKey(method: string, path: string) {
  return `${method} ${path.replaceAll(/\{[^}]+\}/g, '{}')}`
}

interface Route<T> {
  method: HttpMethod
  pattern: RegExp
  params: string[]
  /** Literal segments win over parameters: `/a/b` before `/a/{x}`. */
  literals: number
  target: T
}

export interface Match<T> {
  target: T
  params: Record<string, string>
}

/** Matches OpenAPI-style paths (`/api/v1/notes/{id}`). */
export class Router<T> {
  readonly #routes: Route<T>[] = []

  add(method: HttpMethod, path: string, target: T) {
    const params: string[] = []
    let literals = 0
    const source = path
      .split('/')
      .map((segment) => {
        const param = /^\{(.+)\}$/.exec(segment)?.[1]
        if (param === undefined) {
          literals += 1
          return segment.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }
        params.push(param)
        return '([^/]+)'
      })
      .join('/')
    this.#routes.push({ method, pattern: new RegExp(`^${source}$`), params, literals, target })
    this.#routes.sort((a, b) => b.literals - a.literals)
  }

  match(method: string, pathname: string): Match<T> | undefined {
    for (const route of this.#routes) {
      if (route.method !== method) continue
      const found = route.pattern.exec(pathname)
      if (found === null) continue
      const params: Record<string, string> = {}
      route.params.forEach((name, i) => {
        params[name] = decode(found[i + 1] ?? '')
      })
      return { target: route.target, params }
    }
    return undefined
  }
}
