import { useState } from "react";
import type {
  RestAnswerInput,
  RestArtifact,
  RestDecision,
  RestDecisionInput,
  RestEvent,
  RestPerson,
  RestRun,
  RestTask,
  RestTaskInput,
  TaskState,
} from "../api.js";
import { TASK_STATES } from "../vocabulary.js";
import { DecisionForm } from "./decision-form.js";
import { DecisionCard } from "./decision-list.js";
import { EventFeed } from "./event-feed.js";
import { Markdown } from "./markdown.js";
import { RunList } from "./runs.js";
import { TaskForm } from "./task-form.js";
import { Button, PersonChip, PriorityBadge, STATE_LABELS, StateBadge, Time } from "./ui.js";

// One task: what it is, who it is on, what it links to, the agents at work on it, the decisions
// about it, the tasks that are part of it, everything that happened to it, and the ways to
// change it. Takes its data as props and nothing from the network.

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
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onChange: (task: RestTask, patch: RestTaskInput) => void;
  readonly onMove: (task: RestTask, state: TaskState) => void;
  readonly onRaiseDecision: (input: RestDecisionInput) => void;
  readonly onAnswer: (decision: RestDecision, input: RestAnswerInput) => void;
  readonly onAbandonRun?: ((run: RestRun) => void) | undefined;
}

export function TaskView(props: TaskViewProps) {
  const { task } = props;
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const parent =
    task.parentId === null
      ? undefined
      : props.tasks.find((candidate) => candidate.id === task.parentId);
  const subtasks = props.tasks.filter((candidate) => candidate.parentId === task.id);
  const about = props.decisions.filter((decision) => decision.taskId === task.id);
  const runs = (props.runs ?? []).filter((run) => run.taskId === task.id);
  const tasksById = new Map(props.tasks.map((candidate) => [candidate.id, candidate]));

  if (editing) {
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
          onSubmit={(input) => {
            props.onChange(task, input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="sc-task">
      <header className="sc-task-header">
        {parent !== undefined && (
          <p className="sc-task-parent">
            Part of{" "}
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
          <dt>Owner</dt>
          <dd>
            <PersonChip person={task.owner} />
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>
            {task.assignee === null ? (
              <span className="sc-muted">Nobody</span>
            ) : (
              <PersonChip person={task.assignee} />
            )}
          </dd>
        </div>
        <div>
          <dt>Written</dt>
          <dd>
            <Time iso={task.createdAt} />
          </dd>
        </div>
        <div>
          <dt>Changed</dt>
          <dd>
            <Time iso={task.updatedAt} />
          </dd>
        </div>
      </dl>
      <div className="sc-task-actions">
        <label className="sc-field sc-field-inline">
          <span className="sc-field-label">State</span>
          <select
            className="sc-input"
            value={task.state}
            disabled={props.busy === true}
            onChange={(event) => props.onMove(task, event.target.value as TaskState)}
          >
            {TASK_STATES.map((state) => (
              <option key={state} value={state}>
                {STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => setEditing(true)}>Edit</Button>
        <Button onClick={() => setAsking(true)} disabled={asking}>
          Raise a decision
        </Button>
      </div>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      {task.body.length > 0 ? (
        <Markdown source={task.body} />
      ) : (
        <p className="sc-muted">Nothing more was written about it.</p>
      )}
      {task.links.length > 0 && (
        <section className="sc-task-section" aria-label="Links">
          <h2 className="sc-section-title">Links</h2>
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
      {asking && (
        <section className="sc-task-section" aria-label="Raise a decision">
          <h2 className="sc-section-title">Raise a decision</h2>
          <DecisionForm
            tasks={props.tasks}
            taskId={task.id}
            busy={props.busy}
            onSubmit={(input) => {
              props.onRaiseDecision(input);
              setAsking(false);
            }}
            onCancel={() => setAsking(false)}
          />
        </section>
      )}
      {runs.length > 0 && (
        <section className="sc-task-section" aria-label="Runs">
          <h2 className="sc-section-title">Agents at work</h2>
          <RunList
            runs={runs}
            decisionHref={props.decisionHref}
            fileHref={props.fileHref}
            onAbandon={props.onAbandonRun}
            busy={props.busy}
          />
        </section>
      )}
      {about.length > 0 && (
        <section className="sc-task-section" aria-label="Decisions">
          <h2 className="sc-section-title">Decisions</h2>
          {about.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              task={decision.taskId === null ? undefined : tasksById.get(decision.taskId)}
              onAnswer={props.onAnswer}
              busy={props.busy}
            />
          ))}
        </section>
      )}
      {props.history !== undefined && props.history.length > 0 && (
        <section className="sc-task-section" aria-label="History">
          <h2 className="sc-section-title">What happened</h2>
          <EventFeed events={props.history} />
        </section>
      )}
      {subtasks.length > 0 && (
        <section className="sc-task-section" aria-label="Subtasks">
          <h2 className="sc-section-title">Part of it</h2>
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
