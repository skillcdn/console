import type { ReactNode } from "react";
import { agentLabel, type RestArtifact, type RestRun, type RunStatus } from "../api.js";
import { useWords } from "../i18n/index.js";
import { isPicture, namedFile } from "./files.js";
import { Markdown } from "./markdown.js";
import { Lightbox, type Picture, PictureThumb, usePicture } from "./pictures.js";
import { Badge, Button, formatBytes, PersonChip, personName, Time } from "./ui.js";

// A run: one agent at work on one task for one person, with what it reported, what it handed
// in, and what it waits for. A picture handed in is seen small where it is listed and large
// over the page, as a picture in a comment is, and a report that names it by its file name
// shows it where the words are. Takes its data as props and nothing from the network.

/** The words of a run's status in English: the default pack's. */
export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  running: "Open",
  waiting: "Waiting for a decision",
  finished: "Finished",
  failed: "Failed",
  abandoned: "Abandoned",
};

export function RunStatusBadge(props: { readonly status: RunStatus }) {
  const words = useWords();
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
  return <Badge tone={tone}>{words.vocabulary.runStatus[props.status]}</Badge>;
}

export interface RunCardProps {
  readonly run: RestRun;
  /** Where the decision the run waits for is answered, when the page knows. */
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  /** Where a file handed in is read: the project's path for it. Left out, a file is named and not linked. */
  readonly fileHref?: ((artifact: RestArtifact) => string) | undefined;
  /** Where a document of the project is read, by its path, for the links in what the agent wrote. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** Called to mark a run that will not come back as abandoned. Left out, it cannot be here. */
  readonly onAbandon?: ((run: RestRun) => void) | undefined;
  readonly busy?: boolean | undefined;
}

export function RunCard(props: RunCardProps) {
  const words = useWords().runs;
  const { run } = props;
  const open = run.status === "running" || run.status === "waiting";
  const pictures = usePicture();
  const hrefOf = (artifact: RestArtifact) => props.fileHref?.(artifact);
  // A report that names a picture handed in, by its file name, shows it where the words are.
  const named = (source: string): string | undefined => {
    const name = namedFile(source);
    const artifact = run.artifacts.find(
      (candidate) =>
        candidate.file !== null &&
        candidate.file.name === name &&
        isPicture(candidate.file.contentType),
    );
    return artifact === undefined ? undefined : hrefOf(artifact);
  };
  return (
    <article className="sc-run" aria-label={words.label(run.agent, personName(run.person))}>
      <header className="sc-run-header">
        <span className="sc-run-agent" title={run.agent}>
          {agentLabel(run.agent)}
        </span>
        <RunStatusBadge status={run.status} />
        <span className="sc-run-meta">
          {words.for} <PersonChip person={run.person} /> {words.since} <Time iso={run.startedAt} />
          {run.endedAt !== null && (
            <>
              {" "}
              {words.until} <Time iso={run.endedAt} />
            </>
          )}
          {open && (
            <>
              {" "}
              · {words.lastHeard} <Time iso={run.lastHeardAt} />
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
            {words.markAbandoned}
          </Button>
        )}
      </header>
      {run.waitingFor !== null && (
        <p className="sc-run-waiting">
          {words.waitingForDecision}
          {props.decisionHref !== undefined && (
            <>
              : <a href={props.decisionHref(run.waitingFor)}>{words.answerIt}</a>
            </>
          )}
          .
        </p>
      )}
      {run.reports.length > 0 && (
        <ol className="sc-run-reports" aria-label={words.reports}>
          {run.reports.map((report) => (
            <li key={report.id} className="sc-report">
              <Time iso={report.createdAt} />
              <Markdown
                source={report.body}
                docHref={props.docHref}
                fileSrc={named}
                onOpenPicture={pictures.open}
              />
            </li>
          ))}
        </ol>
      )}
      {run.artifacts.length > 0 && (
        <ul className="sc-link-list" aria-label={words.handedIn}>
          {run.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <ArtifactItem
                artifact={artifact}
                href={hrefOf(artifact)}
                onOpenPicture={pictures.open}
              />
            </li>
          ))}
        </ul>
      )}
      {run.summary !== null && (
        <div className="sc-run-summary">
          <Markdown
            source={run.summary}
            docHref={props.docHref}
            fileSrc={named}
            onOpenPicture={pictures.open}
          />
        </div>
      )}
      <Lightbox picture={pictures.shown} onClose={pictures.close} />
    </article>
  );
}

/**
 * What was handed in: a link as it was given; a file by its name, with its size, read from the
 * console; a picture seen small, and large when pressed.
 */
function ArtifactItem(props: {
  readonly artifact: RestArtifact;
  readonly href: string | undefined;
  readonly onOpenPicture: (picture: Picture, opener: HTMLElement) => void;
}) {
  const words = useWords().runs;
  const { artifact, href } = props;
  if (artifact.file === null) {
    return (
      <a href={artifact.url ?? ""} target="_blank" rel="noopener noreferrer nofollow ugc">
        {artifact.label ?? artifact.url}
      </a>
    );
  }
  const { file } = artifact;
  const about = (
    <span className="sc-muted">
      {artifact.label === null ? "" : `${file.name}, `}
      {formatBytes(file.size)}
    </span>
  );
  if (href !== undefined && isPicture(file.contentType)) {
    return (
      <div className="sc-artifact-picture">
        <PictureThumb
          picture={{
            src: href,
            alt: artifact.label ?? words.picture(file.name),
            name: file.name,
            size: file.size,
          }}
          onOpen={props.onOpenPicture}
        />
        <span>
          {artifact.label ?? file.name} {about}
        </span>
      </div>
    );
  }
  return (
    <>
      {href === undefined ? (
        <span>{artifact.label ?? file.name}</span>
      ) : (
        <a href={href} rel="nofollow ugc">
          {artifact.label ?? file.name}
        </a>
      )}{" "}
      {about}
    </>
  );
}

export interface RunListProps {
  readonly runs: readonly RestRun[];
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  readonly fileHref?: ((artifact: RestArtifact) => string) | undefined;
  readonly docHref?: ((path: string) => string) | undefined;
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
          docHref={props.docHref}
          onAbandon={props.onAbandon}
          busy={props.busy}
        />
      ))}
    </div>
  );
}
