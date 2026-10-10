import type {
  RestAnswerInput,
  RestArtifact,
  RestDecision,
  RestDecisionInput,
  RestDecisionPatch,
  RestEvent,
  RestPerson,
  RestRun,
  RestTask,
  RestTaskInput,
  TaskState,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import type { TaskFormKind } from "../router.js";
import { TASK_STATES } from "../vocabulary.js";
import { DecisionForm } from "./decision-form.js";
import { DecisionCard } from "./decision-list.js";
import { EventFeed } from "./event-feed.js";
import { Markdown } from "./markdown.js";
import { RunList } from "./runs.js";
import { TaskForm } from "./task-form.js";
import { PersonChip, PriorityBadge, StateBadge, Time } from "./ui.js";

// One task: what it is, who it is on, what it links to, the agents at work on it, the decisions
// about it, the tasks that are part of it, everything that happened to it, and the ways to
// change it. Takes its data as props and nothing from the network; which of its forms is open
// is told by the page, since each form has an address of its own (ADR-0010).

export interface TaskViewProps {
  readonly task: RestTask;
  readonly people: readonly RestPerson[];
  /** Every task of the board, for the breakdown and for what this one may be part of. */
  readonly tasks: readonly RestTask[];
  readonly decisions: readonly RestDecision[];
  /** The runs of the board, or of this task; the ones on this task are shown. */
  readonly runs?: readonly RestRun[] | undefined;
  /** Everything that happened to the task, oldest first, when the page has read it. */
  readonly history?: readonly RestEvent[] | undefined;
  readonly taskHref: (task: RestTask) => string;
  /** Where a decision is answered, for a run that waits for one. */
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  /** Where a file a run handed in is read. */
  readonly fileHref?: ((artifact: RestArtifact) => string) | undefined;
  /** Where a document of the project is read, by its path, for the links in what was written. */
  readonly docHref?: ((path: string) => string) | undefined;
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
}

export function TaskView(props: TaskViewProps) {
  const words = useWords();
  const { task } = props;
  const parent =
    task.parentId === null
      ? undefined
      : props.tasks.find((candidate) => candidate.id === task.parentId);
  const subtasks = props.tasks.filter((candidate) => candidate.parentId === task.id);
  const about = props.decisions.filter((decision) => decision.taskId === task.id);
  const runs = (props.runs ?? []).filter((run) => run.taskId === task.id);
  const tasksById = new Map(props.tasks.map((candidate) => [candidate.id, candidate]));

  if (props.form === "edit") {
    return (
      <div className="sc-task">
        <h1 className="sc-task-title">
          <span className="sc-card-number">#{task.number}</span> {task.title}
        </h1>
        <TaskForm
          people={props.people}
          task={task}
          parents={props.tasks}
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
          <PriorityBadge priority={task.priority} />
        </div>
      </header>
      <dl className="sc-facts">
        <div>
          <dt>{words.task.owner}</dt>
          <dd>
            <PersonChip person={task.owner} />
          </dd>
        </div>
        <div>
          <dt>{words.task.assignee}</dt>
          <dd>
            {task.assignee === null ? (
              <span className="sc-muted">{words.common.nobody}</span>
            ) : (
              <PersonChip person={task.assignee} />
            )}
          </dd>
        </div>
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
      <div className="sc-task-actions">
        <label className="sc-field sc-field-inline">
          <span className="sc-field-label">{words.task.state}</span>
          <select
            className="sc-input"
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
        </label>
        {props.formHref !== undefined && (
          <>
            <a className="sc-button sc-button-secondary" href={props.formHref("edit")}>
              {words.common.edit}
            </a>
            <a className="sc-button sc-button-secondary" href={props.formHref("ask")}>
              {words.task.raiseDecision}
            </a>
          </>
        )}
      </div>
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
            tasks={props.tasks}
            taskId={task.id}
            busy={props.busy}
            onSubmit={props.onRaiseDecision}
            onCancel={props.onCancel}
          />
        </section>
      )}
      {runs.length > 0 && (
        <section className="sc-task-section" aria-label={words.task.runs}>
          <h2 className="sc-section-title">{words.task.agentsAtWork}</h2>
          <RunList
            runs={runs}
            decisionHref={props.decisionHref}
            fileHref={props.fileHref}
            docHref={props.docHref}
            onAbandon={props.onAbandonRun}
            busy={props.busy}
          />
        </section>
      )}
      {about.length > 0 && (
        <section className="sc-task-section" aria-label={words.task.decisions}>
          <h2 className="sc-section-title">{words.task.decisions}</h2>
          {about.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              task={decision.taskId === null ? undefined : tasksById.get(decision.taskId)}
              docHref={props.docHref}
              onAnswer={props.onAnswer}
              onUpdate={props.onUpdateDecision}
              busy={props.busy}
            />
          ))}
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
  );
}
