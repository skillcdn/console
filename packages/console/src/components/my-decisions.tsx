import type { ReactNode } from "react";
import type { RestAnswerInput, RestDecision, RestMyDecisions } from "../api.js";
import { useWords } from "../i18n/index.js";
import { DecisionCard, DecisionLog } from "./decision-list.js";
import { ProjectMark } from "./projects.js";
import { Button } from "./ui.js";

// A person's decisions (ADR-0042), across the projects they may see, laid out as a project's
// decisions page is: in the first column the decisions that wait for their answer, as cards
// answered here, and under them the decisions they asked of someone else, as cards that say
// whom they wait for; in the second the record, the answered ones of both kinds, newest first.
// Every card and row names the project, and who asked and who answers, as the cards do
// everywhere. Takes its data as props and nothing from the network; the page reads more when
// asked.

/** One kind of a person's decisions, a page at a time. */
export interface DecisionsPage {
  readonly items: RestMyDecisions["items"];
  /** Whether there is more after what is shown; `onMore` reads it. */
  readonly more?: boolean | undefined;
  readonly onMore?: (() => void) | undefined;
}

export interface MyDecisionsProps {
  /** The decisions addressed to the person: waiting and answered. */
  readonly addressed: DecisionsPage;
  /** The decisions the person asked of someone else: waiting and answered. */
  readonly raised: DecisionsPage;
  readonly decisionHref: (projectKey: string, decisionId: string) => string;
  /** Called with the person's answer on a decision of theirs, in its project. Left out, a waiting decision is answered on its own page. */
  readonly onAnswer?:
    | ((projectKey: string, decision: RestDecision, input: RestAnswerInput) => void)
    | undefined;
  readonly busy?: boolean | undefined;
}

type Item = RestMyDecisions["items"][number];

/** The project a decision is in, as the plate names one. */
function InProject(props: { readonly project: Item["project"] }) {
  const words = useWords();
  return (
    <span className="sc-task-row-project">
      <ProjectMark project={props.project} size="sm" /> {words.work.inProject(props.project.name)}
    </span>
  );
}

function More(props: {
  readonly page: DecisionsPage;
  readonly label: string;
  readonly busy?: boolean | undefined;
}) {
  const { page } = props;
  if (page.more !== true || page.onMore === undefined) {
    return null;
  }
  return (
    <div className="sc-paged-more">
      <Button variant="secondary" size="sm" disabled={props.busy} onClick={page.onMore}>
        {props.label}
      </Button>
    </div>
  );
}

export function MyDecisions(props: MyDecisionsProps) {
  const words = useWords();
  const own = words.myDecisions;
  const { onAnswer } = props;
  const waiting = props.addressed.items.filter(({ decision }) => decision.answer === null);
  const asked = props.raised.items.filter(({ decision }) => decision.answer === null);
  const record = [...props.addressed.items, ...props.raised.items]
    .filter(({ decision }) => decision.answer !== null)
    .sort((a, b) => (b.decision.answer?.at ?? "").localeCompare(a.decision.answer?.at ?? ""));
  const projectOf = new Map(record.map((item) => [item.decision.id, item.project]));
  const card = (item: Item, answerable: boolean): ReactNode => (
    <DecisionCard
      key={item.decision.id}
      decision={item.decision}
      href={props.decisionHref(item.project.key, item.decision.id)}
      project={<InProject project={item.project} />}
      onAnswer={
        answerable && onAnswer !== undefined
          ? (decision, input) => onAnswer(item.project.key, decision, input)
          : undefined
      }
      busy={props.busy}
    />
  );
  return (
    <div className="sc-decisions">
      <div className="sc-decisions-waiting">
        <section aria-label={own.waiting}>
          <h2 className="sc-section-title">
            {own.waiting} <span className="sc-column-count">{waiting.length}</span>
          </h2>
          {waiting.length === 0 ? (
            <p className="sc-muted">{own.noneWaiting}</p>
          ) : (
            waiting.map((item) => card(item, true))
          )}
          <More page={props.addressed} label={own.more} busy={props.busy} />
        </section>
        <section aria-label={own.raised}>
          <h2 className="sc-section-title">
            {own.raised} <span className="sc-column-count">{asked.length}</span>
          </h2>
          {asked.length === 0 ? (
            <p className="sc-muted">{own.noneRaised}</p>
          ) : (
            asked.map((item) => card(item, false))
          )}
          <More page={props.raised} label={own.more} busy={props.busy} />
        </section>
      </div>
      <section aria-label={words.decisions.record}>
        <h2 className="sc-section-title">
          {words.decisions.record} <span className="sc-column-count">{record.length}</span>
        </h2>
        {record.length === 0 ? (
          <p className="sc-muted">{own.noneAnswered}</p>
        ) : (
          <DecisionLog
            decisions={record.map((item) => item.decision)}
            decisionHref={(decision) =>
              props.decisionHref(projectOf.get(decision.id)?.key ?? "", decision.id)
            }
            projectOf={(decision) => {
              const project = projectOf.get(decision.id);
              return project === undefined ? undefined : <InProject project={project} />;
            }}
          />
        )}
      </section>
    </div>
  );
}
