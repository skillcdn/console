import type {
  RestAnswerInput,
  RestCategory,
  RestComment,
  RestDecision,
  RestDecisionInput,
  RestDecisionPatch,
  RestEvent,
  RestGoal,
  RestPerson,
  RestRun,
  RestTask,
  RestTaskInput,
  TaskState,
} from "../api.js";
import { formatDay } from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import type { TaskFormKind } from "../router.js";
import { TASK_STATES } from "../vocabulary.js";
import { type CommentDraft, TaskThread } from "./comments.js";
import { DecisionForm } from "./decision-form.js";
import { EventFeed } from "./event-feed.js";
import { Markdown } from "./markdown.js";
import { type GoalSearch, TaskForm, type TaskSearch } from "./task-form.js";
import {
  Badge,
  Button,
  CategoryBadge,
  DueBadge,
  PersonChip,
  PriorityBadge,
  StateBadge,
  Time,
} from "./ui.js";

// One task: what it is, who it is on, what it links to, the discussion on it, which is what was
// said about it with the agents at work on it and the decisions about it in the order they
// came (ADR-0024), the tasks that are part of it, everything that happened to it, and the ways
// to change it. Takes its data as props and nothing from the network; which of its forms is
// open is told by the page, since each form has an address of its own (ADR-0010). The facts
// beside the text say only what is set: a plan, a category or a goal the task has none of is
// not a row.

export interface TaskViewProps {
  readonly task: RestTask;
  readonly people: readonly RestPerson[];
  /** The current tasks of the board, for the breakdown and for naming what this one is part of. */
  readonly tasks: readonly RestTask[];
  /** The task this one is part of, when the page has it: one put away is not among `tasks`. Left out, it is looked for among them. */
  readonly parent?: RestTask | undefined;
  /** What words find among the tasks and the open goals of the project, for the form (ADR-0037); left out, the form offers neither. */
  readonly findTasks?: TaskSearch | undefined;
  readonly findGoals?: GoalSearch | undefined;
  readonly decisions: readonly RestDecision[];
  /** The runs of the board, or of this task; the ones on this task are shown. */
  readonly runs?: readonly RestRun[] | undefined;
  /** The comments on the task, oldest first, when the page has read them. */
  readonly comments?: readonly RestComment[] | undefined;
  /** Everything that happened to the task, oldest first, when the page has read it. */
  readonly history?: readonly RestEvent[] | undefined;
  /** The categories of the workspace, for the form. */
  readonly categories?: readonly RestCategory[] | undefined;
  /** The goals of the project, for the form and for naming the one the task works towards. */
  readonly goals?: readonly RestGoal[] | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where a decision is answered, for a run that waits for one. */
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  /** Where a goal of the roadmap is read. */
  readonly goalHref?: ((goalId: string) => string) | undefined;
  /** Where a file of the project is read, by its id: one a run handed in, or one put in a comment. */
  readonly fileHref?: ((fileId: string) => string) | undefined;
  /** Where a document of the project is read, by its path, for the links in what was written. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** The day to count due days from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** The form open on the page, if one: the task edited, or a decision raised about it. */
  readonly form?: TaskFormKind | undefined;
  /** Where each form is opened; left out, the forms cannot be opened from here. */
  readonly formHref?: ((form: TaskFormKind) => string) | undefined;
  /** Called when a form is cancelled. */
  readonly onCancel?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onChange: (task: RestTask, patch: RestTaskInput) => void;
  readonly onMove: (task: RestTask, state: TaskState) => void;
  readonly onRaiseDecision: (input: RestDecisionInput) => void;
  readonly onAnswer: (decision: RestDecision, input: RestAnswerInput) => void;
  /** Called to grow a decision's record with what followed. */
  readonly onUpdateDecision?:
    | ((decision: RestDecision, patch: RestDecisionPatch) => void)
    | undefined;
  readonly onAbandonRun?: ((run: RestRun) => void) | undefined;
  /** Called to put a done or dropped task away, and to bring one back (ADR-0029); left out, neither is offered. */
  readonly onArchive?: ((task: RestTask) => void) | undefined;
  readonly onRestore?: ((task: RestTask) => void) | undefined;
  /** Called with a word for the discussion, and the files put in it. Left out, nothing can be said here. */
  readonly onComment?: ((draft: CommentDraft) => void) | undefined;
}

