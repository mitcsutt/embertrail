# Releasing

Embertrail releases from a version tag. One `v<version>` tag builds and pushes both container images to `ghcr.io`, then publishes the CLI (`@mitcsutt/embertrail-cli`) to npm, because the CLI runs the images of its own version ([local stack](local-stack.md)). The tag must match `version` in `packages/cli/package.json`; the workflow fails otherwise.

npm publishing uses trusted publishing (OIDC) with provenance, the same way Kiln does. No npm token is stored anywhere.

## How to cut a release

1. **Set the version.** In a pull request, run `pnpm changeset version`. It moves the Hub, the images and the CLI to the new version together, consumes the pending changesets and writes the changelogs. Merge it to `main`.
2. **Tag the merge commit and push the tag.**

   ```sh
   git checkout main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. **Watch the [release workflow](../.github/workflows/release.yml).** It runs three jobs in order:
   - **Check the version** compares the tag with `packages/cli/package.json`.
   - **Image** (one job per image, `embertrail` and `embertrail-dashboard`) builds for `linux/amd64` and `linux/arm64` and pushes `:<version>` and `:latest`.
   - **Publish the CLI** runs in the `npm` environment, builds the CLI and publishes it with provenance. It runs after the images, so a published CLI never names an image that isn't there yet. It is skipped unless `NPM_PUBLISH_ENABLED` is `true`.
4. **Check the result.** `npm view @mitcsutt/embertrail-cli --json` should show the new `version` and a `dist.attestations` entry, and the package page should show the provenance badge.

A version can be published to npm only once. If the publish job fails after the images were pushed, fix the cause and re-run the failed job; don't re-tag.

## Prerequisites

The owner does these once. None of them are in the repo, and no secrets are needed.

1. **Publish the package once by hand.** npm sets up trusted publishing on a package's settings page, which exists only once the package does. `@mitcsutt/embertrail-cli@0.0.1` is the placeholder, so the first release from the workflow must be a higher version (`0.1.0`).
2. **Add the trusted publisher.** On npmjs.com, open the package's _Settings > Trusted publishing_ and add a GitHub Actions publisher: owner `mitcsutt`, repository `embertrail`, workflow `release.yml`, environment `npm`, and allow publishing directly. Under _Settings > Publishing access_, choose _Require two-factor authentication and disallow bypass 2fa tokens_. npm marks the publisher as pending until a workflow uses it once, and the pending publisher expires if that doesn't happen in time.
3. **Create the `npm` environment.** Under _Settings > Environments_, create an environment named `npm`. Under _Deployment branches and tags_, restrict it to `main` and the tag pattern `v*`: the workflow runs on a tag, so a `main`-only rule would stop the publish job before it starts. Where GitHub offers required reviewers, add a maintainer so each publish waits for approval.
4. **Switch publishing on.** Under _Settings > Secrets and variables > Actions > Variables_, add a repository variable `NPM_PUBLISH_ENABLED` set to `true`. Until it exists, a tag still builds and pushes the images but skips the npm publish.
5. **Make the images public.** After the first run, open each of the two packages (`embertrail` and `embertrail-dashboard`) under the owner's _Packages_ on GitHub, then _Package settings_, and change the visibility to public. New `ghcr.io` packages start private, and `embertrail up` can't pull a private image without a login.

## Provenance details

npm attaches provenance when a publish goes through trusted publishing from a public repository, and the workflow also sets `NPM_CONFIG_PROVENANCE`. The job needs `id-token: write` for both; it needs nothing else beyond `contents: read`.
