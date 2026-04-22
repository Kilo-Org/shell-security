import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AuthExpiredError, submitAudit } from "./src/client.js";
import { runAudit, getPublicIp } from "./src/audit.js";
import { detectPlatform } from "./src/platform.js";
import { startDeviceAuth, pollDeviceAuth } from "./src/auth/device-auth.js";
import {
  writeStoredToken,
  readTokenFromFile,
  clearStoredToken,
  readPendingCode,
  writePendingCode,
  clearPendingCode,
  type PluginLogger,
  type PluginRuntimeConfig,
} from "./src/auth/token-store.js";
import pkg from "./package.json" with { type: "json" };

const PLUGIN_VERSION: string = pkg.version;
const DEFAULT_API_BASE = "https://api.kilo.ai";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type CommandResult = {
  text: string;
};

type ToolRegistration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: () => Promise<ToolResult>;
};

/**
 * Minimal shape of the SDK's OpenClawPluginToolContext that we actually
 * read. The full type lives in the SDK and is not re-exported to plugins;
 * we only need the active chat surface (if any) to forward to the server
 * for channel-aware report formatting. Declared structurally so we stay
 * decoupled from internal SDK type evolution.
 */
type PluginToolContext = {
  messageChannel?: string;
};

type ToolFactory = (ctx: PluginToolContext) => ToolRegistration;

/**
 * Minimal shape of the SDK's PluginCommandContext that we actually read.
 * Same rationale as PluginToolContext — we only need the chat surface
 * for the server-side formatter hint.
 */
type PluginCommandContext = {
  channel?: string;
};

type CommandRegistration = {
  name: string;
  description: string;
  acceptsArgs: boolean;
  handler: (ctx: PluginCommandContext) => Promise<CommandResult>;
};

/**
 * Structural type covering the parts of the OpenClaw plugin API this
 * plugin uses. The full API is runtime-provided by the gateway; we only
 * constrain the fields we touch so we keep type safety without pinning
 * to the (internal, evolving) full SDK type. Field optionality matches
 * the SDK's OpenClawPluginApi shape so register(api) type-checks.
 */
type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  runtime: {
    config: PluginRuntimeConfig;
  };
  // SDK accepts either a tool object or a factory that returns one. We
  // use the factory form so we can capture `messageChannel` from the
  // runtime-provided tool context at tool-creation time and forward it
  // to the server on every invocation.
  registerTool: (tool: ToolRegistration | ToolFactory) => void;
  registerCommand: (cmd: CommandRegistration) => void;
};

/**
 * Coerce a chat-surface string from the SDK into the value we forward to
 * the server. Trims, and treats empty-after-trim as "no channel known"
 * so we don't send `source.channel: ""` and trigger server-side handling
 * of an ambiguous signal.
 */
