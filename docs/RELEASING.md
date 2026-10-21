# Releasing @ethora/chat-component-rn

A release is one tag `vYY.M.D` on `main`. The Release workflow publishes `@ethora/chat-component-rn` to npm (with provenance) and creates the GitHub release.

## Cut a release

1. Write the changes under `## [Unreleased]` in `CHANGELOG.md` while you work (one entry per change).
2. Start the release, either way:
   - GitHub: Actions > Release > Run workflow. Leave `version` empty for the default, or give `yy.m.d` (no leading zeros). The workflow bumps and tags `main` and publishes that tag.
   - Terminal: `npm run release:ci` (starts the same workflow with the GitHub CLI, no npm login needed), or `npm run release -- --yes --push` (bumps, tags and pushes; the tag push starts the workflow).
   - Your own machine, when GitHub is not available: `npm run release -- --yes` (bump, commit, tag locally), then `npm run publish:npm` (see "From your machine" below).
3. If the `npm-release` environment has required reviewers, approve the publish job.

`npm run release` without `--yes` prints the version and the tag it would use and changes nothing.

## What the workflow does

| Job | What |
|---|---|
| `tag` (manual runs) | `scripts/release.mjs`: `npm version` (package.json, package-lock.json, `src/version.ts` through the `version` script), `CHANGELOG.md` `[Unreleased]` becomes `[<version>]`, commit `chore(release): v<version>`, annotated tag, push of `main` and the tag |
| `ci` | the CI workflow on the release commit: lint (errors), type check, jest, release script tests, `npm run build`, package contents check, consumer smoke test on two React Native lines |
| `package` | checks that the tag equals package.json and `src/version.ts`, is newer than npm's latest and is on `origin/main`; `npm pack` (the `prepack` script cleans and builds `lib/`), `npm run check:package`, `npm publish --dry-run` on the tarball |
| `publish` | `npm publish <tarball> --provenance --access public`, then the GitHub release with the `CHANGELOG.md` section as notes and the tarball attached |

The publish job takes the tarball built and checked by the `package` job; nothing is rebuilt. Running failed jobs again is safe: a version already on npm is skipped and an existing release gets its files replaced.

## From your machine

`npm run publish:npm` publishes to npm without the workflow, for when GitHub Actions is down or you have not set up `NPM_TOKEN`. It publishes without provenance, because provenance needs GitHub's OIDC. The workflow is the normal path.

```bash
npm login                            # once
npm run release -- --yes             # 1. bump, commit and tag v<version> locally
npm run publish:npm -- --dry-run     # 2. all checks, nothing uploaded
npm run publish:npm                  #    checks, then publishes
git push origin HEAD && git push origin v<version>
```

Before it publishes it checks: you are logged in to npm, the working tree is clean, `HEAD` is the commit tagged `v<package.json version>`, the version is not on npm yet and is newer than the latest one, and `npm run ci:local` passes (lint, type check, jest, release script tests, build, package contents). The consumer smoke test runs only in the CI workflow.

## Dry run

Actions > Release > Run workflow with `dry_run` ticked. It rehearses the version bump on the runner, runs CI on `main`, builds and checks the tarball and runs `npm publish --dry-run`. It pushes nothing, publishes nothing and creates no release.

On your machine:

```bash
npm run release                      # plan only
npm run test:release                 # version and changelog rules
npm run build && npm run check:package
npm pack --dry-run --ignore-scripts  # file list
```

## Versions

The version is the UTC date as `yy.m.d` with no leading zeros (`26.10.21`, not `26.10.021`), because npm rejects leading zeros. The default is today's date if that is newer than the latest version; otherwise the day after it. An explicit version must be newer than the latest on npm. `package.json` and `src/version.ts` carry the same version (`__tests__/versionInSync.test.ts` checks it).

## Setup, once

- Secret `NPM_TOKEN`: an npm automation token that can publish `@ethora/chat-component-rn`. Not needed if the package is set up for npm trusted publishing (repository `dappros/ethora-chat-component-rn`, workflow `release.yml`).
- Environment `npm-release`, with required reviewers if you want an approval step.
- The manual run pushes the release commit and the tag to `main` with the workflow token. If `main` is protected, allow the GitHub Actions app to bypass the rule, or release from your terminal with `npm run release -- --yes --push`.
