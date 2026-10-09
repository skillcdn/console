import type { ReactNode } from "react";
import type { RestArtifact, RestRun, RunStatus } from "../api.js";
import { Markdown } from "./markdown.js";
import { Badge, Button, formatBytes, PersonChip, Time } from "./ui.js";

// A run: one agent at work on one task for one person, with what it reported, what it handed
// in, and what it waits for. Takes its data as props and nothing from the network.

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  running: "At work",
  waiting: "Waiting for a decision",
  finished: "Finished",
  failed: "Failed",
  abandoned: "Abandoned",
};

export function RunStatusBadge(props: { readonly status: RunStatus }) {
  const tone =
    props.status === "running"
      ? "accent"
      : props.status === "waiting"
        ? "warning"
        : props.status === "finished"
          ? "success"
          : props.status === "failed"
            ? "danger"
            : "neutral";
  return <Badge tone={tone}>{RUN_STATUS_LABELS[props.status]}</Badge>;
}

export interface RunCardProps {
  readonly run: RestRun;
  /** Where the decision the run waits for is answered, when the page knows. */
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  /** Where a file handed in is read: the project's path for it. Left out, a file is named and not linked. */
  readonly fileHref?: ((artifact: RestArtifact) => string) | undefined;
  /** Called to mark a run that will not come back as abandoned. Left out, it cannot be here. */
  readonly onAbandon?: ((run: RestRun) => void) | undefined;
  readonly busy?: boolean | undefined;
}

export function RunCard(props: RunCardProps) {
  const { run } = props;
  const open = run.status === "running" || run.status === "waiting";
  return (
    <article className="sc-run" aria-label={`${run.agent} for ${run.person.login}`}>
      <header className="sc-run-header">
        <span className="sc-run-agent">{run.agent}</span>
        <RunStatusBadge status={run.status} />
        <span className="sc-run-meta">
          for <PersonChip person={run.person} /> since <Time iso={run.startedAt} />
          {run.endedAt !== null && (
            <>
              {" "}
              until <Time iso={run.endedAt} />
            </>
          )}
        </span>
        {open && props.onAbandon !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            disabled={props.busy === true}
            onClick={() => props.onAbandon?.(run)}
          >
            Mark abandoned
          </Button>
        )}
      </header>
      {run.waitingFor !== null && (
        <p className="sc-run-waiting">
          Waiting for a decision
          {props.decisionHref !== undefined && (
            <>
              : <a href={props.decisionHref(run.waitingFor)}>answer it</a>
            </>
          )}
          .
        </p>
      )}
      {run.reports.length > 0 && (
        <ol className="sc-run-reports" aria-label="Reports">
          {run.reports.map((report) => (
            <li key={report.id} className="sc-report">
              <Time iso={report.createdAt} />
              <Markdown source={report.body} />
            </li>
          ))}
        </ol>
      )}
      {run.artifacts.length > 0 && (
        <ul className="sc-link-list" aria-label="Handed in">
          {run.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <ArtifactLink artifact={artifact} fileHref={props.fileHref} />
            </li>
          ))}
        </ul>
      )}
      {run.summary !== null && (
        <div className="sc-run-summary">
          <Markdown source={run.summary} />
        </div>
      )}
    </article>
  );
}

/** A link as it was handed in; a file by its name, with its size, read from the console. */
function ArtifactLink(props: {
  readonly artifact: RestArtifact;
  readonly fileHref: ((artifact: RestArtifact) => string) | undefined;
}) {
  const { artifact } = props;
  if (artifact.file === null) {
    return (
      <a href={artifact.url ?? ""} target="_blank" rel="noopener noreferrer nofollow ugc">
        {artifact.label ?? artifact.url}
      </a>
    );
  }
  const href = props.fileHref?.(artifact);
  return (
    <>
      {href === undefined ? (
        <span>{artifact.label ?? artifact.file.name}</span>
      ) : (
        <a href={href} rel="nofollow ugc">
          {artifact.label ?? artifact.file.name}
        </a>
      )}{" "}
      <span className="sc-muted">
        {artifact.label === null ? "" : `${artifact.file.name}, `}
        {formatBytes(artifact.file.size)}
      </span>
    </>
  );
}

export interface RunListProps {
  readonly runs: readonly RestRun[];
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  readonly fileHref?: ((artifact: RestArtifact) => string) | undefined;
  readonly onAbandon?: ((run: RestRun) => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

export function RunList(props: RunListProps) {
  if (props.runs.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <div className="sc-runs">
      {props.runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          decisionHref={props.decisionHref}
          fileHref={props.fileHref}
          onAbandon={props.onAbandon}
          busy={props.busy}
        />
      ))}
    </div>
  );
}
