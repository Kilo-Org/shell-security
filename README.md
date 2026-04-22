# @kilocode/openclaw-security-advisor

> **This package has been renamed to [`@kilocode/shell-security`](https://www.npmjs.com/package/@kilocode/shell-security).**
>
> Version `0.1.5` of `@kilocode/openclaw-security-advisor` is a migration
> stub. Both the `/security-checkup` slash command and the
> `kilocode_security_advisor` tool return a notice pointing to the new
> package and nothing else.

## Migrating to ShellSecurity

Install the new plugin:

```bash
openclaw plugins install @kilocode/shell-security
openclaw plugins enable shell-security
openclaw gateway restart
```

Uninstall this old plugin:

```bash
openclaw plugins uninstall openclaw-security-advisor
```

You will need to approve the device auth flow once on the new plugin.
After that, subsequent checkups are identical to what you got before
the rename.

## Why the rename?

The original name tied the plugin to OpenClaw specifically. The plugin's
mission (security posture checks for AI-agent shells) is broader than any
single runtime. `ShellSecurity` is the clearer long-term name.

- **New npm package:** [`@kilocode/shell-security`](https://www.npmjs.com/package/@kilocode/shell-security)
- **New repo:** [`Kilo-Org/shell-security`](https://github.com/Kilo-Org/shell-security)

## Last real release

The last non-stub release of this package was `0.1.4`. Users pinned to
`@0.1.4` or earlier can continue running it indefinitely; it still talks
to the existing KiloCode Security Advisor API endpoint and returns real
reports. New features will ship only under `@kilocode/shell-security`.
