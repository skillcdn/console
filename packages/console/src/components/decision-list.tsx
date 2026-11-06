import { useState } from "react";
import {
  agentLabel,
  MAX_BODY_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionFile,
  type RestDecisionPatch,
  type RestPerson,
  type RestTask,
} from "../api.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { textIn } from "../translations.js";
import { isPicture, namedFile, placed } from "./files.js";
import { Markdown } from "./markdown.js";
import { Pager, pageOf, RECORD_PAGE_SIZE } from "./paged.js";
import { Lightbox, PictureThumb, usePicture } from "./pictures.js";
import { Badge, Button, cx, formatBytes, PersonChip, personName, Time } from "./ui.js";

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
  /** The project the decision is in, named where a page shows the decisions of several. */
  readonly project?: React.ReactNode;
  /** Where a file put on the decision is read, by its id (ADR-0055); left out, the files are named and not linked. */
  readonly fileHref?: ((fileId: string) => string) | undefined;
  /** Called with the person's answer. Left out, a waiting decision cannot be answered here. */
  readonly onAnswer?: ((decision: RestDecision, input: RestAnswerInput) => void) | undefined;
  /** Called to grow the record, with what followed. Left out, it cannot be written here. */
  readonly onUpdate?: ((decision: RestDecision, patch: RestDecisionPatch) => void) | undefined;
  readonly busy?: boolean | undefined;
}

/** The word beside who answered: through their agent, when the answer came that way (ADR-0056). */
function answeredWord(words: ReturnType<typeof useWords>, agent: string | null | undefined) {
  return agent === null || agent === undefined
    ? words.decisions.answeredBy
    : words.decisions.answeredThrough(agentLabel(agent));
}

/** Everyone a decision is addressed to (ADR-0057): `deciders` where the console answers it, else the one decider. */
export function decidersOf(decision: RestDecision): readonly RestPerson[] {
  return decision.deciders !== undefined && decision.deciders.length > 0
    ? decision.deciders
    : [decision.decider];
}

/** The names of everyone a decision is addressed to, one after another. */
export function deciderNames(decision: RestDecision): string {
  return decidersOf(decision).map(personName).join(", ");
}

/**
 * Who asked, and when: the person, through their agent when a run asked; and whom the decision
 * is for, where that is not the asker alone (ADR-0042, ADR-0057).
 */
function Asked(props: { readonly decision: RestDecision; readonly day?: boolean }) {
  const words = useWords();
  const { decision } = props;
  const deciders = decidersOf(decision);
  const addressed = deciders.some((person) => person.id !== decision.raisedBy.id);
  return (
    <>
      <PersonChip person={decision.raisedBy} />{" "}
      {decision.run === null
        ? words.decisions.asked
        : words.decisions.askedThrough(agentLabel(decision.run.agent))}{" "}
      <Time iso={decision.createdAt} precision={props.day === true ? "day" : "minute"} />
      {addressed && (
        <span className="sc-decision-for">
          <span className="sc-visually-hidden">
            {words.decisions.peopleLabel(personName(decision.raisedBy), deciderNames(decision))}
          </span>
          <span className="sc-decision-arrow" aria-hidden="true">
            →
          </span>{" "}
          {deciders.map((person) => (
            <PersonChip key={person.id} person={person} />
          ))}
        </span>
      )}
    </>
  );
}

