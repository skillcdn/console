import type { RestMyDecisions } from "../api.js";
import { useWords } from "../i18n/index.js";
import { ProjectMark } from "./projects.js";
import { Button, PersonChip, Time } from "./ui.js";

// The decisions addressed to a person (ADR-0042), across the projects they may see: the ones
// that wait for their answer first, then the answered as the record, each leading to its own
// page in its project, where it is answered and its record grows. Takes its data as props and
// nothing from the network; the page reads more when asked.

export interface MyDecisionsProps {
  readonly items: RestMyDecisions["items"];
  /** Whether there is more after what is shown; `onMore` reads it. */
  readonly more?: boolean | undefined;
  readonly onMore?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly decisionHref: (projectKey: string, decisionId: string) => string;
}

export function MyDecisions(props: MyDecisionsProps) {
  const words = useWords();
  const own = words.myDecisions;
  const waiting = props.items.filter(({ decision }) => decision.answer === null);
  const answered = props.items.filter(({ decision }) => decision.answer !== null);
  const rows = (items: RestMyDecisions["items"]) => (
    <ol className="sc-decision-log">
      {items.map(({ project, decision }) => {
        const chosen = decision.options.find((option) => option.id === decision.answer?.option);
        return (
          <li key={decision.id} className="sc-decision-row">
            <a
              className="sc-decision-row-question"
              href={props.decisionHref(project.key, decision.id)}
            >
              {decision.question}
            </a>
            <span className="sc-task-row-project">
              <ProjectMark project={project} size="sm" /> {words.work.inProject(project.name)}
            </span>
            <span className="sc-decision-row-meta">
              {decision.answer === null ? (
                <>
                  <PersonChip person={decision.raisedBy} /> <Time iso={decision.createdAt} />
                </>
              ) : (
                <>
                  <span>{chosen?.label ?? decision.answer.option}</span>{" "}
                  <Time iso={decision.answer.at} />
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
  return (
    <div className="sc-work-lists">
      <section className="sc-task-section" aria-label={own.waiting}>
        <h2 className="sc-section-title">
          {own.waiting} <span className="sc-column-count">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? <p className="sc-muted">{own.noneWaiting}</p> : rows(waiting)}
      </section>
      {answered.length > 0 && (
        <section className="sc-task-section" aria-label={own.answered}>
          <h2 className="sc-section-title">
            {own.answered} <span className="sc-column-count">{answered.length}</span>
          </h2>
          {rows(answered)}
        </section>
      )}
      {props.more === true && props.onMore !== undefined && (
        <div className="sc-paged-more">
          <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onMore}>
            {own.more}
          </Button>
        </div>
      )}
    </div>
  );
}
