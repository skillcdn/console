import { useState } from "react";
import {
  MAX_BODY_LENGTH,
  MAX_NOTE_LENGTH,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionPatch,
  type RestTask,
} from "../api.js";
import { Markdown } from "./markdown.js";
import { Button, cx, PersonChip, Time } from "./ui.js";

// The decisions: the ones that wait, with the way to answer each, and the ones answered, with
// who answered and when; each a record (ADR-0009) of its context, its answer with the
// rationale, and what followed. Each takes its data as props and nothing from the network.

export interface DecisionCardProps {
  readonly decision: RestDecision;
  /** The task the decision is about, when it is about one and the page knows it. */
  readonly task?: RestTask | undefined;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  /** Where a document the decision links to is read, by its path. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** Called with the person's answer. Left out, a waiting decision cannot be answered here. */
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  /** Called to grow the record, with what followed. Left out, it cannot be written here. */
  readonly onUpdate?: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy?: boolean | undefined;
}

/** What followed the decision: shown, and written or changed by whoever may. */
function Outcome(props: {
  readonly decision: RestDecision;
  readonly docHref: ((path: string) => string) | undefined;
  readonly onUpdate: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy: boolean | undefined;
}) {
  const { decision } = props;
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(decision.outcome ?? "");
  if (decision.outcome === null && props.onUpdate === undefined) {
    return null;
  }
  return (
    <section className="sc-decision-section" aria-label="What followed">
      <h4 className="sc-decision-label">What followed</h4>
      {writing ? (
        <form
          className="sc-outcome-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onUpdate?.(decision, { outcome: draft });
            setWriting(false);
          }}
        >
          <textarea
            className="sc-input sc-textarea"
            value={draft}
            maxLength={MAX_BODY_LENGTH}
            rows={4}
            placeholder="What was done with the answer, and what came of it, in Markdown."
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="sc-form-actions">
            <Button type="submit" variant="primary" size="sm" disabled={props.busy === true}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setWriting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {decision.outcome === null ? (
            <p className="sc-muted">Nothing written yet.</p>
          ) : (
            <Markdown source={decision.outcome} docHref={props.docHref} />
          )}
          {props.onUpdate !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              disabled={props.busy === true}
              onClick={() => {
                setDraft(decision.outcome ?? "");
                setWriting(true);
              }}
            >
              {decision.outcome === null ? "Write what followed" : "Change it"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function DecisionCard(props: DecisionCardProps) {
  const { decision, task } = props;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const answered = decision.answer !== null;
  const chosenLabel = (id: string) =>
    decision.options.find((option) => option.id === id)?.label ?? id;

  return (
    <article id={decision.id} className={cx("sc-decision", answered && "sc-decision-answered")}>
      <header className="sc-decision-header">
        <h3 className="sc-decision-question">{decision.question}</h3>
        <p className="sc-decision-meta">
          <PersonChip person={decision.raisedBy} />{" "}
          {decision.run === null ? "asked" : `asked through ${decision.run.agent}`}{" "}
          <Time iso={decision.createdAt} />
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
      {decision.body.length > 0 && (
        <section className="sc-decision-section" aria-label="Context">
          <h4 className="sc-decision-label">Context</h4>
          <Markdown source={decision.body} docHref={props.docHref} />
        </section>
      )}
      {decision.answer !== null ? (
        <div className="sc-answer">
          <p className="sc-answer-option">{chosenLabel(decision.answer.option)}</p>
          {decision.answer.note !== null && (
            <div className="sc-answer-note">
              <Markdown source={decision.answer.note} docHref={props.docHref} />
            </div>
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
      {answered && (
        <Outcome
          decision={decision}
          docHref={props.docHref}
          onUpdate={props.onUpdate}
          busy={props.busy}
        />
      )}
    </article>
  );
}

export interface DecisionListProps {
  readonly decisions: readonly RestDecision[];
  /** The tasks the decisions may be about, by id, for the cards to name them. */
  readonly tasks: ReadonlyMap<string, RestTask>;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  readonly docHref?: ((path: string) => string) | undefined;
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  readonly onUpdate?: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
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
      docHref={props.docHref}
      onAnswer={props.onAnswer}
      onUpdate={props.onUpdate}
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