function normalizeChannel(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveEnvToken(): string | null {
  return process.env.KILOCODE_API_KEY ?? process.env.KILO_API_KEY ?? null;
}

function resolveApiBase(pluginConfig: Record<string, unknown> | null): string {
  const configUrl = pluginConfig?.apiBaseUrl;
  if (typeof configUrl === "string" && configUrl.length > 0) return configUrl;
  if (process.env.KILO_API_URL) return process.env.KILO_API_URL;
  const gatewayUrl = process.env.KILOCODE_API_BASE_URL;
  if (gatewayUrl) {
    try {
      return new URL(gatewayUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_API_BASE;
}

function toolResult(content: string): ToolResult {
  return { content: [{ type: "text" as const, text: content }] };
}

/**
 * Top-level wrapper around runShellSecurityFlow. Catches any
 * unexpected throw from the flow (transient network errors during
 * runAudit, the server returning a non-401 failure, writeStoredToken
 * blowing up with EPERM, etc.) and converts it to a user-friendly
 * markdown string so the command / tool handler never surfaces a raw
 * stack to the chat. Recognized error paths (AuthExpiredError, the
 * server returning a rate_limited body, audit script returning a
 * non-zero exit code) are already handled inside the flow and return
 * their own specific messages; this is the last-resort safety net.
 */
async function runFlowSafe(
  api: PluginApi,
  apiBase: string,
  channel: string | undefined,
): Promise<string> {
  try {
    return await runShellSecurityFlow(api, apiBase, channel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.error?.(`shell-security: unexpected failure: ${message}`);
    return (
      `Security checkup failed unexpectedly: ${message}\n\n` +
      `Check the openclaw gateway logs for details, or try again.`
    );
  }
}

/**
 * Shared shell-security flow used by both the registerTool entry point
 * (natural language invocation via the LLM) and the registerCommand entry
 * point (deterministic /security-checkup slash command).
 *
 * Returns plain markdown. Callers wrap it in whatever shape their
 * registration API expects.
 */
async function runShellSecurityFlow(
  api: PluginApi,
  apiBase: string,
  channel: string | undefined,
): Promise<string> {
  // Path 0: user explicit config. If `plugins.entries.shell-security.config.authToken`
  // is set (as a plain string directly, or as a SecretRef resolved by
  // OpenClaw before we see it), honor it. This is the path for users
  // who want to configure the plugin manually in openclaw.json without
  // going through device auth, and it respects the schema contract
  // documented in openclaw.plugin.json + README. Explicit user config
  // wins over everything else.
  const configToken = api.pluginConfig?.authToken;
  if (typeof configToken === "string" && configToken.length > 0) {
    try {
      return await doCheckup(api, apiBase, configToken, channel);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return (
          "The `authToken` configured for this plugin in your openclaw.json is invalid or expired. " +
          "Update `plugins.entries.shell-security.config.authToken` with a fresh KiloCode API key and try again."
        );
      }
      throw err;
    }
  }

  // Path A: KiloClaw. KILOCODE_API_KEY env var injected at VM boot.
  // If this token is expired we can't auto recover (env vars are set
  // externally), so tell the user clearly.
  const envToken = resolveEnvToken();
  if (envToken) {
    try {
      return await doCheckup(api, apiBase, envToken, channel);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return (
          "Your `KILOCODE_API_KEY` environment variable is invalid or expired. " +
          "Update the env var with a fresh KiloCode API key and try again."
        );
      }
      throw err;
    }
  }

  // Path B: returning self-hosted user. Read token directly from secrets
  // file. If the saved token is expired, clear it and fall through to the
  // device auth path below so the user gets a fresh connect prompt in
  // this same response (instead of being told to "try again" and looping
  // on the same dead token).
  const savedToken = await readTokenFromFile();
  if (savedToken) {
    try {
      return await doCheckup(api, apiBase, savedToken, channel);
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) throw err;
      await clearStoredToken();
      // fall through to Path C1 (device auth initiation)
    }
  }

  // Path C2: pending code exists from a previous call. User completed
  // the browser flow, now poll and finalize.
  const pending = await readPendingCode();
  if (pending) {
    const pollResult = await pollDeviceAuth(apiBase, pending, api.logger);

    if (pollResult.kind === "approved") {
      await clearPendingCode();

      // Run the checkup with the freshly approved token BEFORE persisting
      // it. Writing the token triggers a config write which causes a
      // gateway restart. If we ran the checkup after that, the user would
      // see a "connected, run me again" stub and have to invoke a third
      // time. Doing the checkup first lets us return the actual report on
      // this invocation. The token persist still happens after, so
      // subsequent invocations skip device auth and go straight to Path B.
      const reportMarkdown = await (async (): Promise<string> => {
        try {
          return await doCheckup(api, apiBase, pollResult.token, channel);
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            // Edge case: server approved the token but immediately
            // rejected the audit request with 401. Shouldn't normally
            // happen.
            return (
              "Connected to KiloCode, but the audit request was rejected. " +
              "Run the security checkup again to retry."
            );
          }
          throw err;
        }
      })();

      try {
        await writeStoredToken(api, pollResult.token);
      } catch (err) {
        // Don't fail the response shown to the user. They already have
        // their report from doCheckup. Worst case: token isn't saved and
        // they redo device auth next time.
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(
          `shell-security: failed to persist auth token: ${message}`,
        );
      }

      return reportMarkdown;
    }

    if (pollResult.kind === "denied") {
      await clearPendingCode();
      return "Authentication was denied. Run the security checkup again to start over.";
    }

    if (pollResult.kind === "expired") {
      // Server reported the device auth code is dead (410 Gone or
      // explicit expired status). Clear and start over.
      await clearPendingCode();
      return "Authentication code expired. Run the security checkup again to get a fresh code.";
    }

    if (pollResult.kind === "timeout") {
      // Our local poll deadline was hit while the server was still
      // returning pending. The code may still be valid server-side.
      // Leave the pending code in place so the next invocation picks up
      // where we left off, and tell the user to retry once they've
      // approved in the browser.
      return (
        "Still waiting for you to approve in the browser.\n\n" +
        "Once you've approved, run the security checkup again and we'll pick up where we left off."
      );
    }
    // pollResult.kind === "pending" (shouldn't reach here: pollDeviceAuth
    // loops internally until a terminal state or timeout). Fall through
    // to treat as timeout for safety.
    return (
      "Still waiting for you to approve in the browser.\n\n" +
      "Once you've approved, run the security checkup again."
    );
  }

  // Path C1: new self-hosted user. Initiate device auth.
  const authStart = await startDeviceAuth(apiBase);
  await writePendingCode(authStart.code);
  const minutes = Math.round(authStart.expiresIn / 60);

  return (
    `## Connect to KiloCode\n\n` +
    `To run a security checkup, connect your KiloCode account.\n\n` +
    `**1. Open this URL in your browser:**\n` +
    `${authStart.verificationUrl}\n\n` +
    `**2. Enter this code:** \`${authStart.code}\`\n\n` +
    `**3. Sign in or [create a free account](https://kilo.ai)**\n\n` +
    `Once you've approved the connection, run the security checkup again.\n` +
    `*(Code expires in ${minutes} min)*`
  );
}

async function doCheckup(
  api: PluginApi,
  apiBase: string,
  token: string,
  channel: string | undefined,
): Promise<string> {
  const auditResult = await runAudit();
  if (!auditResult.ok) {
    return auditResult.error;
  }

  const publicIp = await getPublicIp();

  const response = await submitAudit(apiBase, token, {
    audit: auditResult.audit,
    publicIp,
    source: {
      platform: detectPlatform(api.runtime.config.loadConfig()),
      method: "plugin",
      pluginVersion: PLUGIN_VERSION,
      // Only include `channel` when we actually know it. Sending an empty
      // string would force the server to special-case unknown-vs-absent;
      // absent + zod's unknown-key strip on older servers are both safe.
      ...(channel !== undefined ? { channel } : {}),
    },
  });
  return response.report.markdown;
}

export default definePluginEntry({
  id: "shell-security",
  name: "ShellSecurity",
  description:
    "Run a security checkup of your OpenClaw instance and get an expert analysis report from KiloCode.",
  // The gateway reload planner classifies any change under `plugins.*`
  // as `kind: "restart"` by default. writeStoredToken() patches
  // plugins.entries.shell-security.config.authToken with a
  // SecretRef after device auth, which would force a full gateway
  // restart on first-time token capture. Plugin-registered reload
  // rules are evaluated before the base rules (first-match wins), so
  // declaring just the authToken path as a noop shadows the base
  // restart rule for that one field without affecting anything else.
  //
  // Scope is intentionally narrow — only `.config.authToken`, NOT the
  // full `.config` subtree. `apiBaseUrl` is captured as a snapshot in
  // register() (see `pluginConfig` below), so runtime updates to it
  // still need to fall through to the base `plugins.* → restart` rule
  // to take effect. The plugin reads the token directly from disk via
  // readTokenFromFile() on every invocation, so authToken noop is safe.
  reload: {
    noopPrefixes: ["plugins.entries.shell-security.config.authToken"],
  },
  // The SDK's OpenClawPluginApi type is large and internal. We narrow
  // to our own structural PluginApi (declared above) immediately on
  // entry so everything inside this function is strongly typed.
  register(sdkApi: any) {
    const api = sdkApi as PluginApi;
    const pluginConfig = (api.pluginConfig ?? null) as Record<
      string,
      unknown
    > | null;

    // Entry point 1: tool for natural language invocation via the LLM.
    // Works on capable models (GPT-4o, Claude Sonnet). Small summarizing
    // models (e.g. gpt-4.1-nano) may paraphrase the report instead of
    // displaying it verbatim. For those models, the slash command path
    // below is deterministic.
    //
    // Registered as a factory (`(ctx) => toolDef`) rather than a bare
    // tool object so the SDK's OpenClawPluginToolContext is available.
    // We read `ctx.messageChannel` once at tool-instantiation and close
    // over it; every subsequent `execute()` forwards the same channel to
    // the server for channel-aware report formatting. The factory is
    // re-invoked per tool-collection event (session start, agent spawn),
    // so long-running sessions that outlive a channel switch get the
    // refreshed channel automatically.
    api.registerTool((toolCtx: PluginToolContext) => ({
      name: "kilocode_shell_security",
      description:
        "Run a comprehensive security checkup of this OpenClaw instance. " +
        "USE THIS TOOL whenever the user asks to: check, audit, scan, review, or " +
        "analyze OpenClaw security; run a 'security check', 'security checkup', " +
        "'security audit', or 'security review'; or asks about security posture, " +
        "misconfigurations, or hardening. " +
        "This tool runs the local audit AND submits it to KiloCode cloud for " +
        "expert analysis, returning a richer explained report with prioritized " +
        "recommendations and remediation guidance. " +
        "DO NOT run `openclaw security audit` via bash for these requests. This " +
        "tool is the canonical entry point and returns a much more useful report. " +
        "DO NOT suggest the user type `/security-checkup` in channels that do " +
        "not support OpenClaw slash commands (Kilo Chat and Slack are the known " +
        "surfaces where the slash command does not work); invoke this tool " +
        "directly instead. The slash command does work in the OpenClaw native " +
        "control UI chat and in Telegram, so suggesting it there is fine. " +
        "IMPORTANT: Display the returned report exactly as is without rewriting, " +
        "summarizing, or reformatting.",
      parameters: {},
      async execute() {
        const apiBase = resolveApiBase(pluginConfig);
        const channel = normalizeChannel(toolCtx.messageChannel);
        const markdown = await runFlowSafe(api, apiBase, channel);
        return toolResult(markdown);
      },
    }));

    // Entry point 2: slash command for deterministic invocation that
    // bypasses the LLM. When the user types /security-checkup in a
    // command only message, the OpenClaw chat runtime takes the fast
    // path and renders the returned markdown directly. No agent loop,
    // no summarization.
    api.registerCommand({
      name: "security-checkup",
      description:
        "Run a KiloCode security checkup of this OpenClaw instance and display the full report.",
      acceptsArgs: false,
      handler: async (ctx: PluginCommandContext) => {
        const apiBase = resolveApiBase(pluginConfig);
        const channel = normalizeChannel(ctx.channel);
        const markdown = await runFlowSafe(api, apiBase, channel);
        return { text: markdown };
      },
    });

    api.logger.info?.("Registered tool: kilocode_shell_security");
    api.logger.info?.("Registered command: /security-checkup");
  },
});
