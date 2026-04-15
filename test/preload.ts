// Test preload. The runtime plugin host provides four virtual SDK
// modules (`openclaw/plugin-sdk/{plugin-entry,fetch-runtime,run-command,zod}`)
// that aren't real npm packages — they're aliased internally by the
// plugin loader. Tests run without that host, so we have to register
// stand-ins for each virtual path here. Bun's resolver looks up these
// mocks before falling through to node_modules / the file system.
//
// `zod` aliases to the real zod devDep so schema imports get a working
// implementation. The other three are stubbed with `any`-shaped objects
// because no test currently exercises code paths that actually call
// them — extend the stubs if a future test reaches one of these helpers.
import { mock } from "bun:test";
import { z } from "zod";

mock.module("openclaw/plugin-sdk/zod", () => ({ z }));
mock.module("openclaw/plugin-sdk/fetch-runtime", () => ({
  resolveFetch: () => null,
}));
mock.module("openclaw/plugin-sdk/run-command", () => ({
  runPluginCommandWithTimeout: async () => ({
    code: 0,
    stdout: "",
    stderr: "",
  }),
}));
mock.module("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (config: unknown) => config,
}));
