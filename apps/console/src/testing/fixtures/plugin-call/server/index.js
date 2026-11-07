// A plugin that is its page and nothing else: what the frame holds is the test (ADR-0066).
// Written as the plain object definePlugin yields.
export default {
  pluginApi: 1,
  collections: [],
  commands: {},
  queries: {},
  endpoints: {},
  on: {},
  jobs: {},
  upgrades: [],
  api: {},
  onEnable: null,
  onDisable: null,
};
