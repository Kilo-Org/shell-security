# AGENTS.md

`@kilocode/shell-security` (previously `@kilocode/openclaw-security-advisor`)
is an OpenClaw plugin that runs a local `openclaw security audit`, sends it
to the KiloCode ShellSecurity API, and renders the returned markdown report
inline in chat.

- The default branch is `main`.
- Releases are gated on manual `workflow_dispatch` — never publish from a push trigger.
- All commits must be signed by the human user. Do not create commits yourself.

## Build, test, lint

- **Typecheck**: `bun run typecheck`
- **Test**: `bun test`
- **Format check**: `bun run format:check`
- **Format (auto-fix)**: `bun run format`
- **Version resolution (dry-run)**: `KILO_VERSION=0.1.0-beta.2 KILO_CHANNEL=beta bun script/version.ts`

CI enforces all three (typecheck, test, format:check) on every push and PR.
Run them locally before asking the user to commit.

## Changelog

**`CHANGELOG.md` is maintained by hand. Update it in every change that a user
would notice.** There is no changesets tool; the file is the source of truth.

When making a code change:

1. Add an entry under the `## [Unreleased]` section at the top of `CHANGELOG.md`.
2. Use the Keep a Changelog subsection headings: `### Added`, `### Changed`,
   `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
3. Write the entry from the user's point of view — what they'll see, not
   which file changed.
4. Skip changes that don't affect users: refactors, test-only edits, CI-only
   edits, internal doc updates. When in doubt, add it; noise is cheaper than
   missing entries.

When cutting a release:

1. Move everything under `## [Unreleased]` into a new `## [x.y.z] - YYYY-MM-DD`
   section.
2. Leave the empty `## [Unreleased]` heading in place for future entries.
3. Add a new compare-link at the bottom of the file.
4. Commit the changelog update alongside the version bump.

The `files` array in `package.json` includes `CHANGELOG.md`, so it ships in
the published tarball.

## Release flow

Releases are triggered manually from GitHub Actions → `publish` workflow →
"Run workflow". Two channels exist and they map to npm dist-tags:

- **`latest`** — public stable releases (`X.Y.Z`). Default for `npm install`.
- **`dev`** — internal dogfood snapshots (`X.Y.Z-dev.N`). Available via
  `npm install @kilocode/shell-security@dev`.

There is no `beta`, `rc`, `next`, or `canary`. Two channels, that's it.

Common dispatch paths:

- **Auto-bump stable**: `channel=latest`, `bump=patch|minor|major`. Queries
  the highest existing `vX.Y.Z` tag, bumps it, publishes to `latest`.
- **Continue dev cycle**: `channel=dev`, leave bump and version blank.
  Increments the dev counter on the highest existing `*-dev.N` tag.
- **Reset dev cycle**: `channel=dev`, `bump=minor` (or major/patch). Seeds
  `${next-stable}-dev.1`. Use after shipping a stable release to start
  the next dev cycle.
- **Explicit version**: any channel, `version=X.Y.Z` or `X.Y.Z-dev.N`.
  Wins over bump.

`script/version.ts` handles all of the above. See the top-of-file docstring
for full env var semantics. The workflow fails fast if the target tag
already exists on GitHub.

For full step-by-step release instructions see [RELEASING.md](./RELEASING.md).

### Branch protection and the release commit

The publish workflow pushes commits and/or tags to `main` as
`github-actions[bot]`, using the default `GITHUB_TOKEN`.

- **Stable releases** (`channel=latest`) commit the `package.json` version
  bump back to `main` AND push the tag.
- **Dev releases** (`channel=dev`) push only the tag (pointing at an
  orphan commit). `main` history stays clean.

Once branch protection / repository rulesets are enabled on `main`, the
`github-actions[bot]` actor **must be added to the ruleset's bypass actors
list**, otherwise stable releases will fail at the push step _after_
`npm publish` has already succeeded — leaving npm and GitHub out of sync.
Dev releases are less affected (no commit to `main`) but still need tag
push to be allowed, which most rulesets permit by default.

This is a stopgap. The long-term plan is to adopt the same `kilo-maintainer`
GitHub App pattern used by the kilocode monorepo
(`kilocode/.github/actions/setup-git-committer/action.yml`), which signs
release commits as the App and has explicit bypass permissions. That
migration requires Kilo-Org admin access to install the App on this repo
and configure secrets, so it's deferred until an org admin is available.

Until then, release commits:

- are authored by `github-actions[bot]`
- are unsigned
- bypass branch protection via the ruleset allowlist (not via an App token)

## Code layout

- `index.ts` — plugin entry point; registers the `kilocode_shell_security`
  tool and two slash commands (`/shell-security` canonical, `/security-checkup`
  legacy alias for users migrating from `@kilocode/openclaw-security-advisor`).
  Both slash commands route to the same handler. Shared `runShellSecurityFlow`
  handles all auth paths (env token, saved token, pending device auth, new
  device auth).
- `src/audit.ts` — runs `openclaw security audit --json`, parses + validates
  output, fetches public IP.
- `src/client.ts` — HTTP client for the ShellSecurity API; throws
  `AuthExpiredError` on 401.
- `src/platform.ts` — detects `kiloclaw` vs `openclaw`. Kept separate from
  `audit.ts` so the plugin loader's "env read + network send" security
  heuristic doesn't flag the combined file.
- `src/auth/device-auth.ts` — `startDeviceAuth` + `pollDeviceAuth` helpers.
- `src/auth/token-store.ts` — persists auth token to
  `~/.openclaw/secrets/shell-security-auth-token` (mode 600) and
  patches `openclaw.json` with a `SecretRef`. Also manages the pending
  device-auth code file. `patchConfig` is covered by unit tests.

## Testing

Tests live under `test/` and use `bun test`. `bunfig.toml` preloads
`test/preload.ts`, which aliases the SDK virtual path
`openclaw/plugin-sdk/zod` to the real `zod` devDep so schemas can be imported
in a non-plugin-host runtime.

Add tests for new pure functions. Filesystem + network code is harder to test
and currently relies on the end-to-end docker loop described in the README.
