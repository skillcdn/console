import { type FormEvent, type ReactNode, useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINKS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MAX_WORKERS,
  type RestCategory,
  type RestGoal,
  type RestPerson,
  type RestTask,
  type RestTaskInput,
  TASK_PRIORITIES,
  TASK_STATES,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Picker, type PickerSearch } from "./picker.js";
import { Button, GoalStateBadge, PersonChip, personName, StateBadge } from "./ui.js";

// Writing a task, or changing one. The bounds are the package's, said before a request is made.
// The plan is two days (ADR-0019); what happened to the task is the board's to keep, not a
// field here. The workers are any number of the people (ADR-0037); the task this one is part of
// and the goal it works towards are found by searching, a page at a time, never offered whole.

/** What words find among the tasks of the project, a page at a time. */
export type TaskSearch = PickerSearch<RestTask>;
/** What words find among the open goals of the project, a page at a time. */
export type GoalSearch = PickerSearch<RestGoal>;

export interface TaskFormProps {
  readonly people: readonly RestPerson[];
  /** The task to change; left out, the form writes a new one. */
  readonly task?: RestTask | undefined;
  /** The task this one is part of, as it stands, for the form to show it; the search finds another. */
  readonly parent?: RestTask | undefined;
  /** Left out, a task cannot be made part of one here. */
  readonly findTasks?: TaskSearch | undefined;
  /** The categories of the workspace, to sort the task into one. */
  readonly categories?: readonly RestCategory[] | undefined;
  /** The goal the task works towards, as it stands, for the form to show it; the search finds another. */
  readonly goal?: RestGoal | undefined;
  /** Left out, no goal is offered. */
  readonly findGoals?: GoalSearch | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestTaskInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

interface LinkDraft {
  readonly url: string;
  readonly label: string;
}

/** A task as a picker names one: its number and its title, with its state. */
export function taskLabel(task: RestTask): ReactNode {
  return (
    <>
      <span className="sc-card-number">#{task.number}</span> {task.title}{" "}
      <StateBadge state={task.state} />
    </>
  );
}

/** A goal as a picker names one: its title, with its state. */
export function goalLabel(goal: RestGoal): ReactNode {
  return (
    <>
      {goal.title} <GoalStateBadge state={goal.state} />
    </>
  );
}

export function TaskForm(props: TaskFormProps) {
  const words = useWords();
  const form = words.task.form;
  const { task } = props;
  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [state, setState] = useState(task?.state ?? "idea");
  const [priority, setPriority] = useState(task?.priority ?? "normal");
  const [workerIds, setWorkerIds] = useState<readonly string[]>(
    task?.workers.map((worker) => worker.id) ?? [],
  );
  // What is chosen is kept by id, so that a parent or a goal the page has not read back yet is
  // kept as it is rather than dropped; the one chosen here is kept whole, to be shown.
  const [parentId, setParentId] = useState<string | null>(task?.parentId ?? null);
  const [parentChosen, setParentChosen] = useState<RestTask | undefined>(undefined);
  const [goalId, setGoalId] = useState<string | null>(task?.goalId ?? null);
  const [goalChosen, setGoalChosen] = useState<RestGoal | undefined>(undefined);
  const [category, setCategory] = useState(task?.category?.key ?? "");
  const [startsOn, setStartsOn] = useState(task?.startsOn ?? "");
  const [dueOn, setDueOn] = useState(task?.dueOn ?? "");
  const [links, setLinks] = useState<readonly LinkDraft[]>(
    task?.links.map((link) => ({ url: link.url, label: link.label ?? "" })) ?? [],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      title: title.trim(),
      body,
      state,
      priority,
      workerIds: [...workerIds],
      parentId,
      category: category === "" ? null : category,
      goalId,
      startsOn: startsOn === "" ? null : startsOn,
      dueOn: dueOn === "" ? null : dueOn,
      links: links
        .filter((link) => link.url.trim().length > 0)
        .map((link) => ({
          url: link.url.trim(),
          label: link.label.trim() === "" ? null : link.label.trim(),
        })),
    });
  };

  // A worker is one of the people, or one the task had who is no longer among them.
  const personOf = (id: string): RestPerson | undefined =>
    props.people.find((person) => person.id === id) ??
    task?.workers.find((worker) => worker.id === id);
  const chosenWorkers = workerIds.flatMap((id) => {
    const person = personOf(id);
    return person === undefined ? [] : [person];
  });
  const otherPeople = props.people.filter((person) => !workerIds.includes(person.id));
  const parent =
    parentId === null
      ? undefined
      : parentChosen?.id === parentId
        ? parentChosen
        : props.parent?.id === parentId
          ? props.parent
          : undefined;
  const goal =
    goalId === null
      ? undefined
      : goalChosen?.id === goalId
        ? goalChosen
        : props.goal?.id === goalId
          ? props.goal
          : undefined;
  const held = <span className="sc-muted">&hellip;</span>;
  const categories = props.categories ?? [];
  const datesInOrder = startsOn === "" || dueOn === "" || startsOn <= dueOn;

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">{form.title}</span>
        <input
          className="sc-input"
          value={title}
          placeholder={form.titlePlaceholder}
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
          rows={6}
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
            onChange={(event) => setState(event.target.value as typeof state)}
          >
            {TASK_STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.state[candidate]}
              </option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{form.priority}</span>
          <select
            className="sc-input"
            value={priority}
            onChange={(event) => setPriority(event.target.value as typeof priority)}
          >
            {TASK_PRIORITIES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {words.vocabulary.priority[candidate]}
              </option>
            ))}
          </select>
        </label>
        {categories.length > 0 && (
          <label className="sc-field">
            <span className="sc-field-label">{form.category}</span>
            <select
              className="sc-input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{form.noCategory}</option>
              {categories.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="sc-field sc-workers-field">
        <legend className="sc-field-label">{form.workers}</legend>
        <div className="sc-chips">
          {chosenWorkers.map((person) => (
            <span key={person.id} className="sc-chip">
              <PersonChip person={person} />
              <button
                type="button"
                className="sc-chip-remove"
                aria-label={`${words.common.remove}: ${personName(person)}`}
                onClick={() => setWorkerIds(workerIds.filter((id) => id !== person.id))}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </span>
          ))}
          {chosenWorkers.length === 0 && <span className="sc-muted">{words.common.nobody}</span>}
          {otherPeople.length > 0 && workerIds.length < MAX_WORKERS && (
            <select
              className="sc-input sc-chip-add"
              aria-label={form.addWorker}
              value=""
              onChange={(event) => {
                if (event.target.value !== "") {
                  setWorkerIds([...workerIds, event.target.value]);
                }
              }}
            >
              <option value="">{form.addWorker}</option>
              {otherPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {personName(person)}
                </option>
              ))}
            </select>
          )}
        </div>
      </fieldset>
      <div className="sc-field-row">
        <label className="sc-field">
          <span className="sc-field-label">{form.startsOn}</span>
          <input
            className="sc-input"
            type="date"
            value={startsOn}
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
        {props.findGoals !== undefined && (
          <div className="sc-field">
            <span className="sc-field-label">{form.goal}</span>
            <Picker
              value={goal}
              held={goalId === null ? undefined : held}
              search={props.findGoals}
              keyOf={(candidate) => candidate.id}
              render={goalLabel}
              label={form.goal}
              placeholder={form.searchGoals}
              disabled={props.busy}
              onChange={(chosen) => {
                setGoalChosen(chosen);
                setGoalId(chosen?.id ?? null);
              }}
            />
          </div>
        )}
        {props.findTasks !== undefined && (
          <div className="sc-field">
            <span className="sc-field-label">{form.partOf}</span>
            <Picker
              value={parent}
              held={parentId === null ? undefined : held}
              search={props.findTasks}
              keyOf={(candidate) => candidate.id}
              render={taskLabel}
              label={form.partOf}
              placeholder={form.searchTasks}
              disabled={props.busy}
              exclude={(candidate) => candidate.id === task?.id}
              onChange={(chosen) => {
                setParentChosen(chosen);
                setParentId(chosen?.id ?? null);
              }}
            />
          </div>
        )}
      </div>
      <fieldset className="sc-field sc-links">
        <legend className="sc-field-label">{form.links}</legend>
        {links.map((link, index) => (
          // Drafts have no identity of their own; their position is what tells them apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered drafts without ids
          <div key={index} className="sc-link-row">
            <input
              className="sc-input"
              type="url"
              placeholder="https://"
              pattern="https://.*"
              maxLength={MAX_URL_LENGTH}
              value={link.url}
              onChange={(event) =>
                setLinks(
                  links.map((entry, at) =>
                    at === index ? { ...entry, url: event.target.value } : entry,
                  ),
                )
              }
            />
            <input
              className="sc-input"
              placeholder={form.label}
              maxLength={MAX_LINK_LABEL_LENGTH}
              value={link.label}
              onChange={(event) =>
                setLinks(
                  links.map((entry, at) =>
                    at === index ? { ...entry, label: event.target.value } : entry,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLinks(links.filter((_, at) => at !== index))}
            >
              {words.common.remove}
            </Button>
          </div>
        ))}
        {links.length < MAX_LINKS && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLinks([...links, { url: "", label: "" }])}
          >
            {form.addLink}
          </Button>
        )}
      </fieldset>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={props.busy === true || title.trim() === "" || !datesInOrder}
        >
          {task === undefined ? form.write : words.common.save}
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
