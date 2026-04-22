# Changelog

All notable changes to `@kilocode/openclaw-security-advisor` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Plugin now forwards the active chat surface to the server as `source.channel` on every checkup request. The slash-command path reads `PluginCommandContext.channel` and the tool/natural-language path reads `OpenClawPluginToolContext.messageChannel` (tool registration converted to factory form so the ctx is accessible at tool-instantiation and closed over by `execute()`). Server uses this hint to pick a channel-appropriate format (e.g. collapsible `<details>` blocks on capable UIs, flat markdown on Telegram/Slack). Backward-compatible with older servers: the field is optional in the client payload and servers that don't declare it in their zod schema silently drop it at parse time (no coordinated release required).

### Removed

- `maybeAppendUpdateReminder()` and the plugin-side update-reminder footer introduced in 0.1.3. The footer was presentation logic in the wrong layer — it forced a plugin release to change cadence, copy, or enablement, and only the plugin could decide when to show it. The reminder moves to the server (owner of all report rendering), where it can key off the reported `source.pluginVersion` to show a reminder only when the client is actually behind, and where admins can edit copy/cadence via the content catalog without a plugin release.

### Fixed

- KiloClaw platform detection now uses four independent signals instead of relying on a single env var, so detection holds across KiloClaw deployments of varying age. `detectPlatform()` now walks (in order, short-circuiting on the first hit): (1) `plugins.entries.kiloclaw-customizer.enabled` in `openclaw.json`, (2) `plugins.load.paths` containing the kiloclaw customizer install path, (3) `process.env.KILOCLAW_SANDBOX_ID`, (4) `process.env.KILOCODE_FEATURE === "kiloclaw"`. The two config-side signals are written by the KiloClaw controller at boot and are present on every KiloClaw instance since the customizer plugin was introduced, so they catch older deployments that predate the env-var signals. Internal signature change: `detectPlatform()` now takes the loaded openclaw config so it can inspect the config-side signals.
- First-time device auth no longer triggers a brief gateway restart after the token is captured. The plugin now registers `reload.noopPrefixes` for `plugins.entries.openclaw-security-advisor.config.authToken`, so the SecretRef patch written to `openclaw.json` after device auth is classified as a noop by the gateway reload planner instead of falling through to the default `plugins.* → restart` rule. The security checkup report is returned in the same response with no connection interruption. Scope is intentionally limited to the `authToken` field — `apiBaseUrl` and other config changes still take effect via the normal restart path.
- Release workflow: consolidated post-publish git/GitHub operations into a single atomic step with retries, eliminating a race condition where the version bump commit and tag could be pushed separately. Registry verification is now informational-only and never blocks tag/release steps.
- Release workflow: added a `Reconcile latest dist-tag` step that automatically repoints `npm dist-tags.latest` back to the highest stable version after a dev publish, preventing npm's first-publish auto-assign behavior from routing plain `npm install` users to a prerelease.

### Documentation

- README `Usage` section now documents slash-command channel compatibility: `/security-checkup` works in the OpenClaw native control UI chat and in Telegram but not in Kilo Chat or Slack. Kilo Chat and Slack users should invoke the plugin via natural language so the agent calls the `kilocode_security_advisor` tool directly.
- `kilocode_security_advisor` tool description now hints the agent to invoke the tool directly (rather than suggesting the slash command) in channels that don't route OpenClaw slash commands, namely Kilo Chat and Slack.
- Security checkup reports now occasionally append an inline "stay current" footer with the `npm view @kilocode/openclaw-security-advisor version` check and the `openclaw plugins install … && openclaw gateway restart` upgrade commands. The footer fires on roughly 20% of successful reports and is path-agnostic — applied at the markdown layer in `doCheckup`, so it surfaces on both the `/security-checkup` slash command path (which bypasses the LLM) and the natural-language `kilocode_security_advisor` tool path.
- README has a new `Staying up to date` section documenting the version-check and upgrade commands, plus a note that the report itself will periodically include this tip on either invocation path.
- RELEASING.md: added a prominent top-of-document banner describing the current state — `github-actions[bot]` is not on the `main` ruleset's bypass list, so every stable publish will fail at the post-publish push step. The banner documents the typical outcome (tag lands on origin, commit on `main` is rejected, GitHub release is not created) and gives the one-command recovery: `gh release create vX.Y.Z --verify-tag --generate-notes`. `--verify-tag` makes `gh` fail fast if the tag is missing rather than silently minting one at current `main` HEAD. The rare case where the tag is also missing points at Scenario 4 for the full reconstruct-and-push flow. Expanded the `Branch protection` section with the two durable fix options (add bot to bypass list vs refactor stable path to tag-only).
- README install section leads with the plain install command (no `@dev` suffix) now that a stable release is shipping. The dev channel is documented as a prerelease option under `Channels`.
- README `Contributing` links to `AGENTS.md`, `RELEASING.md`, and `CHANGELOG.md` are now absolute GitHub URLs, so they resolve correctly on the npm package page (those docs were never shipped in the tarball).
- README now documents `KILO_API_KEY` as an alias for `KILOCODE_API_KEY` (both have always been accepted by the code).
- Removed the stale "The gateway restarts after device auth" troubleshooting entry. The restart no longer happens after the `reload.noopPrefixes` fix above.
- Exact-version install example updated from `0.1.0-dev.1` to `0.1.0`.
- RELEASING.md documents the first-publish `latest` dist-tag quirk, the workflow's reconciliation step, and what its expected `::warning::` output means.

### Packaging

- Added npm `keywords` to `package.json` (`openclaw`, `kiloclaw`, `kilocode`, `security`) for registry discoverability.

## [0.1.0-dev.1] - 2026-04-15

Initial dev release.

### Added

- `/security-checkup` slash command and `kilocode_security_advisor` tool, both backed by a shared flow that runs `openclaw security audit --json`, sends it to the KiloCode Security Advisor API, and renders the returned markdown report inline.
- Device auth flow for self-hosted OpenClaw users: first invocation shows a connect URL + code; second invocation polls, persists the token, and runs the checkup in the same response.
- `KILOCODE_API_KEY` env var path for pre-authenticated environments (e.g. KiloClaw).
- Explicit `authToken` / `apiBaseUrl` plugin config for manual overrides.
- Auth recovery: expired tokens are cleared and the plugin falls through to device auth in the same response.
- Audit output validated with a Zod schema at the plugin boundary.
- Public IP detection via `ifconfig.me` with IPv4/IPv6 validation.

[Unreleased]: https://github.com/Kilo-Org/openclaw-security-advisor/compare/v0.1.0-dev.1...HEAD
[0.1.0-dev.1]: https://github.com/Kilo-Org/openclaw-security-advisor/releases/tag/v0.1.0-dev.1
