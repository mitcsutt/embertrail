import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * Whether the Board is in edit mode, kept in the URL's `edit` search param so a reload stays in
 * it. Turning it on or off replaces the history entry, and leaves the filters in the URL alone.
 */
export function useEditMode(): { editing: boolean; setEditing: (on: boolean) => void } {
  const search: Record<string, unknown> = useSearch({ strict: false })
  const navigate = useNavigate()
  const setEditing = useCallback(
    (on: boolean) => {
      void navigate({
        to: '.',
        replace: true,
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          edit: on ? true : undefined,
        }),
      })
    },
    [navigate],
  )
  return { editing: search.edit === true, setEditing }
}
