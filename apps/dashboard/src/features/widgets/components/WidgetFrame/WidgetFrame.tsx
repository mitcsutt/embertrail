import { ChartFrame, type ChartStatus } from '@mitcsutt/kiln-charts'
import { Badge, Button, Card, Inline } from '@mitcsutt/kiln-ui'
import type { CSSProperties, ReactNode } from 'react'

import { describeError } from '#features/widgets/utils/describeError'

export interface WidgetFrameProps {
  title: string
  status: ChartStatus
  /** Shown in the error state, with the Hub's `detail` when it sent one. */
  error?: unknown
  onRetry?: () => void
  /** Which filters are pinned on this Widget, if any; the frame says so. */
  pinned?: string
  /** The Widget is narrowed by a Source, Account or model, so an empty one says the filters did it. */
  filtered?: boolean
  /** The title's heading level: 2 on a Board without section headings, 3 under them. */
  level?: 2 | 3
  /** A stat names itself, so it asks the frame not to repeat the title above it. */
  showTitle?: boolean
  /** `auto` for content that sizes itself (a stat, a table); `fill` for a chart in a grid cell. */
  height?: 'auto' | 'fill'
  /** The Widget, drawn only when `status` is `ready`. */
  children: ReactNode
}

// A Board is dense: a smaller inset and title than a page's Card, and an empty Widget says so in
// small type (the Board says it once, loudly, when the whole window is empty). The body takes the
// height the title leaves, so a chart drawn at `fill` fills its grid cell instead of its minimum.
const frameStyle = {
  '--card-title-size': 'var(--text-md)',
  '--empty-title-size': 'var(--text-sm)',
} as CSSProperties
const bodyStyle: CSSProperties = {
  flex: '1 1 auto',
  minBlockSize: 0,
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1fr)',
}
// Content that sizes itself (a table, a list) scrolls inside its card when a narrow grid wraps
// its rows taller than the cell, instead of drawing over the card below.
const autoBodyStyle: CSSProperties = { ...bodyStyle, overflowY: 'auto' }

/**
 * The Card every Widget sits in. A loading, empty or error status replaces the Widget at the
 * same size, with a Retry on error.
 */
export function WidgetFrame({
  title,
  status,
  error,
  onRetry,
  pinned,
  filtered = false,
  level = 3,
  showTitle = true,
  height = 'fill',
  children,
}: WidgetFrameProps) {
  return (
    <Card variant="outline" role="group" aria-label={title} padding={4} style={frameStyle}>
      {showTitle || pinned !== undefined ? (
        <Card.Header>
          <Inline gap={2} align="center" justify="between">
            {showTitle ? <Card.Title level={level}>{title}</Card.Title> : null}
            {pinned === undefined ? null : (
              <Badge tone="accent" size="sm" title={pinned}>
                {`Pinned: ${pinned}`}
              </Badge>
            )}
          </Inline>
        </Card.Header>
      ) : null}
      <Card.Body style={height === 'auto' ? autoBodyStyle : bodyStyle}>
        {status === 'ready' ? (
          children
        ) : (
          <ChartFrame
            label={title}
            height={height}
            status={status}
            emptyMessage={
              filtered
                ? 'Nothing matches the filters in this period'
                : 'Nothing recorded in this period'
            }
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
