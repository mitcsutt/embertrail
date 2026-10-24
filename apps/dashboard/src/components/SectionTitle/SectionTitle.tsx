import { SectionHeader } from '@mitcsutt/kiln-ui'
import type { ReactNode } from 'react'

export interface SectionTitleProps {
  /** The section's `h2`. */
  title: ReactNode
}

/** A section's title inside a page: one size of `h2`, a step below `PageHeader`. */
export function SectionTitle({ title }: SectionTitleProps) {
  return <SectionHeader level={2} size="md" title={title} />
}
