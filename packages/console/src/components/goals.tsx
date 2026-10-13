import { type FormEvent, type ReactNode, useState } from "react";
import {
  GOAL_STATES,
  type GoalState,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  type RestCategory,
  type RestGoal,
  type RestGoalInput,
  type RestTask,
  TASK_STATES,
} from "../api.js";
import { formatDays } from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { Markdown } from "./markdown.js";
import { TaskList } from "./task-list.js";
import {
  Button,
  CategoryBadge,
  Day,
  DueBadge,
  GoalStateBadge,
  PersonChip,
  ProgressBar,
  Time,
} from "./ui.js";

// The roadmap of a project (ADR-0019): its goals, each planned in days as a task is, a start
// and a target, sorted into a category of the workspace (ADR-0026), with how far its tasks
// are, read from the board as it stands. The list, one goal with its tasks, and the form an
// owner sets one with. Each takes its data as props and nothing from the network; what people
// wrote is shown as text, never as HTML.

/** A goal's day on the calendar's terms: reached or let go, it is a plain fact; else it may be late. */
const dueState = (goal: RestGoal) =>
  goal.state === "done" ? "done" : goal.state === "dropped" ? "dropped" : "ready";

export interface GoalListProps {
  readonly goals: readonly RestGoal[];
  readonly goalHref: (goal: RestGoal) => string;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
  readonly empty?: ReactNode;
}

export function GoalList(props: GoalListProps) {
  const words = useWords().roadmap;
  const { tag } = useLanguage();
  if (props.goals.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <ul className="sc-goals" aria-label={words.title}>
      {props.goals.map((goal) => (
        <li key={goal.id} className={`sc-goal sc-goal-${goal.state}`}>
          <div className="sc-goal-head">
            <a className="sc-goal-title" href={props.goalHref(goal)}>
              {goal.title}
            </a>
            {goal.category !== null && <CategoryBadge category={goal.category} />}
            <GoalStateBadge state={goal.state} />
            {goal.startsOn !== null && goal.dueOn !== null && goal.startsOn < goal.dueOn && (
              <span className="sc-goal-days">{formatDays(goal.startsOn, goal.dueOn, tag)}</span>
            )}
            {goal.dueOn !== null && (
              <DueBadge dueOn={goal.dueOn} state={dueState(goal)} today={props.today} />
            )}
          </div>
          <ProgressBar counts={goal.taskCounts} />
        </li>
      ))}
    </ul>
  );
}

