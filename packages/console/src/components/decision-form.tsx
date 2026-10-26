import { type FormEvent, useMemo, useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  type RestDecisionInput,
  type RestPerson,
  type RestTask,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Picker, type PickerSearch } from "./picker.js";
import { type TaskSearch, taskLabel } from "./task-form.js";
import { Button, PersonChip, personName } from "./ui.js";

// Raising a decision: the question, what a person needs to know, the options to choose from,
// and who is to answer (ADR-0042): the person raising it, unless they name another of the
// project. The task it is about is the page's, when raised from a task; otherwise it is found
// by searching the board a page at a time (ADR-0037), never picked from the board whole.

export interface DecisionFormProps {
  /** The task it is about from the start, when raised from a task's page; the field is not shown then. */
  readonly taskId?: string | undefined;
  /** What words find among the tasks of the project, a page at a time; left out, the decision is about no task in particular. */
  readonly findTasks?: TaskSearch | undefined;
  /** Who may be named to answer: the people of the project; left out, the field is not shown and the raiser answers. */
  readonly deciders?: readonly RestPerson[] | undefined;
  /** Whoever raises it: who answers unless another is named. */
  readonly me?: RestPerson | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestDecisionInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** The people of the project found by the words typed, a page at a time, as a picker searches. */
export function peopleSearch(people: readonly RestPerson[]): PickerSearch<RestPerson> {
  return async (query, page) => {
    const words = query.trim().toLowerCase();
    const found = people.filter(
      (person) =>
        words.length === 0 ||
        personName(person).toLowerCase().includes(words) ||
        person.login.toLowerCase().includes(words),
    );
    return {
      items: found.slice(page.offset, page.offset + page.limit),
      more: found.length > page.offset + page.limit,
    };
  };
}

export function DecisionForm(props: DecisionFormProps) {
  const words = useWords();
  const form = words.decisions.form;
  const [question, setQuestion] = useState("");
  const [body, setBody] = useState("");
  const [about, setAbout] = useState<RestTask | undefined>(undefined);
  const [options, setOptions] = useState<readonly string[]>(["", ""]);
  const [decider, setDecider] = useState<RestPerson | undefined>(props.me);
  const findDeciders = useMemo(() => peopleSearch(props.deciders ?? []), [props.deciders]);

  const labels = options.map((option) => option.trim()).filter((option) => option.length > 0);
  const ready = question.trim().length > 0 && labels.length >= MIN_OPTIONS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      question: question.trim(),
      body,
      options: labels.map((label) => ({ label })),
      taskId: props.taskId ?? about?.id ?? null,
      ...(decider === undefined || decider.id === props.me?.id ? {} : { deciderId: decider.id }),
    });
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">{form.question}</span>
        <input
          className="sc-input"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          required
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <label className="sc-field">
        <span className="sc-field-label">{form.context}</span>
        <textarea
          className="sc-input sc-textarea"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          rows={4}
          placeholder={form.contextPlaceholder}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      {props.taskId === undefined && props.findTasks !== undefined && (
        <div className="sc-field">
          <span className="sc-field-label">{form.about}</span>
          <Picker
            value={about}
            search={props.findTasks}
            keyOf={(task) => task.id}
            render={taskLabel}
            label={form.about}
            placeholder={form.noTask}
            disabled={props.busy}
            onChange={setAbout}
          />
        </div>
      )}
      {props.deciders !== undefined && (
        <div className="sc-field">
          <span className="sc-field-label">{form.decider}</span>
          <Picker
            value={decider}
            search={findDeciders}
            keyOf={(person) => person.id}
            render={(person) => (
              <>
                <PersonChip person={person} size="sm" />
                {person.id === props.me?.id && <span className="sc-muted"> {form.me}</span>}
              </>
            )}
            label={form.decider}
            placeholder={form.deciderPlaceholder}
            disabled={props.busy}
            onChange={(person) => setDecider(person ?? props.me)}
          />
        </div>
      )}
      <fieldset className="sc-field sc-options">
        <legend className="sc-field-label">{form.options}</legend>
        {options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered drafts without ids
          <div key={index} className="sc-link-row">
            <input
              className="sc-input"
              value={option}
              maxLength={MAX_OPTION_LABEL_LENGTH}
              placeholder={form.option(index + 1)}
              onChange={(event) =>
                setOptions(options.map((entry, at) => (at === index ? event.target.value : entry)))
              }
            />
            {options.length > MIN_OPTIONS && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOptions(options.filter((_, at) => at !== index))}
              >
                {words.common.remove}
              </Button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ""])}>
            {form.addOption}
          </Button>
        )}
      </fieldset>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy === true || !ready}>
          {form.raise}
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
