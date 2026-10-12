// What a custom console is built from (docs/architecture.md, "The package and custom consoles"):
// the schemas and the client of the console's API, the components, and the composition of the
// default console. The first layer is also on its own at `@skillcdn/console/api`, for a server or
// a script that wants none of the pages. The styles are `@skillcdn/console/console.css`.

export * from "./api.js";
export {
  Board,
  BoardFilters,
  type BoardFiltersProps,
  type BoardProps,
  byDue,
  filterTasks,
  TaskCard,
} from "./components/board.js";
export {
  Calendar,
  type CalendarProps,
  Week,
  type WeekProps,
  type WeekSegment,
  Workload,
  type WorkloadProps,
  type WorkloadRow,
  weekSegments,
  workloadOf,
} from "./components/calendar.js";
export { CategoryList, type CategoryListProps } from "./components/categories.js";
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
  DecisionLog,
  type DecisionLogProps,
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
export {
  GoalForm,
  type GoalFormProps,
  GoalList,
  type GoalListProps,
  GoalView,
  type GoalViewProps,
} from "./components/goals.js";
export { Markdown, type MarkdownProps } from "./components/markdown.js";
export { PAGE_SIZE, ShowMore, usePaged } from "./components/paged.js";
export {
  ListingForm,
  type ListingFormProps,
  PeopleList,
  type PeopleListProps,
} from "./components/people.js";
export {
  keyOf,
  MemberList,
  type MemberListProps,
  PROJECT_ROLE_LABELS,
  ProjectForm,
  type ProjectFormProps,
  ProjectList,
  type ProjectListProps,
  ProjectMark,
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
export {
  type Brand,
  isPlainClick,
  type LanguageChoice,
  type NavItem,
  Shell,
  type ShellProps,
} from "./components/shell.js";
export { SignIn, type SignInProps } from "./components/sign-in.js";
export { SkillList, type SkillListProps } from "./components/skills.js";
export { TaskForm, type TaskFormProps } from "./components/task-form.js";
export { TaskList, type TaskListProps } from "./components/task-list.js";
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
  CategoryBadge,
  cx,
  Day,
  DueBadge,
  EmptyState,
  formatBytes,
  formatInstant,
  GoalStateBadge,
  PersonChip,
  PRIORITY_LABELS,
  PriorityBadge,
  ProgressBar,
  personName,
  ROLE_LABELS,
  RoleBadge,
  Spinner,
  STATE_LABELS,
  StateBadge,
  Time,
} from "./components/ui.js";
export { WorkList, type WorkListProps } from "./components/work.js";
export { ConnectPage, type ConnectPageProps } from "./connect-page.js";
export {
  type ConsoleApp,
  type ConsoleComponents,
  type ConsoleConfig,
  type CustomPage,
  type CustomPageContext,
  createConsole,
  customPageLabel,
  DEFAULT_COMPONENTS,
} from "./console.js";
export { type ConsoleActions, type ConsoleData, useConsoleData } from "./data.js";
export {
  addDays,
  addMonths,
  dateOf,
  dayOf,
  daysBetween,
  firstDayOfWeek,
  formatDay,
  formatDays,
  formatMonth,
  formatWeekday,
  type GridDay,
  isDay,
  isMonth,
  monthGrid,
  monthOf,
  today,
  weekdays,
  weekOf,
} from "./dates.js";
export { DocsPage, type DocsPageProps } from "./docs-page.js";
export {
  chooseLanguage,
  DEFAULT_LANGUAGES,
  ENGLISH,
  KOREAN,
  LanguageContext,
  type LanguagePack,
  type Messages,
  packFor,
  useLanguage,
  useWords,
} from "./i18n/index.js";
export {
  type BoardFilter,
  boardHref,
  calendarHref,
  connectHref,
  customPageHref,
  type DocsView,
  decisionHref,
  docHref,
  goalHref,
  matchRoute,
  movedFrom,
  type Navigation,
  newDecisionHref,
  newGoalHref,
  newTaskHref,
  PATHS,
  type ProjectPage,
  personAgentsHref,
  personWorkHref,
  projectHref,
  type Route,
  signInFailureOf,
  type TaskFormKind,
  taskHref,
  withoutSignInParam,
  workHref,
} from "./router.js";
export { errorWords, useAction } from "./use-action.js";
