import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import pkg from "./package.json" with { type: "json" };

const PLUGIN_VERSION: string = pkg.version;

/**
 * Migration stub for the `openclaw-security-advisor` to `shell-security`
 * rename. Released as `@kilocode/openclaw-security-advisor@0.1.5`. Both
 * entry points (the `kilocode_security_advisor` tool and the
 * `/security-checkup` slash command) return this notice instead of running
 * a real checkup. The audit code, auth flow, and platform detection were
 * removed in the stub commit and can be restored on the renamed repo via
 * `git revert`.
 */
const MIGRATION_NOTICE: string =
  `## This plugin has moved\n\n` +
  `**\`@kilocode/openclaw-security-advisor\` is now \`@kilocode/shell-security\`.**\n\n` +
  `To continue receiving security checkups, install the new plugin:\n\n` +
  "```\n" +
  `openclaw plugins install @kilocode/shell-security\n` +
  `openclaw plugins enable shell-security\n` +
  `openclaw gateway restart\n` +
  "```\n\n" +
  `Then uninstall this old plugin:\n\n` +
  "```\n" +
  `openclaw plugins uninstall openclaw-security-advisor\n` +
  "```\n\n" +
  `You will need to approve the device auth flow once on the new plugin.\n` +
  `Subsequent checkups are identical to what you got before the rename.\n\n` +
  `### If the install above fails\n\n` +
  `If \`openclaw plugins install @kilocode/shell-security\` returns a 404 or\n` +
  `\`package not found\` error, the new package has not landed on npm yet.\n` +
  `Pin to the last real release of this plugin in the meantime:\n\n` +
  "```\n" +
  `openclaw plugins install @kilocode/openclaw-security-advisor@0.1.4\n` +
  "```\n\n" +
  `0.1.4 is the last non-stub release, still talks to the existing API, and\n` +
  `will keep working. Retry the new install command later once the new\n` +
  `package is published.\n\n` +
  `_pluginVersion: ${PLUGIN_VERSION}_`;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type CommandResult = {
  text: string;
};

type PluginLogger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

/**
 * Minimal PluginApi shape the stub uses. The SDK's full OpenClawPluginApi
 * is much larger, but a migration stub only needs to register the two
 * entry points and log registration.
 */
type PluginApi = {
  logger: PluginLogger;
  registerTool: (tool: unknown) => void;
  registerCommand: (cmd: unknown) => void;
};

function toolResult(content: string): ToolResult {
  return { content: [{ type: "text" as const, text: content }] };
}

export default definePluginEntry({
  id: "openclaw-security-advisor",
  name: "OpenClaw Security Advisor (deprecated)",
  description:
    "DEPRECATED: this plugin has been renamed to @kilocode/shell-security. Install the new plugin to continue receiving security checkups.",
  register(sdkApi: any) {
    const api = sdkApi as PluginApi;

    api.registerTool({
      name: "kilocode_security_advisor",
      description:
        "DEPRECATED migration stub. The plugin has been renamed to @kilocode/shell-security. " +
        "Calling this tool returns a migration notice explaining how to install the new plugin. " +
        "IMPORTANT: Display the returned markdown exactly as is without rewriting, " +
        "summarizing, or reformatting.",
      parameters: {},
      async execute() {
        return toolResult(MIGRATION_NOTICE);
      },
    });

    api.registerCommand({
      name: "security-checkup",
      description:
        "DEPRECATED (migration stub). This plugin has moved to @kilocode/shell-security.",
      acceptsArgs: false,
      handler: async (): Promise<CommandResult> => {
        return { text: MIGRATION_NOTICE };
      },
    });

    api.logger.info?.(
      "openclaw-security-advisor 0.1.5 migration stub loaded. Plugin has moved to @kilocode/shell-security.",
    );
  },
});
