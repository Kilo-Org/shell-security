# @kilocode/openclaw-security-advisor

An [OpenClaw](https://openclaw.ai) plugin that runs a security checkup of
your OpenClaw instance and returns an expert analysis report from
KiloCode cloud.

The plugin takes the output of `openclaw security audit`, sends it to
the KiloCode Security Advisor API for analysis, and returns a detailed
markdown report with findings, risks, prioritized recommendations, and
concrete remediation guidance, displayed directly in your chat.

---

## Install

```bash
openclaw plugins install @kilocode/openclaw-security-advisor
openclaw plugins enable openclaw-security-advisor
openclaw gateway restart
```

On first use, the plugin will walk you through a one-time device auth
flow to connect your KiloCode account.

### Channels

The plugin ships on two npm dist-tags:

- **`latest`** — stable releases (`X.Y.Z`). Default for plain
  `npm install` / `openclaw plugins install`.
- **`dev`** — prerelease snapshots (`X.Y.Z-dev.N`) published ahead of
  stable cuts for early testing. Install with:

  ```bash
  openclaw plugins install @kilocode/openclaw-security-advisor@dev
  # or
  npm install @kilocode/openclaw-security-advisor@dev
  ```

  Dev releases are real npm publishes with the same provenance
  attestation as stable releases (verify with `npm audit signatures`).

You can also install an exact version directly:

```bash
openclaw plugins install @kilocode/openclaw-security-advisor@0.1.0
```

---

## Usage

The plugin exposes two entry points. They do the same thing; pick whichever
fits your workflow.

### `/security-checkup` (recommended)

Type it in chat:

```
/security-checkup
```

This is a slash command. It runs the plugin directly and renders the
full report, bypassing the agent's summarization layer entirely. **Use
this for guaranteed verbatim output.**

### Natural language

You can also just ask the agent:

> Run a KiloCode security checkup

> Check my OpenClaw security

> Audit my OpenClaw config

The agent will call the `kilocode_security_advisor` tool and the report
will appear in chat.

**Heads up:** natural language invocation goes through your configured
language model, which may rewrite or summarize the report before
showing it to you. This works well on capable models (GPT-4o, Claude
Sonnet, Gemini Pro) but small summarizing models (e.g. GPT-4.1-nano,
Haiku) will often paraphrase the report down to a few sentences. **If
you're running a small or summarizing model, use the
`/security-checkup` slash command instead.** It renders the full
report regardless of which model is configured.

---

## First run authentication

The first time you run the checkup, you'll be prompted to connect your
KiloCode account:

```
## Connect to KiloCode

To run a security checkup, connect your KiloCode account.

1. Open this URL in your browser:
   https://app.kilo.ai/device-auth?code=XXXX-XXXX

2. Enter this code: XXXX-XXXX

3. Sign in or create a free account

Once you've approved the connection, run the security checkup again.
```

Open the URL, sign in (or create a free account), and approve the
connection. Then run `/security-checkup` again. The plugin will pick
up the approval, persist your auth token, run the checkup, and return
the report in the same response.

For every run after the first, no auth prompt appears. The saved token
is reused automatically.

---

## What gets sent

The plugin sends the following to the KiloCode Security Advisor API:

- The JSON output of `openclaw security audit` (local config audit
  results, with no secrets, no file contents, just finding IDs and
  summaries)
- Your OpenClaw version and plugin version
- The public IP address of your instance (used for optional remote
  probes)

The plugin **does not** send:

- Your OpenClaw config file contents
- Secrets, tokens, or API keys
- Conversation history or chat data
- Files from your workspace

All requests are authenticated with your KiloCode account token over
HTTPS.

---

## Configuration

The plugin reads its config from `openclaw.json` under
`plugins.entries.openclaw-security-advisor.config`. In most cases, you
won't need to set anything. The defaults work out of the box.

| Field        | Default                | Purpose                                                                 |
| ------------ | ---------------------- | ----------------------------------------------------------------------- |
| `authToken`  | _(set by device auth)_ | Your KiloCode auth token. Managed automatically by the plugin.          |
| `apiBaseUrl` | `https://api.kilo.ai`  | KiloCode API base URL. Override only if you run a self-hosted KiloCode. |

To override via the OpenClaw CLI:

```bash
openclaw config set plugins.entries.openclaw-security-advisor.config.apiBaseUrl https://your-kilocode.example.com
```

### Environment variables

The plugin also respects these environment variables, useful for
non-interactive setups (CI, containerized deployments):

- `KILOCODE_API_KEY` (alias: `KILO_API_KEY`): if set, the plugin uses
  this as the auth token and skips the device auth flow entirely.
  Intended for environments where an operator has already injected the
  key at boot.
- `KILO_API_URL` or `KILOCODE_API_BASE_URL`: override the API base URL
  without touching the plugin config.

Plugin config takes precedence over env vars; env vars take precedence
over the default.

---

## Troubleshooting

**"Your KiloCode authentication has expired"**
The plugin automatically clears expired tokens and reruns the device
auth flow on the next invocation. Just run `/security-checkup` again.

**"Security analysis failed: Rate limit exceeded"**
The KiloCode API rate limits security checkups per account. Wait a
little and try again.

**Natural language invocation paraphrases the report**
This is a limitation of small summarizing language models, not the
plugin. Use `/security-checkup` (the slash command) to bypass the model
entirely and render the full report.

**Plugin doesn't appear in `/plugins list`**
The `/plugins` slash command in OpenClaw chat is gated by a separate
OpenClaw setting. To enable it:

```bash
openclaw config set commands.plugins true
openclaw gateway restart
```

The plugin itself works without this setting. It's only needed if you
want the `/plugins list` chat command to show installed plugins.

---

## Contributing

- [`AGENTS.md`](https://github.com/Kilo-Org/openclaw-security-advisor/blob/main/AGENTS.md) — build, test, lint, code layout, and contribution rules.
- [`RELEASING.md`](https://github.com/Kilo-Org/openclaw-security-advisor/blob/main/RELEASING.md) — how to cut a release.
- [`CHANGELOG.md`](https://github.com/Kilo-Org/openclaw-security-advisor/blob/main/CHANGELOG.md) — release history.

---

## License

MIT
