import { useState } from "react";
import {
  agentLabel,
  MAX_BODY_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionPatch,
  type RestTask,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { Markdown } from "./markdown.js";
import { Pager, pageOf, RECORD_PAGE_SIZE } from "./paged.js";
import { Badge, Button, cx, PersonChip, personName, Time } from "./ui.js";

// The decisions: the ones that wait, each a card with the way to answer it, since they are what
// a person came for; and the ones answered, the record, a row each, since they are read back
// rarely and looked up by what was asked. Each decision is a record (ADR-0009) of its context,
// its answer with the rationale, and what followed, read on its own page. Each component takes
// its data as props and nothing from the network.

export interface DecisionCardProps {
  readonly decision: RestDecision;
  /** The task the decision is about, when it is about one and the page knows it. */
  readonly task?: RestTask | undefined;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  /** Where a document the decision links to is read, by its path. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** Where the decision's own page is; given, the question leads to it. */
  readonly href?: string | undefined;
  /** Called with the person's answer. Left out, a waiting decision cannot be answered here. */
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  /** Called to grow the record, with what followed. Left out, it cannot be written here. */
  readonly onUpdate?: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy?: boolean | undefined;
}

/**
 * Who asked, and when: the person, through their agent when a run asked; and whom the decision
 * is for, where that is someone else (ADR-0042).
 */
function Asked(props: { readonly decision: RestDecision; readonly day?: boolean }) {
  const words = useWords();
  const { decision } = props;
  return (
    <>
      <PersonChip person={decision.raisedBy} />{" "}
      {decision.run === null
        ? words.decisions.asked
        : words.decisions.askedThrough(agentLabel(decision.run.agent))}{" "}
      <Time iso={decision.createdAt} precision={props.day === true ? "day" : "minute"} />
      {decision.decider.id !== decision.raisedBy.id && (
        <>
          {" "}
          {words.decisions.forPerson} <PersonChip person={decision.decider} />
        </>
      )}
    </>
  );
}

/** What was chosen: the option's label, marked when it is the person's own words. */
function Chosen(props: { readonly decision: RestDecision }) {
  const words = useWords();
  const { decision } = props;
  const chosen = decision.options.find((option) => option.id === decision.answer?.option);
  return (
    <>
      <span>{chosen?.label ?? decision.answer?.option ?? ""}</span>
      {chosen?.own === true && <Badge>{words.decisions.ownAnswer}</Badge>}
    </>
  );
}

/**
 * The way to answer: one of the options, or a line of one's own, which is chosen by writing
 * on it; and a word about either.
 */
function AnswerForm(props: {
  readonly decision: RestDecision;
  readonly onAnswer: (decision: RestDecision, input: RestAnswerInput) => void;
  readonly busy: boolean | undefined;
}) {
  const words = useWords();
  const { decision } = props;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [own, setOwn] = useState(false);
  const [ownText, setOwnText] = useState("");
  const [note, setNote] = useState("");
  const chooseOwn = () => {
    setOwn(true);
    setChosen(undefined);
  };
  const answer: RestAnswerInput | undefined = own
    ? ownText.trim().length > 0
      ? { own: ownText.trim() }
      : undefined
    : chosen === undefined
      ? undefined
      : { option: chosen };
  const name = `decision-${decision.id}`;
  return (
    <form
      className="sc-answer-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer !== undefined) {
          props.onAnswer(decision, {
            ...answer,
            ...(note.trim() === "" ? {} : { note: note.trim() }),
          });
        }
      }}
    >
      <div className="sc-options-list" role="radiogroup" aria-label={words.decisions.options}>
        {decision.options.map((option) => (
          <label
            key={option.id}
            className={cx("sc-option", chosen === option.id && "sc-option-chosen")}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={chosen === option.id}
              onChange={() => {
                setChosen(option.id);
                setOwn(false);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        <label className={cx("sc-option", "sc-option-own", own && "sc-option-chosen")}>
          <input type="radio" name={name} value="own" checked={own} onChange={chooseOwn} />
          <span>{words.decisions.own}</span>
          <input
            className="sc-input"
            aria-label={words.decisions.own}
            placeholder={words.decisions.ownPlaceholder}
            maxLength={MAX_OPTION_LABEL_LENGTH}
            value={ownText}
            onFocus={chooseOwn}
            onChange={(event) => {
              setOwnText(event.target.value);
              chooseOwn();
            }}
          />
        </label>
      </div>
      <input
        className="sc-input"
        placeholder={words.decisions.notePlaceholder}
        maxLength={MAX_NOTE_LENGTH}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="sc-form-actions">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={answer === undefined || props.busy === true}
        >
          {words.decisions.answer}
        </Button>
      </div>
    </form>
  );
}

/** What followed the decision: shown, and written or changed by whoever may. */
function Outcome(props: {
  readonly decision: RestDecision;
  readonly docHref: ((path: string) => string) | undefined;
  readonly onUpdate: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy: boolean | undefined;
}) {
  const words = useWords();
  const { decision } = props;
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(decision.outcome ?? "");
  if (decision.outcome === null && props.onUpdate === undefined) {
    return null;
  }
  return (
    <section className="sc-decision-section" aria-label={words.decisions.whatFollowed}>
      <h4 className="sc-decision-label">{words.decisions.whatFollowed}</h4>
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
            placeholder={words.decisions.outcomePlaceholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="sc-form-actions">
            <Button type="submit" variant="primary" size="sm" disabled={props.busy === true}>
              {words.common.save}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setWriting(false)}>
              {words.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {decision.outcome === null ? (
            <p className="sc-muted">{words.decisions.nothingWritten}</p>
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
              {decision.outcome === null
                ? words.decisions.writeWhatFollowed
                : words.decisions.changeIt}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function DecisionCard(props: DecisionCardProps) {
  const words = useWords();
  const { decision, task } = props;
  const answered = decision.answer !== null;

  return (
    <article id={decision.id} className={cx("sc-decision", answered && "sc-decision-answered")}>
      <header className="sc-decision-header">
        <h3 className="sc-decision-question">
          {props.href === undefined ? (
            decision.question
          ) : (
            <a href={props.href}>{decision.question}</a>
          )}
        </h3>
        <p className="sc-decision-meta">
          <Asked decision={decision} />
          {task !== undefined && (
            <>
              {" "}
              {words.decisions.about}{" "}
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
        <section className="sc-decision-section" aria-label={words.decisions.context}>
          <h4 className="sc-decision-label">{words.decisions.context}</h4>
          <Markdown source={decision.body} docHref={props.docHref} />
        </section>
      )}
      {decision.answer !== null ? (
        <div className="sc-answer">
          <p className="sc-answer-option">
            <Chosen decision={decision} />
          </p>
          {decision.answer.note !== null && (
            <div className="sc-answer-note">
              <Markdown source={decision.answer.note} docHref={props.docHref} />
            </div>
          )}
          <p className="sc-decision-meta">
            <PersonChip person={decision.answer.by} /> {words.decisions.answeredBy}{" "}
            <Time iso={decision.answer.at} />
          </p>
        </div>
      ) : props.onAnswer === undefined ? (
        <p className="sc-decision-waiting">
          {words.decisions.waitingFor(personName(decision.decider))}
        </p>
      ) : (
        <AnswerForm decision={decision} onAnswer={props.onAnswer} busy={props.busy} />
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
  /** Where each decision's own page is. */
  readonly decisionHref?: ((decision: RestDecision) => string) | undefined;
  /** The page of the record shown, from 1, and where each page is (ADR-0010); left out, the record turns its pages in place. */
  readonly page?: number | undefined;
  readonly pageHref?: ((page: number) => string) | undefined;
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  readonly onUpdate?: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: React.ReactNode;
}

export interface DecisionLogProps {
  /** The decisions answered, newest first. */
  readonly decisions: readonly RestDecision[];
  readonly tasks?: ReadonlyMap<string, RestTask> | undefined;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  /** Where each decision's own page is, with its context, its rationale and what followed. */
  readonly decisionHref?: ((decision: RestDecision) => string) | undefined;
  /** Where a document the word given with an answer links to is read, by its path. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** The page shown, from 1; the first when left out, the last for one past the end. Read with `pageHref`. */
  readonly page?: number | undefined;
  /** Where each page of the record is, so that a page has an address; left out, the pages turn in place. */
  readonly pageHref?: ((page: number) => string) | undefined;
}

/** One row of the record: what was asked, by whom and when; what was answered, with the word given, by whom and when. */
function RecordRow(props: {
  readonly decision: RestDecision;
  readonly task: RestTask | undefined;
  readonly taskHref: ((task: RestTask) => string) | undefined;
  readonly href: string | undefined;
  readonly docHref: ((path: string) => string) | undefined;
}) {
  const words = useWords();
  const { decision, task } = props;
  const { answer } = decision;
  return (
    <li className="sc-decision-record-row">
      <div className="sc-decision-record-asked">
        <p className="sc-decision-record-question">
          {props.href === undefined ? (
            decision.question
          ) : (
            <a href={props.href}>{decision.question}</a>
          )}
          {task !== undefined &&
            (props.taskHref === undefined ? (
              <span className="sc-card-number">#{task.number}</span>
            ) : (
              <a className="sc-card-number" href={props.taskHref(task)}>
                #{task.number}
              </a>
            ))}
        </p>
        <p className="sc-decision-record-meta">
          <Asked decision={decision} day />
        </p>
      </div>
      {answer !== null && (
        <div className="sc-decision-record-answer">
          <p className="sc-decision-record-chosen">
            <Chosen decision={decision} />
          </p>
          {answer.note !== null && (
            <div className="sc-decision-record-note">
              <Markdown source={answer.note} docHref={props.docHref} />
            </div>
          )}
          <p className="sc-decision-record-meta">
            <PersonChip person={answer.by} /> {words.decisions.answeredBy}{" "}
            <Time iso={answer.at} precision="day" />
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * The record: one row per decision answered, what was asked and by whom, what was chosen with
 * the word given and by whom; twenty to a page, the page named by the address or turned here.
 */
export function DecisionLog(props: DecisionLogProps) {
  const words = useWords();
  const [turned, setTurned] = useState(1);
  const { shown, page, pages } = pageOf(
    props.decisions,
    props.pageHref === undefined ? turned : props.page,
    RECORD_PAGE_SIZE,
  );
  return (
    <>
      <ol className="sc-decision-record" aria-label={words.decisions.record}>
        {shown.map((decision) => (
          <RecordRow
            key={decision.id}
            decision={decision}
            task={decision.taskId === null ? undefined : props.tasks?.get(decision.taskId)}
            taskHref={props.taskHref}
            href={props.decisionHref?.(decision)}
            docHref={props.docHref}
          />
        ))}
      </ol>
      <Pager
        page={page}
        pages={pages}
        total={props.decisions.length}
        pageSize={RECORD_PAGE_SIZE}
        pageHref={props.pageHref}
        onPage={setTurned}
      />
    </>
  );
}

export function DecisionList(props: DecisionListProps) {
  const words = useWords();
  const waiting = props.decisions.filter((decision) => decision.answer === null);
  const answered = props.decisions.filter((decision) => decision.answer !== null);
  const card = (decision: RestDecision) => (
    <DecisionCard
      key={decision.id}
      decision={decision}
      task={decision.taskId === null ? undefined : props.tasks.get(decision.taskId)}
      taskHref={props.taskHref}
      docHref={props.docHref}
      href={props.decisionHref?.(decision)}
      onAnswer={props.onAnswer}
      onUpdate={props.onUpdate}
      busy={props.busy}
    />
  );
  return (
    <div className="sc-decisions">
      <section aria-label={words.decisions.waiting}>
        <h2 className="sc-section-title">
          {words.decisions.waiting} <span className="sc-column-count">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (props.empty ?? null) : waiting.map(card)}
      </section>
      {answered.length > 0 && (
        <section aria-label={words.decisions.answered}>
          <h2 className="sc-section-title">
            {words.decisions.record} <span className="sc-column-count">{answered.length}</span>
          </h2>
          <DecisionLog
            decisions={answered}
            tasks={props.tasks}
            taskHref={props.taskHref}
            decisionHref={props.decisionHref}
            docHref={props.docHref}
            page={props.page}
            pageHref={props.pageHref}
          />
        </section>
      )}
    </div>
  );
}