/** What was chosen: the option's label, marked when it is the person's own words. */
function Chosen(props: { readonly decision: RestDecision }) {
  const words = useWords();
  const { tag } = useLanguage();
  const { decision } = props;
  const chosen = decision.options.find((option) => option.id === decision.answer?.option);
  return (
    <>
      <span>
        {chosen === undefined
          ? (decision.answer?.option ?? "")
          : textIn(decision.translations?.options?.[chosen.id], chosen.label, tag)}
      </span>
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
  const { tag } = useLanguage();
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
            <span>{textIn(decision.translations?.options?.[option.id], option.label, tag)}</span>
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
            <>
              <Markdown source={decision.outcome} docHref={props.docHref} />
              {decision.outcomeBy != null && decision.outcomeAt != null && (
                <p className="sc-decision-meta">
                  <PersonChip person={decision.outcomeBy} />{" "}
                  {decision.outcomeAgent == null
                    ? words.decisions.wroteWhatFollowed
                    : words.decisions.wroteWhatFollowedThrough(
                        agentLabel(decision.outcomeAgent),
                      )}{" "}
                  <Time iso={decision.outcomeAt} />
                </p>
              )}
            </>
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
  // The files put on the decision (ADR-0055): a picture the context names by its file name is
  // shown where the text puts it; the rest follow the context, pictures in place and
  // everything else as a link.
  const files = decision.files ?? [];
  const pictures = usePicture();
  // In the language the page speaks, where the decision was asked in several (ADR-0058).
  const { tag } = useLanguage();
  const question = textIn(decision.translations?.question, decision.question, tag);
  const body = textIn(decision.translations?.body, decision.body, tag);
  const hrefOf = (file: RestDecisionFile) => props.fileHref?.(file.id);
  const named = (source: string): string | undefined => {
    const name = namedFile(source);
    const file = files.find(
      (candidate) => candidate.file.name === name && isPicture(candidate.file.contentType),
    );
    return file === undefined ? undefined : hrefOf(file);
  };
  const following = files.filter((file) => !placed(body, file.file.name));

  return (
    <article id={decision.id} className={cx("sc-decision", answered && "sc-decision-answered")}>
      <header className="sc-decision-header">
        <h3 className="sc-decision-question">
          {props.href === undefined ? question : <a href={props.href}>{question}</a>}
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
          {props.project}
        </p>
      </header>
      {body.length > 0 && (
        <section className="sc-decision-section" aria-label={words.decisions.context}>
          <h4 className="sc-decision-label">{words.decisions.context}</h4>
          <Markdown
            source={body}
            docHref={props.docHref}
            fileSrc={named}
            onOpenPicture={pictures.open}
          />
        </section>
      )}
      {following.length > 0 && (
        <section className="sc-decision-section" aria-label={words.decisions.files}>
          <h4 className="sc-decision-label">{words.decisions.files}</h4>
          <ul className="sc-decision-files">
            {following.map((attached) => {
              const href = hrefOf(attached);
              const { file } = attached;
              if (href !== undefined && isPicture(file.contentType)) {
                return (
                  <li key={attached.id} className="sc-decision-picture">
                    <PictureThumb
                      picture={{
                        src: href,
                        alt: words.decisions.picture(file.name),
                        name: file.name,
                        size: file.size,
                      }}
                      onOpen={pictures.open}
                    />
                    <span className="sc-muted">
                      {file.name}, {formatBytes(file.size)}
                    </span>
                  </li>
                );
              }
              return (
                <li key={attached.id}>
                  {href === undefined ? (
                    <span>{file.name}</span>
                  ) : (
                    <a href={href} rel="nofollow ugc">
                      {file.name}
                    </a>
                  )}{" "}
                  <span className="sc-muted">{formatBytes(file.size)}</span>
                </li>
              );
            })}
          </ul>
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
            <PersonChip person={decision.answer.by} /> {answeredWord(words, decision.answer.agent)}{" "}
            <Time iso={decision.answer.at} />
          </p>
        </div>
      ) : props.onAnswer === undefined ? (
        <p className="sc-decision-waiting">{words.decisions.waitingFor(deciderNames(decision))}</p>
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
      <Lightbox picture={pictures.shown} onClose={pictures.close} />
    </article>
  );
}

export interface DecisionListProps {
  readonly decisions: readonly RestDecision[];
  /** The tasks the decisions may be about, by id, for the cards to name them. */
  readonly tasks: ReadonlyMap<string, RestTask>;
  readonly taskHref?: ((task: RestTask) => string) | undefined;
  readonly docHref?: ((path: string) => string) | undefined;
  /** Where a file put on a decision is read, by its id (ADR-0055). */
  readonly fileHref?: ((fileId: string) => string) | undefined;
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
  /** The project a decision is in, named where the record holds the decisions of several. */
  readonly projectOf?: ((decision: RestDecision) => React.ReactNode) | undefined;
}

/** One row of the record: what was asked, by whom and when; what was answered, with the word given, by whom and when. */
function RecordRow(props: {
  readonly decision: RestDecision;
  readonly task: RestTask | undefined;
  readonly taskHref: ((task: RestTask) => string) | undefined;
  readonly href: string | undefined;
  readonly docHref: ((path: string) => string) | undefined;
  readonly project?: React.ReactNode;
}) {
  const words = useWords();
  const { tag } = useLanguage();
  const { decision, task } = props;
  const { answer } = decision;
  const question = textIn(decision.translations?.question, decision.question, tag);
  return (
    <li className="sc-decision-record-row">
      <div className="sc-decision-record-asked">
        <p className="sc-decision-record-question">
          {props.href === undefined ? question : <a href={props.href}>{question}</a>}
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
          {props.project}
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
            <PersonChip person={answer.by} /> {answeredWord(words, answer.agent)}{" "}
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
            project={props.projectOf?.(decision)}
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
      fileHref={props.fileHref}
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