export function TaskView(props: TaskViewProps) {
  const words = useWords();
  const { tag } = useLanguage();
  const { task } = props;
  const parent =
    props.parent ??
    (task.parentId === null
      ? undefined
      : props.tasks.find((candidate) => candidate.id === task.parentId));
  const subtasks = props.tasks.filter((candidate) => candidate.parentId === task.id);
  const about = props.decisions.filter((decision) => decision.taskId === task.id);
  const runs = (props.runs ?? []).filter((run) => run.taskId === task.id);
  const comments = (props.comments ?? []).filter((comment) => comment.taskId === task.id);
  const goal =
    task.goalId === null
      ? undefined
      : props.goals?.find((candidate) => candidate.id === task.goalId);
  const day = (value: string) => formatDay(value, tag);

  if (props.form === "edit") {
    return (
      <div className="sc-task sc-task-editing">
        <h1 className="sc-task-title">
          <span className="sc-card-number">#{task.number}</span> {task.title}
        </h1>
        <TaskForm
          people={props.people}
          task={task}
          parent={parent}
          findTasks={props.findTasks}
          categories={props.categories}
          goal={goal}
          findGoals={props.findGoals}
          busy={props.busy}
          error={props.error}
          onSubmit={(input) => props.onChange(task, input)}
          onCancel={props.onCancel}
        />
      </div>
    );
  }

  return (
    <div className="sc-task">
      <header className="sc-task-header">
        <div className="sc-task-heading">
          {parent !== undefined && (
            <p className="sc-task-parent">
              {words.task.partOf}{" "}
              <a href={props.taskHref(parent)}>
                #{parent.number} {parent.title}
              </a>
            </p>
          )}
          <h1 className="sc-task-title">
            <span className="sc-card-number">#{task.number}</span> {task.title}
          </h1>
          <div className="sc-task-badges">
            <StateBadge state={task.state} />
            {task.archivedAt !== null && <Badge tone="neutral">{words.task.archived}</Badge>}
            {task.category !== null && <CategoryBadge category={task.category} />}
            <PriorityBadge priority={task.priority} />
            {task.dueOn !== null && (
              <DueBadge dueOn={task.dueOn} state={task.state} today={props.today} />
            )}
          </div>
        </div>
        {props.formHref !== undefined && (
          <div className="sc-task-actions">
            <a className="sc-button sc-button-secondary" href={props.formHref("edit")}>
              {words.common.edit}
            </a>
            <a className="sc-button sc-button-secondary" href={props.formHref("ask")}>
              {words.task.raiseDecision}
            </a>
            {props.onArchive !== undefined && task.archivedAt === null && (
              <Button
                variant="secondary"
                disabled={props.busy === true}
                onClick={() => props.onArchive?.(task)}
              >
                {words.task.archive}
              </Button>
            )}
            {props.onRestore !== undefined && task.archivedAt !== null && (
              <Button
                variant="secondary"
                disabled={props.busy === true}
                onClick={() => props.onRestore?.(task)}
              >
                {words.task.restore}
              </Button>
            )}
          </div>
        )}
      </header>
      <div className="sc-task-body">
        <div className="sc-task-main">
          {props.error !== undefined && (
            <p className="sc-form-error" role="alert">
              {props.error}
            </p>
          )}
          {task.body.length > 0 ? (
            <Markdown source={task.body} docHref={props.docHref} />
          ) : (
            <p className="sc-muted">{words.task.nothingMore}</p>
          )}
          {task.links.length > 0 && (
            <section className="sc-task-section" aria-label={words.task.links}>
              <h2 className="sc-section-title">{words.task.links}</h2>
              <ul className="sc-link-list">
                {task.links.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                      {link.label ?? link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {props.form === "ask" && (
            <section className="sc-task-section" aria-label={words.task.raiseDecision}>
              <h2 className="sc-section-title">{words.task.raiseDecision}</h2>
              <DecisionForm
                taskId={task.id}
                busy={props.busy}
                onSubmit={props.onRaiseDecision}
                onCancel={props.onCancel}
              />
            </section>
          )}
          {(runs.length > 0 ||
            about.length > 0 ||
            comments.length > 0 ||
            props.onComment !== undefined) && (
            <section className="sc-task-section" aria-label={words.comments.title}>
              <h2 className="sc-section-title">{words.comments.title}</h2>
              <TaskThread
                task={task}
                comments={comments}
                runs={runs}
                decisions={about}
                fileHref={props.fileHref}
                decisionHref={props.decisionHref}
                docHref={props.docHref}
                onAnswer={props.onAnswer}
                onUpdateDecision={props.onUpdateDecision}
                onAbandonRun={props.onAbandonRun}
                onComment={props.onComment}
                busy={props.busy}
                empty={<p className="sc-muted">{words.comments.empty}</p>}
              />
            </section>
          )}
          {props.history !== undefined && props.history.length > 0 && (
            <section className="sc-task-section" aria-label={words.task.history}>
              <h2 className="sc-section-title">{words.task.history}</h2>
              <EventFeed events={props.history} />
            </section>
          )}
          {subtasks.length > 0 && (
            <section className="sc-task-section" aria-label={words.task.subtasks}>
              <h2 className="sc-section-title">{words.task.partOfIt}</h2>
              <ul className="sc-subtasks">
                {subtasks.map((subtask) => (
                  <li key={subtask.id}>
                    <a href={props.taskHref(subtask)}>
                      <span className="sc-card-number">#{subtask.number}</span> {subtask.title}
                    </a>{" "}
                    <StateBadge state={subtask.state} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="sc-task-aside" aria-label={words.task.facts}>
          <dl className="sc-facts">
            <div>
              <dt>{words.task.state}</dt>
              <dd>
                <select
                  className="sc-input"
                  aria-label={words.task.state}
                  value={task.state}
                  disabled={props.busy === true}
                  onChange={(event) => props.onMove(task, event.target.value as TaskState)}
                >
                  {TASK_STATES.map((state) => (
                    <option key={state} value={state}>
                      {words.vocabulary.state[state]}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>{words.task.form.priority}</dt>
              <dd>{words.vocabulary.priority[task.priority]}</dd>
            </div>
            {task.category !== null && (
              <div>
                <dt>{words.task.category}</dt>
                <dd>
                  <CategoryBadge category={task.category} />
                </dd>
              </div>
            )}
            {task.goalId !== null && (
              <div>
                <dt>{words.task.goal}</dt>
                <dd>
                  {props.goalHref === undefined ? (
                    (goal?.title ?? task.goalId)
                  ) : (
                    <a href={props.goalHref(task.goalId)}>{goal?.title ?? task.goalId}</a>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>{words.task.owner}</dt>
              <dd>
                <PersonChip person={task.owner} />
              </dd>
            </div>
            <div>
              <dt>{words.task.workers}</dt>
              <dd>
                {task.workers.length === 0 ? (
                  <span className="sc-muted">{words.common.nobody}</span>
                ) : (
                  <ul className="sc-worker-list">
                    {task.workers.map((worker) => (
                      <li key={worker.id}>
                        <PersonChip person={worker} />
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {(task.startsOn !== null || task.dueOn !== null) && (
              <div>
                <dt>{words.task.plan}</dt>
                <dd>
                  {words.task.planned(
                    task.startsOn === null ? undefined : day(task.startsOn),
                    task.dueOn === null ? undefined : day(task.dueOn),
                  )}
                </dd>
              </div>
            )}
            {task.startedAt !== null && (
              <div>
                <dt>{words.task.started}</dt>
                <dd>
                  <Time iso={task.startedAt} />
                </dd>
              </div>
            )}
            {task.doneAt !== null && (
              <div>
                <dt>{words.task.done}</dt>
                <dd>
                  <Time iso={task.doneAt} />
                </dd>
              </div>
            )}
            {task.archivedAt !== null && (
              <div>
                <dt>{words.task.archivedAt}</dt>
                <dd>
                  <Time iso={task.archivedAt} />
                </dd>
              </div>
            )}
            <div>
              <dt>{words.task.written}</dt>
              <dd>
                <Time iso={task.createdAt} />
              </dd>
            </div>
            <div>
              <dt>{words.task.changed}</dt>
              <dd>
                <Time iso={task.updatedAt} />
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
