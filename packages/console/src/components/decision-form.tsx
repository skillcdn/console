import { type ClipboardEvent, type FormEvent, useMemo, useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_DECIDERS,
  MAX_FILES_PER_DECISION,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  type RestDecisionInput,
  type RestPerson,
  type RestTask,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { isPicture, placing, unusedName } from "./files.js";
import { Picker } from "./picker.js";
import { peopleSearch } from "./searches.js";
import { type TaskSearch, taskLabel } from "./task-form.js";
import { Button, Chip, formatBytes, PersonChip, personName } from "./ui.js";

// Raising a decision: the question, what a person needs to know, the options to choose from,
// and who is to answer (ADR-0042): the person raising it, unless they name another of the
// project. The task it is about is the page's, when raised from a task; otherwise it is found
// by searching the board a page at a time (ADR-0037), never picked from the board whole. The
// files put on the decision (ADR-0055) are chosen or pasted here, a pasted picture placed in
// the context where pictures are read, as a comment's are.

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
  /** Called with the decision as the API takes it, and the files put on it (ADR-0055), none when none were chosen. */
  readonly onSubmit: (input: RestDecisionInput, files: readonly File[]) => void;
  readonly onCancel?: (() => void) | undefined;
}

/**
 * What the form sends of whom the decision is for: nothing for the raiser alone, `deciderId` for
 * one other person, `deciderIds` for several (ADR-0057), the first among them repeated as
 * `deciderId` for a console of before.
 */
export function decidersInput(
  deciders: readonly RestPerson[],
  me: RestPerson | undefined,
): Pick<RestDecisionInput, "deciderId" | "deciderIds"> {
  const ids = deciders.map((person) => person.id);
  if (ids.length === 0 || (ids.length === 1 && ids[0] === me?.id)) {
    return {};
  }
  const first = ids[0] ?? "";
  return ids.length === 1 ? { deciderId: first } : { deciderId: first, deciderIds: ids };
}

export function DecisionForm(props: DecisionFormProps) {
  const words = useWords();
  const form = words.decisions.form;
  const [question, setQuestion] = useState("");
  const [body, setBody] = useState("");
  const [about, setAbout] = useState<RestTask | undefined>(undefined);
  const [options, setOptions] = useState<readonly string[]>(["", ""]);
  // Whom it is for (ADR-0042, ADR-0057): the raiser, until others are named in their place.
  const [deciders, setDeciders] = useState<readonly RestPerson[]>(
    props.me === undefined ? [] : [props.me],
  );
  const [files, setFiles] = useState<readonly File[]>([]);
  const findDeciders = useMemo(
    () =>
      peopleSearch(
        (props.deciders ?? []).filter(
          (person) => !deciders.some((chosen) => chosen.id === person.id),
        ),
      ),
    [props.deciders, deciders],
  );

  const labels = options.map((option) => option.trim()).filter((option) => option.length > 0);
  const ready = question.trim().length > 0 && labels.length >= MIN_OPTIONS;

  const add = (chosen: readonly File[]): File[] => {
    const added: File[] = [];
    let held = files;
    for (const file of chosen) {
      if (held.length >= MAX_FILES_PER_DECISION) {
        break;
      }
      const name = unusedName(
        file.name,
        held.map((kept) => kept.name),
      );
      const kept = name === file.name ? file : new File([file], name, { type: file.type });
      held = [...held, kept];
      added.push(kept);
    }
    setFiles(held);
    return added;
  };

  // A picture pasted into the context goes with the decision, placed where pictures are read.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].filter((file) => isPicture(file.type));
    if (pasted.length === 0) {
      return;
    }
    event.preventDefault();
    const added = add(pasted);
    if (added.length > 0) {
      setBody((current) =>
        placing(
          current,
          added.map((file) => file.name),
        ),
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit(
      {
        question: question.trim(),
        body,
        options: labels.map((label) => ({ label })),
        taskId: props.taskId ?? about?.id ?? null,
        ...decidersInput(deciders, props.me),
      },
      files,
    );
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
          onPaste={paste}
        />
      </label>
      <div className="sc-field">
        <span className="sc-field-label">{form.files}</span>
        {files.length > 0 && (
          <ul className="sc-chosen-files" aria-label={form.files}>
            {files.map((file) => (
              <li key={file.name} className="sc-chosen-file">
                <span>{file.name}</span> <span className="sc-muted">{formatBytes(file.size)}</span>{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={form.removeFile(file.name)}
                  onClick={() => setFiles((current) => current.filter((held) => held !== file))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label className="sc-button sc-button-ghost sc-button-sm sc-file-choice">
          {form.chooseFiles}
          <input
            className="sc-file-input"
            type="file"
            multiple
            disabled={props.busy === true || files.length >= MAX_FILES_PER_DECISION}
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
        </label>
        <p className="sc-field-hint">{form.filesHint}</p>
      </div>
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
        <fieldset className="sc-field sc-workers-field">
          <legend className="sc-field-label">{form.decider}</legend>
          <div className="sc-chips">
            {deciders.map((person) => (
              <Chip
                key={person.id}
                onRemove={() =>
                  setDeciders((current) => current.filter((chosen) => chosen.id !== person.id))
                }
                removeLabel={`${words.common.remove}: ${personName(person)}`}
                disabled={props.busy}
              >
                <PersonChip person={person} />
                {person.id === props.me?.id && <span className="sc-muted"> {form.me}</span>}
              </Chip>
            ))}
            {deciders.length === 0 && <span className="sc-muted">{form.deciderPlaceholder}</span>}
            {deciders.length < MAX_DECIDERS && (
              <Picker
                className="sc-picker-add"
                value={undefined}
                search={findDeciders}
                keyOf={(person) => person.id}
                render={(person) => (
                  <>
                    <PersonChip person={person} size="sm" />
                    {person.id === props.me?.id && <span className="sc-muted"> {form.me}</span>}
                  </>
                )}
                label={form.addDecider}
                placeholder={form.addDecider}
                disabled={props.busy}
                onChange={(person) => {
                  if (person !== undefined) {
                    setDeciders((current) => [...current, person]);
                  }
                }}
              />
            )}
          </div>
          {deciders.length > 1 && <p className="sc-field-hint">{form.decidersHint}</p>}
        </fieldset>
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
