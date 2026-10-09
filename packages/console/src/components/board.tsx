import type { ReactNode } from "react";
import { type RestTask, TASK_STATES, type TaskState } from "../api.js";
import { Avatar, Badge, cx, PriorityBadge, STATE_LABELS } from "./ui.js";

// The board: one column per state, the tasks in it, newest first. It takes its data as props
// and nothing from the network; what it is told on a click goes back up.

export interface BoardProps {
  readonly tasks: readonly RestTask[];
  /** The link to a task's own page, as the composition routes it. */
  readonly taskHref: (task: RestTask) => string;
  readonly onOpen: (task: RestTask) => void;
  /** Called when a person moves a task to another column. Left out, the board is read-only. */
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
  /** What a column shows when it has nothing; the way to write the first task, for example. */
  readonly empty?: ReactNode;
}

export function TaskCard(props: {
  readonly task: RestTask;
  readonly href: string;
  readonly onOpen: (task: RestTask) => void;
  readonly onMove?: ((task: RestTask, state: TaskState) => void) | undefined;
}) {
  const { task } = props;
  return (
    <article className="sc-card" aria-label={`#${task.number} ${task.title}`}>
      <a
        className="sc-card-title"
        href={props.href}
        onClick={(event) => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            props.onOpen(task);
          }
        }}
      >
        <span className="sc-card-number">#{task.number}</span> {task.title}
      </a>
      <div className="sc-card-meta">
        <PriorityBadge priority={task.priority} />
        {task.openDecisions > 0 && (
          <Badge tone="warning" title="Decisions waiting for a person">
            {task.openDecisions === 1 ? "1 decision" : `${task.openDecisions} decisions`}
          </Badge>
        )}
        {task.links.length > 0 && (
          <Badge tone="neutral">
            {task.links.length === 1 ? "1 link" : `${task.links.length} links`}
          </Badge>
        )}
        <span className="sc-card-spacer" />
        {task.assignee !== null && <Avatar person={task.assignee} size="sm" />}
      </div>
      {props.onMove !== undefined && (
        <label className="sc-card-move">
          <span className="sc-visually-hidden">Move to</span>
          <select
            value={task.state}
            onChange={(event) => props.onMove?.(task, event.target.value as TaskState)}
          >
            {TASK_STATES.map((state) => (
              <option key={state} value={state}>
                {STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

export function Board(props: BoardProps) {
  return (
    <div className="sc-board">
      {TASK_STATES.map((state) => {
        const tasks = props.tasks.filter((task) => task.state === state);
        return (
          <section
            key={state}
            className={cx("sc-column", `sc-column-${state}`)}
            aria-label={STATE_LABELS[state]}
          >
            <header className="sc-column-header">
              <h2 className="sc-column-title">{STATE_LABELS[state]}</h2>
              <span className="sc-column-count">{tasks.length}</span>
            </header>
            <div className="sc-column-body">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  href={props.taskHref(task)}
                  onOpen={props.onOpen}
                  onMove={props.onMove}
                />
              ))}
              {tasks.length === 0 && state === "idea" && props.empty}
            </div>
          </section>
        );
      })}
    </div>
  );
}
