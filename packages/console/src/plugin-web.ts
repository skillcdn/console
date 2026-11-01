// The frame's side of the bridge (docs/specs/plugins.md, "The bridge"), for a plugin's web bundle:
// `connect()` and the messages. Depends on nothing; runs in a browser.

export {
  BRIDGE_EVENT_KINDS,
  BRIDGE_METHODS,
  type BridgeCommandResult,
  type BridgeError,
  type BridgeEventKind,
  type BridgeFile,
  type BridgeInit,
  type BridgeMethod,
  type BridgePerson,
  type BridgeToFrame,
  type BridgeToPage,
  isBridgePath,
  isBridgeToFrame,
  isBridgeToPage,
  MAX_BRIDGE_PATH_LENGTH,
  MAX_BRIDGE_TITLE_LENGTH,
  PLUGIN_BRIDGE_VERSION,
} from "./plugin/bridge.js";
export type { LinkTarget, PluginRecord, RecordPage, RecordVersion } from "./plugin/context.js";
export {
  applyTheme,
  type ConnectOptions,
  connect,
  type FrameDocument,
  type FrameMessageEvent,
  type FrameRecordsQuery,
  type FrameWindow,
  PluginBridgeError,
  type PluginFrame,
  type PluginFrameContext,
} from "./plugin/web.js";
