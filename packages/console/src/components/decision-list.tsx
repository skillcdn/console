import { useState } from "react";
import { MAX_NOTE_LENGTH, type RestAnswerInput, type RestDecision, type RestTask } from "../api.js";
import { Markdown } from "./markdown.js";
import { Button, cx, PersonChip, Time } from "./ui.js";

// The decisions: the ones that wait, with the way to answer each, and the ones answered, with
// who answered and when. Each takes its data as props and nothing from the network.

export interface DecisionCardProps {
  readonly decision: RestDecision;
  /** The task the decision is about, when it is about one and the page knows it. */
  readonly task?: RestTask | undefined;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  /** Called with the person's answer. Left out, a waiting decision cannot be answered here. */
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  readonly busy?: boolean | undefined;
}

export function DecisionCard(props: DecisionCardProps) {
  const { decision, task } = props;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const answered = decision.answer !== null;
  const chosenLabel = (id: string) =>
    decision.options.find((option) => option.id === id)?.label ?? id;

  return (
    <article className={cx("sc-decision", answered && "sc-decision-answered")}>
      <header className="sc-decision-header">
        <h3 className="sc-decision-question">{decision.question}</h3>
        <p className="sc-decision-meta">
          <PersonChip person={decision.raisedBy} /> asked <Time iso={decision.createdAt} />
          {task !== undefined && (
            <>
              {" "}
              about{" "}
              {props.taskHref === undefined ? (
                <span>
                  #{task.number} {task.title}
                </span>
              ) : (
                <a href={props.taskHref(task)}>
                  #{task.number} {task.title}
                </a>
              )}
            </>
          )}
        </p>
      </header>
      {decision.body.length > 0 && <Markdown source={decision.body} />}
      {decision.answer !== null ? (
        <div className="sc-answer">
          <p className="sc-answer-option">{chosenLabel(decision.answer.option)}</p>
          {decision.answer.note !== null && (
            <p className="sc-answer-note">{decision.answer.note}</p>
          )}
          <p className="sc-decision-meta">
            <PersonChip person={decision.answer.by} /> answered <Time iso={decision.answer.at} />
          </p>
        </div>
      ) : props.onAnswer === undefined ? (
        <p className="sc-decision-waiting">Waiting for a person.</p>
      ) : (
        <form
          className="sc-answer-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen !== undefined) {
              props.onAnswer?.(decision, {
                option: chosen,
                ...(note.trim() === "" ? {} : { note: note.trim() }),
              });
            }
          }}
        >
          <div className="sc-options-list" role="radiogroup" aria-label="Options">
            {decision.options.map((option) => (
              <label
                key={option.id}
                className={cx("sc-option", chosen === option.id && "sc-option-chosen")}
              >
                <input
                  type="radio"
                  name={`decision-${decision.id}`}
                  value={option.id}
                  checked={chosen === option.id}
                  onChange={() => setChosen(option.id)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <input
            className="sc-input"
            placeholder="A word about it, if any"
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="sc-form-actions">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={chosen === undefined || props.busy === true}
            >
              Answer
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

export interface DecisionListProps {
  readonly decisions: readonly RestDecision[];
  /** The tasks the decisions may be about, by id, for the cards to name them. */
  readonly tasks: ReadonlyMap<string, RestTask>;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: React.ReactNode;
}

export function DecisionList(props: DecisionListProps) {
  const waiting = props.decisions.filter((decision) => decision.answer === null);
  const answered = props.decisions.filter((decision) => decision.answer !== null);
  const card = (decision: RestDecision) => (
    <DecisionCard
      key={decision.id}
      decision={decision}
      task={decision.taskId === null ? undefined : props.tasks.get(decision.taskId)}
      taskHref={props.taskHref}
      onAnswer={props.onAnswer}
      busy={props.busy}
    />
  );
  return (
    <div className="sc-decisions">
      <section aria-label="Waiting">
        <h2 className="sc-section-title">
          Waiting <span className="sc-column-count">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (props.empty ?? null) : waiting.map(card)}
      </section>
      {answered.length > 0 && (
        <section aria-label="Answered">
          <h2 className="sc-section-title">
            Answered <span className="sc-column-count">{answered.length}</span>
          </h2>
          {answered.map(card)}
        </section>
      )}
    </div>
  );
}
