import { SectionHeader } from '@mitcsutt/kiln-ui'
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** The page's `h1`. */
  title: ReactNode
  /** A sentence under the title: what the page shows. */
  description?: ReactNode
  /** Buttons for the page, right of the title from `md` up and below it on a phone. */
  actions?: ReactNode
}

/**
 * The title block every page starts with: one size of `h1`, a description and the
 * page's actions, aligned in one row. Pages use it instead of a bare `Heading level={1}`.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <SectionHeader level={1} size="xl" title={title} description={description} actions={actions} />
  )
}
