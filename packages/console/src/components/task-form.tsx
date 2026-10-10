import { type FormEvent, useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINKS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  type RestPerson,
  type RestTask,
  type RestTaskInput,
  TASK_PRIORITIES,
  TASK_STATES,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Button } from "./ui.js";

// Writing a task, or changing one. The bounds are the package's, said before a request is made.

export interface TaskFormProps {
  readonly people: readonly RestPerson[];
  /** The task to change; left out, the form writes a new one. */
  readonly task?: RestTask | undefined;
  /** The tasks a new one may be part of. */
  readonly parents?: readonly RestTask[] | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestTaskInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

interface LinkDraft {
  readonly url: string;
  readonly label: string;
}

export function TaskForm(props: TaskFormProps) {
  const words = useWords();
  const form = words.task.form;
  const { task } = props;
  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [state, setState] = useState(task?.state ?? "idea");
  const [priority, setPriority] = useState(task?.priority ?? "normal");
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? "");
  const [parentId, setParentId] = useState(task?.parentId ?? "");
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
      assigneeId: assigneeId === "" ? null : assigneeId,
      parentId: parentId === "" ? null : parentId,
      links: links
        .filter((link) => link.url.trim().length > 0)
        .map((link) => ({
          url: link.url.trim(),
          label: link.label.trim() === "" ? null : link.label.trim(),
        })),
    });
  };

  const parents = (props.parents ?? []).filter((candidate) => candidate.id !== task?.id);

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
        <label className="sc-field">
          <span className="sc-field-label">{form.assignee}</span>
          <select
            className="sc-input"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">{words.common.nobody}</option>
            {props.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.login}
              </option>
            ))}
          </select>
        </label>
        {parents.length > 0 && (
          <label className="sc-field">
            <span className="sc-field-label">{form.partOf}</span>
            <select
              className="sc-input"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">{words.common.nothing}</option>
              {parents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  #{candidate.number} {candidate.title}
                </option>
              ))}
            </select>
          </label>
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
          disabled={props.busy === true || title.trim() === ""}
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
