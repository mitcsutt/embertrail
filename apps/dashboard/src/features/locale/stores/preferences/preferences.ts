import { useSyncExternalStore } from 'react'

import type { LocalePreferences } from '#features/locale/types/preferences'
import { parsePreferences } from '#features/locale/utils/preferences'

const key = 'embertrail-dashboard-locale'
const listeners = new Set<() => void>()
let cache: { raw: string | null; value: LocalePreferences } | undefined

function read(): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return cache?.raw ?? null
  }
}

function snapshot(): LocalePreferences {
  const raw = read()
  if (cache?.raw !== raw) cache = { raw, value: parsePreferences(raw) }
  return cache.value
}

/** Saves the choice on this device and tells every view that reads it. */
export function setPreferences(next: LocalePreferences): void {
  const raw = JSON.stringify(next)
  try {
    localStorage.setItem(key, raw)
  } catch {
    // Storage is blocked: the choice lasts until the page closes.
  }
  cache = { raw, value: parsePreferences(raw) }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePreferences(): LocalePreferences {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
