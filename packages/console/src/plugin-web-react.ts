// The bridge as a React hook, for a plugin that chooses React: `usePlugin()`.

export type { PluginFrame, PluginFrameContext } from "./plugin/web.js";
export { sharedConnection, type UsePlugin, usePlugin } from "./plugin/web-react.js";
