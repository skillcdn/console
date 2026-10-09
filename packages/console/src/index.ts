// What a custom console is built from (docs/architecture.md, "The package and custom consoles"):
// the schemas and the client of the console's API, the components, and the composition of the
// default console. The first layer is also on its own at `@skillcdn/console/api`, for a server or
// a script that wants none of the pages. The styles are `@skillcdn/console/console.css`.

export * from "./api.js";
export { Board, type BoardProps, TaskCard } from "./components/board.js";
export { DecisionForm, type DecisionFormProps } from "./components/decision-form.js";
export {
  DecisionCard,
  type DecisionCardProps,
  DecisionList,
  type DecisionListProps,
} from "./components/decision-list.js";
export { describeEvent, EventFeed, type EventFeedProps } from "./components/event-feed.js";
export { Markdown } from "./components/markdown.js";
export { type NavItem, Shell, type ShellProps } from "./components/shell.js";
export { SignIn, type SignInProps } from "./components/sign-in.js";
export { TaskForm, type TaskFormProps } from "./components/task-form.js";
export { TaskView, type TaskViewProps } from "./components/task-view.js";
export {
  NewToken,
  type NewTokenProps,
  TokenForm,
  type TokenFormProps,
  TokenList,
  type TokenListProps,
} from "./components/tokens.js";
export {
  Avatar,
  Badge,
  Button,
  Callout,
  cx,
  EmptyState,
  formatInstant,
  PersonChip,
  PRIORITY_LABELS,
  PriorityBadge,
  Spinner,
  STATE_LABELS,
  StateBadge,
  Time,
} from "./components/ui.js";
export {
  type ConsoleApp,
  type ConsoleComponents,
  type ConsoleConfig,
  createConsole,
  DEFAULT_COMPONENTS,
} from "./console.js";
export { type ConsoleActions, type ConsoleData, useConsoleData } from "./data.js";
export {
  matchRoute,
  PATHS,
  type Route,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";
