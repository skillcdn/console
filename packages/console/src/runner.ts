// The runner of an agent account (ADR-0085, docs/specs/runner.md), for whoever builds on it: a
// console of one's own that registers a driver for another product, or a test that runs one
// against a console. The command's `console runner` is made of the same.

export { acpMode, createAcpDriver } from "./runner/acp.js";
export { createClaudeDriver } from "./runner/claude.js";
export { createCodexDriver } from "./runner/codex.js";
export {
  DEFAULT_RUNNER_CONFIG,
  parseRunnerConfig,
  type RunnerConfig,
  runnerConfigSchema,
} from "./runner/config.js";
export {
  DESK_SECTIONS,
  type DeskInput,
  deskFiles,
  deskServicesOf,
} from "./runner/desk.js";
export { LAUNCHD_LABEL, launchd, launchdUnit } from "./runner/launchd.js";
export {
  type Attached,
  attachedLine,
  composeSignals,
  deskName,
  fenced,
  GROUP_WINDOW_MS,
  headerOf,
  introOf,
  MAX_GROUP_LENGTH,
  MAX_GROUP_SIGNALS,
  makeMark,
} from "./runner/message.js";
export { ownRunnerModules } from "./runner/modules.js";
export { createSpawn } from "./runner/process.js";
export { formsOf, redactorOf, WITHHELD } from "./runner/redact.js";
export {
  createRegistry,
  createRunnerModules,
  type DriverHost,
  type Registry,
  type RunnerModules,
} from "./runner/registry.js";
export {
  AUTOSAVE_MESSAGE,
  BATCH_MS,
  COOL_DOWN_MS,
  createRunner,
  HEARTBEAT_MS,
  MAX_COOL_DOWN_MS,
  type Runner,
  type RunnerClient,
  type RunnerOptions,
  type RunnerState,
} from "./runner/runner.js";
export { SLACK_APP_TOKEN, slack, slackWakeOf } from "./runner/slack.js";
export { SYSTEMD_UNIT, systemdUnit, systemdUser } from "./runner/systemd-user.js";
export {
  TASK_NAME,
  taskDefinition,
  taskNameOf,
  taskScheduler,
  taskScript,
} from "./runner/task-scheduler.js";
export type {
  Boundary,
  Child,
  Driver,
  DriverEvent,
  DriverMessage,
  DriverSession,
  Fact,
  Picture,
  Probe,
  Service,
  ServiceCommand,
  ServiceInput,
  ServicePlan,
  Spawn,
  StartOptions,
  WakeHost,
  WakeSocket,
  WakeSource,
} from "./runner/types.js";
export { KEEPER_VARIABLE } from "./runner/types.js";
