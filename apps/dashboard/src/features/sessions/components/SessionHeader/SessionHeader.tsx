import { Heading, Inline, Link, Stack, Stat, Tag, Text } from '@mitcsutt/kiln-ui'
import { Link as RouterLink } from '@tanstack/react-router'

import type { SessionDetail } from '#features/sessions/data/session'
import { formatCost, formatCount, formatTime, shortId } from '#features/sessions/utils/formats'

export interface SessionHeaderProps {
  session: SessionDetail
  tz: string
}

/** A Session at a glance: where it sits in its group, its totals, and the Sessions below it. */
export function SessionHeader({ session, tz }: SessionHeaderProps) {
  const tokens = Object.values(session.tokens).reduce((a, b) => a + b, 0)
  return (
    <Stack gap={3}>
      <Heading level={1} size="2xl">
        Session {shortId(session.id)}
      </Heading>
      <Inline gap={3} wrap>
        <Text tone="muted">{session.id}</Text>
        {session.group === null ? null : (
          <Text>
            In group <strong>{session.group.id}</strong>
            {session.group.kind === null ? null : <Tag>{session.group.kind}</Tag>}
          </Text>
        )}
        {session.role === null ? null : <Tag>{session.role}</Tag>}
        {session.parent_session_id === null ? null : (
          <Text>
            Child of{' '}
            <Link asChild>
              <RouterLink
                to="/sessions/$sessionId"
                params={{ sessionId: session.parent_session_id }}
              >
                {shortId(session.parent_session_id)}
              </RouterLink>
            </Link>
          </Text>
        )}
      </Inline>
      <Inline gap={6} wrap>
        <Stat
          size="sm"
          label="Cost"
          value={session.cost_usd === null ? '–' : formatCost(session.cost_usd)}
        />
        <Stat size="sm" label="Tokens" value={formatCount(tokens)} />
        <Stat size="sm" label="Started" value={formatTime(session.started_at, tz)} />
        <Stat size="sm" label="Last seen" value={formatTime(session.last_seen_at, tz)} />
        <Stat size="sm" label="Models" value={session.models.join(', ') || '–'} />
      </Inline>
      {session.children.length === 0 ? null : (
        <Text>
          Children:{' '}
          {session.children.map((child, index) => (
            <span key={child.id}>
              {index === 0 ? '' : ', '}
              <Link asChild>
                <RouterLink to="/sessions/$sessionId" params={{ sessionId: child.id }}>
                  {shortId(child.id)}
                </RouterLink>
              </Link>
            </span>
          ))}
        </Text>
      )}
    </Stack>
  )
}
