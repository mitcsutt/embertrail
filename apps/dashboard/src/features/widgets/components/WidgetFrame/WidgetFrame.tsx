import { ChartFrame, type ChartStatus } from '@mitcsutt/kiln-charts'
import { Button, Card } from '@mitcsutt/kiln-ui'
import type { ReactNode } from 'react'

import { describeError } from '#features/widgets/utils/describeError'

export interface WidgetFrameProps {
  title: string
  status: ChartStatus
  /** Shown in the error state, with the Hub's `detail` when it sent one. */
  error?: unknown
  onRetry?: () => void
  /** A stat names itself, so it asks the frame not to repeat the title above it. */
  showTitle?: boolean
  /** `auto` for content that sizes itself (a stat, a table); `fill` for a chart in a grid cell. */
  height?: 'auto' | 'fill'
  /** The Widget, drawn only when `status` is `ready`. */
  children: ReactNode
}

/**
 * The Card every Widget sits in. A loading, empty or error status replaces the Widget at the
 * same size, with a Retry on error.
 */
export function WidgetFrame({
  title,
  status,
  error,
  onRetry,
  showTitle = true,
  height = 'fill',
  children,
}: WidgetFrameProps) {
  return (
    <Card variant="outline" role="group" aria-label={title}>
      {showTitle ? (
        <Card.Header>
          <Card.Title level={3}>{title}</Card.Title>
        </Card.Header>
      ) : null}
      <Card.Body>
        {status === 'ready' ? (
          children
        ) : (
          <ChartFrame
            label={title}
            height={height}
            status={status}
            emptyMessage="Nothing to show for this period"
            errorMessage={describeError(error)}
            action={
              status === 'error' && onRetry !== undefined ? (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        )}
      </Card.Body>
    </Card>
  )
}
