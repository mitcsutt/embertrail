/** The package name, until the package has real exports. */
export const packageName = '@mitcsutt/embertrail-worker'

export default {
  fetch() {
    return new Response('Not implemented', { status: 501 })
  },
} satisfies ExportedHandler
