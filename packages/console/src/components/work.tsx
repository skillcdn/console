import type { RestTask, RestWork, WeekStart } from "../api.js";
import { addDays, today as todayOf } from "../dates.js";
import { useWords } from "../i18n/index.js";
import { Week } from "./calendar.js";
import { ProjectMark } from "./projects.js";
import { TaskList } from "./task-list.js";
import { PersonChip, Time } from "./ui.js";

// What is on a person's plate (ADR-0019), across the projects they may see: the week at the
// top, with the open tasks assigned to them on its days, and what of theirs was done or
// dropped on them, as a project's calendar shows it; below, the open tasks by when they are
// due, and the decisions that wait for a person. Takes its data as props and nothing from the
// network; the week shown is the address's (ADR-0010).

export interface WorkListProps {
  /** The tasks on the plate; and the decisions waiting on the person's own plate, left out on another's. */
  readonly work: {
    readonly tasks: RestWork["tasks"];
    /** The person's tasks done or dropped and not yet put away: on the week, not in the lists. */
    readonly closed?: RestWork["closed"] | undefined;
    readonly decisions?: RestWork["decisions"] | undefined;
  };
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  /** A day of the week shown at the top; today's week when left out. */
  readonly week?: string | undefined;
  readonly taskHref: (projectKey: string, task: RestTask) => string;
  readonly decisionHref: (projectKey: string, decisionId: string) => string;
  /** Where the page is with the week of a day at the top. */
  readonly weekHref: (day: string) => string;
  /** The day the week begins on, as the workspace says (ADR-0035); the language's when left out. */
  readonly weekStart?: WeekStart | undefined;
}

export function WorkList(props: WorkListProps) {
  const words = useWords();
  const work = words.work;
  const now = props.today ?? todayOf();
  const weekEnd = addDays(now, 6);
  const { tasks, decisions } = props.work;
  const closed = props.work.closed ?? [];
  const projectOf = new Map([...tasks, ...closed].map((item) => [item.task.id, item.project]));
  const hrefOf = (task: RestTask) => props.taskHref(projectOf.get(task.id)?.key ?? "", task);
  const markOf = (task: RestTask) => {
    const project = projectOf.get(task.id);
    return project === undefined ? undefined : <ProjectMark project={project} size="sm" />;
  };
  const nameOf = (task: RestTask) => {
    const project = projectOf.get(task.id);
    return project === undefined ? undefined : (
      <>
        <ProjectMark project={project} size="sm" /> {project.name}
      </>
    );
  };
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
      <Week
        tasks={[...tasks, ...closed].map((item) => item.task)}
        day={props.week}
        today={now}
        taskHref={hrefOf}
        weekHref={props.weekHref}
        markOf={markOf}
        weekStart={props.weekStart}
      />
      <div className="sc-work-lists">
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
        {decisions !== undefined && (
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
                    <span className="sc-task-row-project">
                      <ProjectMark project={project} size="sm" /> {work.inProject(project.name)}
                    </span>
                    <span className="sc-decision-row-meta">
                      <PersonChip person={decision.raisedBy} /> <Time iso={decision.createdAt} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
