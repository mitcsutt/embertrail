import { SectionHeader } from '@mitcsutt/kiln-ui'
import type { ReactNode } from 'react'

export interface SectionTitleProps {
  /** The section's `h2`. */
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Id for the heading, for a `<section aria-labelledby>`. */
  titleId?: string
}

/** A section's title inside a page: one size of `h2`, a step below `PageHeader`. */
export function SectionTitle({ title, description, actions, titleId }: SectionTitleProps) {
  return (
    <SectionHeader
      level={2}
      size="md"
      title={title}
      description={description}
      actions={actions}
      titleId={titleId}
    />
  )
}
