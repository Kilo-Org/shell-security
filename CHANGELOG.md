# Changelog

All notable changes to `@kilocode/openclaw-security-advisor` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
