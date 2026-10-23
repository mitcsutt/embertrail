import { useState } from 'react'

import { browserTimeZone } from '#features/filters/utils/browserTimeZone'

/** The browser's IANA zone, read once: the zone a view reads days and writes times in. */
export function useBrowserTimeZone(): string {
  const [tz] = useState(browserTimeZone)
  return tz
}
