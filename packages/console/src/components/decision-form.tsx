import { type FormEvent, useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  type RestDecisionInput,
  type RestTask,
} from "../api.js";
import { Button } from "./ui.js";

// Raising a decision: the question, what a person needs to know, and the options to choose from.

export interface DecisionFormProps {
  /** The tasks the decision may be about. */
  readonly tasks: readonly RestTask[];
  /** The task it is about from the start, when raised from a task's page. */
  readonly taskId?: string | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: RestDecisionInput) => void;
  readonly onCancel?: (() => void) | undefined;
}

export function DecisionForm(props: DecisionFormProps) {
  const [question, setQuestion] = useState("");
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState(props.taskId ?? "");
  const [options, setOptions] = useState<readonly string[]>(["", ""]);

  const labels = options.map((option) => option.trim()).filter((option) => option.length > 0);
  const ready = question.trim().length > 0 && labels.length >= MIN_OPTIONS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      question: question.trim(),
      body,
      options: labels.map((label) => ({ label })),
      taskId: taskId === "" ? null : taskId,
    });
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">Question</span>
        <input
          className="sc-input"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          required
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <label className="sc-field">
        <span className="sc-field-label">Context</span>
        <textarea
          className="sc-input sc-textarea"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          rows={4}
          placeholder="What a person needs to know to answer, in Markdown."
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      {props.taskId === undefined && props.tasks.length > 0 && (
        <label className="sc-field">
          <span className="sc-field-label">About</span>
          <select
            className="sc-input"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
          >
            <option value="">No task in particular</option>
            {props.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                #{task.number} {task.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="sc-field sc-options">
        <legend className="sc-field-label">Options</legend>
        {options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered drafts without ids
          <div key={index} className="sc-link-row">
            <input
              className="sc-input"
              value={option}
              maxLength={MAX_OPTION_LABEL_LENGTH}
              placeholder={`Option ${index + 1}`}
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
                Remove
              </Button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ""])}>
            Add an option
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
          Raise the decision
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
