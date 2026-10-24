import { ArrowLeftIcon, Button } from '@mitcsutt/kiln-ui'
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'

/**
 * Takes a Session page back to where it was opened from: the history's previous entry, which keeps
 * the Session Groups' filters and open rows (they are in its URL). A page opened directly has no
 * previous entry in the app, so there it links to the Session Groups instead.
 */
export function BackControl() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return canGoBack ? (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={<ArrowLeftIcon />}
      onClick={() => {
        router.history.back()
      }}
    >
      Back
    </Button>
  ) : (
    <Button asChild variant="ghost" size="sm" leadingIcon={<ArrowLeftIcon />}>
      <Link to="/sessions">All Session Groups</Link>
    </Button>
  )
}