export interface GoalFormProps {
  /** The goal to change; left out, the form sets a new one. */
  readonly goal?: RestGoal | undefined;
  /** The workspace's categories to sort the goal into; left out, the form offers none. */
  readonly categories?: readonly RestCategory[] | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestGoalInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

export function GoalForm(props: GoalFormProps) {
  const words = useWords();
  const form = words.roadmap.form;
  const { goal } = props;
  const [title, setTitle] = useState(goal?.title ?? "");
  const [body, setBody] = useState(goal?.body ?? "");
  const [state, setState] = useState<GoalState>(goal?.state ?? "planned");
  const [category, setCategory] = useState(goal?.category?.key ?? "");
  const [startsOn, setStartsOn] = useState(goal?.startsOn ?? "");
  const [dueOn, setDueOn] = useState(goal?.dueOn ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      title: title.trim(),
      body,
      state,
      category: category === "" ? null : category,
      startsOn: startsOn === "" ? null : startsOn,
      dueOn: dueOn === "" ? null : dueOn,
    });
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">{form.title}</span>
        <input
          className="sc-input"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="sc-field">
        <span className="sc-field-label">{form.body}</span>
        <textarea
          className="sc-input sc-textarea"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          rows={4}
          placeholder={form.bodyPlaceholder}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.state}</span>
          <select
            className="sc-input"
            value={state}
            onChange={(event) => setState(event.target.value as GoalState)}
          >
            {GOAL_STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.goalState[candidate]}
              </option>
            ))}
          </select>
        </label>
        {props.categories !== undefined && (
          <label className="sc-field">
            <span className="sc-field-label">{form.category}</span>
            <select
              className="sc-input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{form.noCategory}</option>
              {props.categories.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.startsOn}</span>
          <input
            className="sc-input"
            type="date"
            value={startsOn}
            max={dueOn === "" ? undefined : dueOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.dueOn}</span>
          <input
            className="sc-input"
            type="date"
            value={dueOn}
            min={startsOn === "" ? undefined : startsOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
      </div>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy === true || title.trim() === ""}
        >
          {goal === undefined ? form.set : words.common.save}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            {words.common.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

export interface GoalViewProps {
  readonly goal: RestGoal;
  /** The tasks of the board; those that work towards the goal are shown, by state. */
  readonly tasks: readonly RestTask[];
  readonly taskHref: (task: RestTask) => string;
  /** Where a document of the project is read, by its path, for the links in what was written. */
  readonly docHref?: ((path: string) => string) | undefined;
  readonly today?: string | undefined;
  /** Where the goal is changed; left out, it cannot be changed from here. */
  readonly editHref?: string | undefined;
  /** Called when an owner moves the goal to another state from here. */
  readonly onMove?: ((goal: RestGoal, state: GoalState) => void) | undefined;
  readonly busy?: boolean | undefined;
}

export function GoalView(props: GoalViewProps) {
  const words = useWords();
  const roadmap = words.roadmap;
  const { goal } = props;
  const towards = props.tasks.filter((task) => task.goalId === goal.id);
  return (
    <div className="sc-task sc-goal-view">
      <header className="sc-task-header">
        <h1 className="sc-task-title">{goal.title}</h1>
        <div className="sc-task-badges">
          {goal.category !== null && <CategoryBadge category={goal.category} />}
          <GoalStateBadge state={goal.state} />
          {goal.dueOn !== null && (
            <DueBadge dueOn={goal.dueOn} state={dueState(goal)} today={props.today} />
          )}
        </div>
      </header>
      <div className="sc-task-body">
        <div className="sc-task-main">
          <ProgressBar counts={goal.taskCounts} />
          {goal.body.length > 0 ? (
            <Markdown source={goal.body} docHref={props.docHref} />
          ) : (
            <p className="sc-muted">{roadmap.nothingMore}</p>
          )}
          <section className="sc-task-section" aria-label={roadmap.tasks}>
            <h2 className="sc-section-title">{roadmap.tasks}</h2>
            {towards.length === 0 ? (
              <p className="sc-muted">{roadmap.noTasks}</p>
            ) : (
              TASK_STATES.map((state) => {
                const inState = towards.filter((task) => task.state === state);
                return inState.length === 0 ? null : (
                  <div key={state} className="sc-goal-tasks">
                    <h3 className="sc-goal-tasks-state">
                      {words.vocabulary.state[state]}{" "}
                      <span className="sc-column-count">{inState.length}</span>
                    </h3>
                    <TaskList tasks={inState} taskHref={props.taskHref} today={props.today} />
                  </div>
                );
              })
            )}
          </section>
        </div>
        <aside className="sc-task-aside" aria-label={words.task.facts}>
          <dl className="sc-facts">
            <div>
              <dt>{roadmap.state}</dt>
              <dd>
                {props.onMove === undefined ? (
                  words.vocabulary.goalState[goal.state]
                ) : (
                  <select
                    className="sc-input"
                    aria-label={roadmap.state}
                    value={goal.state}
                    disabled={props.busy === true}
                    onChange={(event) => props.onMove?.(goal, event.target.value as GoalState)}
                  >
                    {GOAL_STATES.map((state) => (
                      <option key={state} value={state}>
                        {words.vocabulary.goalState[state]}
                      </option>
                    ))}
                  </select>
                )}
              </dd>
            </div>
            <div>
              <dt>{roadmap.category}</dt>
              <dd>
                {goal.category === null ? (
                  <span className="sc-muted">{roadmap.noCategory}</span>
                ) : (
                  <CategoryBadge category={goal.category} />
                )}
              </dd>
            </div>
            <div>
              <dt>{roadmap.starts}</dt>
              <dd>
                {goal.startsOn === null ? (
                  <span className="sc-muted">{roadmap.noStart}</span>
                ) : (
                  <Day day={goal.startsOn} />
                )}
              </dd>
            </div>
            <div>
              <dt>{roadmap.target}</dt>
              <dd>
                {goal.dueOn === null ? (
                  <span className="sc-muted">{roadmap.noTarget}</span>
                ) : (
                  <Day day={goal.dueOn} />
                )}
              </dd>
            </div>
            <div>
              <dt>{roadmap.setBy}</dt>
              <dd>
                <PersonChip person={goal.createdBy} /> <Time iso={goal.createdAt} />
              </dd>
            </div>
          </dl>
          {props.editHref !== undefined && (
            <div className="sc-task-actions">
              <a className="sc-button sc-button-secondary" href={props.editHref}>
                {words.common.edit}
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
