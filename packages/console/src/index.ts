// What a custom console is built from (docs/architecture.md, "The package and custom consoles"):
// the schemas and the client of the console's API, the components, and the composition of the
// default console. The first layer is also on its own at `@skillcdn/console/api`, for a server or
// a script that wants none of the pages. The styles are `@skillcdn/console/console.css`.

export * from "./api.js";
export { Board, type BoardProps, TaskCard } from "./components/board.js";
export {
  ConnectApproval,
  type ConnectApprovalProps,
  ConnectCodeForm,
  type ConnectCodeFormProps,
  ConnectWords,
  type ConnectWordsProps,
} from "./components/connect.js";
export { DecisionForm, type DecisionFormProps } from "./components/decision-form.js";
export {
  DecisionCard,
  type DecisionCardProps,
  DecisionList,
  type DecisionListProps,
} from "./components/decision-list.js";
export {
  DocumentCrumbs,
  DocumentFiles,
  type DocumentFilesProps,
  DocumentForm,
  type DocumentFormProps,
  DocumentList,
  type DocumentListProps,
  DocumentSearch,
  type DocumentSearchProps,
  DocumentView,
  type DocumentViewProps,
  FolderView,
  type FolderViewProps,
} from "./components/documents.js";
export { describeEvent, EventFeed, type EventFeedProps } from "./components/event-feed.js";
export { Markdown, type MarkdownProps } from "./components/markdown.js";
export { PeopleList, type PeopleListProps } from "./components/people.js";
export {
  keyOf,
  MemberList,
  type MemberListProps,
  PROJECT_ROLE_LABELS,
  ProjectForm,
  type ProjectFormProps,
  ProjectList,
  type ProjectListProps,
  ProjectRoleBadge,
  VISIBILITY_LABELS,
} from "./components/projects.js";
export {
  RUN_STATUS_LABELS,
  RunCard,
  type RunCardProps,
  RunList,
  type RunListProps,
  RunStatusBadge,
} from "./components/runs.js";
export { isPlainClick, type NavItem, Shell, type ShellProps } from "./components/shell.js";
export { SignIn, type SignInProps } from "./components/sign-in.js";
export { SkillList, type SkillListProps } from "./components/skills.js";
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
  formatBytes,
  formatInstant,
  PersonChip,
  PRIORITY_LABELS,
  PriorityBadge,
  ROLE_LABELS,
  RoleBadge,
  Spinner,
  STATE_LABELS,
  StateBadge,
  Time,
} from "./components/ui.js";
export { ConnectPage, type ConnectPageProps } from "./connect-page.js";
export {
  type ConsoleApp,
  type ConsoleComponents,
  type ConsoleConfig,
  createConsole,
  DEFAULT_COMPONENTS,
} from "./console.js";
export { type ConsoleActions, type ConsoleData, useConsoleData } from "./data.js";
export { DocsPage, type DocsPageProps } from "./docs-page.js";
export {
  connectHref,
  type DocsView,
  decisionHref,
  docHref,
  matchRoute,
  movedFrom,
  type Navigation,
  newDecisionHref,
  newTaskHref,
  PATHS,
  type ProjectPage,
  personAgentsHref,
  projectHref,
  type Route,
  signInFailureOf,
  type TaskFormKind,
  taskHref,
  withoutSignInParam,
} from "./router.js";
export { errorWords, useAction } from "./use-action.js";
