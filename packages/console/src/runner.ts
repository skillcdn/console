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
  DESK_FOLDER,
  DESK_SECTIONS,
  type DeskInput,
  deskFiles,
  deskServicesOf,
  deskWebTitleOf,
  PERSON_DESK_SECTIONS,
  type PersonDeskInput,
  personDeskFiles,
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
  wakePartsOf,
  wakeTextOf,
} from "./runner/message.js";
export { ownRunnerModules } from "./runner/modules.js";
export { createSpawn } from "./runner/process.js";
export {
  cutShown,
  cutShownEnd,
  formsOf,
  MAX_CUT_WINDOW,
  type Redactor,
  redactorOf,
  WITHHELD,
} from "./runner/redact.js";
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
  HOLD_MS,
  MAX_COOL_DOWN_MS,
  MAX_HOLD_MS,
  REPORT_MS,
  type Runner,
  type RunnerClient,
  type RunnerOptions,
  type RunnerState,
  SUBAGENTS_MS,
} from "./runner/runner.js";
export {
  SLACK_APP_TOKEN,
  SLACK_USER_TOKEN,
  type SlackWake,
  slack,
  slackWakeOf,
} from "./runner/slack.js";
export { SYSTEMD_UNIT, systemdUnit, systemdUser } from "./runner/systemd-user.js";
export {
  KEPT_LOGS,
  logKeeper,
  MAX_LOG_BYTES,
  TASK_NAME,
  taskDefinition,
  taskNameOf,
  taskScheduler,
  taskScript,
} from "./runner/task-scheduler.js";
export type {
  Boundary,
  Child,
  Cut,
  Driver,
  DriverEvent,
  DriverMessage,
  DriverSession,
  Fact,
  Picture,
  Probe,
  RaisedWake,
  Service,
  ServiceCommand,
  ServiceInput,
  ServicePlan,
  Spawn,
  StartOptions,
  WakeAccount,
  WakeHost,
  WakePart,
  WakeRead,
  WakeSocket,
  WakeSource,
  WakeWriter,
} from "./runner/types.js";
export {
  errorsShown,
  KEEPER_VARIABLE,
  MAX_ERRORS_SHOWN,
  plainCut,
  plainCutEnd,
} from "./runner/types.js";
