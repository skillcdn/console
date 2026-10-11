import type { RestTask, RestWork } from "../api.js";
import { addDays, today as todayOf } from "../dates.js";
import { useWords } from "../i18n/index.js";
import { TaskList } from "./task-list.js";
import { PersonChip, Time } from "./ui.js";

// What is on a person's plate (ADR-0019), across the projects they may see: the open tasks
// assigned to them, by when they are due, and the decisions that wait for a person. Takes its
// data as props and nothing from the network.

export interface WorkListProps {
  readonly work: RestWork;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  readonly taskHref: (projectKey: string, task: RestTask) => string;
  readonly decisionHref: (projectKey: string, decisionId: string) => string;
}

export function WorkList(props: WorkListProps) {
  const words = useWords();
  const work = words.work;
  const now = props.today ?? todayOf();
  const weekEnd = addDays(now, 6);
  const { tasks, decisions } = props.work;
  const projectOf = new Map(tasks.map((item) => [item.task.id, item.project]));
  const hrefOf = (task: RestTask) => props.taskHref(projectOf.get(task.id)?.key ?? "", task);
  const nameOf = (task: RestTask) => projectOf.get(task.id)?.name;
  const groups: { readonly title: string; readonly tasks: RestTask[] }[] = [
    { title: work.overdue, tasks: [] },
    { title: work.thisWeek, tasks: [] },
    { title: work.later, tasks: [] },
    { title: work.noDay, tasks: [] },
  ];
  for (const { task } of tasks) {
    const index = task.dueOn === null ? 3 : task.dueOn < now ? 0 : task.dueOn <= weekEnd ? 1 : 2;
    groups[index]?.tasks.push(task);
  }
  return (
    <div className="sc-work">
      {groups
        .filter((group) => group.tasks.length > 0)
        .map((group) => (
          <section key={group.title} className="sc-task-section" aria-label={group.title}>
            <h2 className="sc-section-title">
              {group.title} <span className="sc-column-count">{group.tasks.length}</span>
            </h2>
            <TaskList
              tasks={group.tasks}
              taskHref={hrefOf}
              projectOf={nameOf}
              showState
              today={now}
            />
          </section>
        ))}
      <section className="sc-task-section" aria-label={work.decisions}>
        <h2 className="sc-section-title">
          {work.decisions} <span className="sc-column-count">{decisions.length}</span>
        </h2>
        {decisions.length === 0 ? (
          <p className="sc-muted">{work.noDecisions}</p>
        ) : (
          <ol className="sc-decision-log">
            {decisions.map(({ project, decision }) => (
              <li key={decision.id} className="sc-decision-row">
                <a
                  className="sc-decision-row-question"
                  href={props.decisionHref(project.key, decision.id)}
                >
                  {decision.question}
                </a>
                <span className="sc-task-row-project">{work.inProject(project.name)}</span>
                <span className="sc-decision-row-meta">
                  <PersonChip person={decision.raisedBy} /> <Time iso={decision.createdAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
