import type { ReactNode } from "react";
import type { RestTask } from "../api.js";
import { useWords } from "../i18n/index.js";
import { ShowMore, usePaged } from "./paged.js";
import { Avatar, Badge, CategoryBadge, DueBadge, StateBadge } from "./ui.js";

// A list of tasks as rows, where the board's columns are not the point: the calendar's late
// and unscheduled tasks, a goal's tasks, a person's own work. Each row says what a card says,
// in one line; a long list shows a page at a time. Takes its data as props and nothing from
// the network.

export interface TaskListProps {
  readonly tasks: readonly RestTask[];
  readonly taskHref: (task: RestTask) => string;
  /** Whether each row says the task's state: where the rows are not grouped by it. */
  readonly showState?: boolean | undefined;
  /** What the row says the task belongs to, where tasks of several projects are listed together. */
  readonly projectOf?: ((task: RestTask) => ReactNode) | undefined;
  /** The day to count due days from; the browser's today when left out. */
  readonly today?: string | undefined;
  readonly label?: string | undefined;
  readonly empty?: ReactNode;
}

export function TaskList(props: TaskListProps) {
  const words = useWords();
  const { shown, rest, more } = usePaged(props.tasks);
  if (props.tasks.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <>
      <ul className="sc-task-rows" aria-label={props.label}>
        {shown.map((task) => {
          const project = props.projectOf?.(task);
          return (
            <li key={task.id} className="sc-task-row">
              <a className="sc-task-row-title" href={props.taskHref(task)}>
                <span className="sc-card-number">#{task.number}</span> {task.title}
              </a>
              {project !== undefined && project !== null && (
                <span className="sc-task-row-project">{project}</span>
              )}
              <span className="sc-task-row-meta">
                {task.category !== null && <CategoryBadge category={task.category} />}
                {props.showState === true && <StateBadge state={task.state} />}
                {task.openDecisions > 0 && (
                  <Badge tone="warning" title={words.board.decisionsTitle}>
                    {words.board.decisions(task.openDecisions)}
                  </Badge>
                )}
                {task.dueOn !== null && (
                  <DueBadge dueOn={task.dueOn} state={task.state} today={props.today} />
                )}
                {task.assignee !== null && <Avatar person={task.assignee} size="sm" />}
              </span>
            </li>
          );
        })}
      </ul>
      <ShowMore rest={rest} onMore={more} />
    </>
  );
}
