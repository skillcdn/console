import { type ClipboardEvent, type FormEvent, type ReactNode, useState } from "react";
import {
  agentLabel,
  MAX_BODY_LENGTH,
  MAX_FILES_PER_COMMENT,
  type RestComment,
  type RestCommentFile,
  type RestDecision,
  type RestRun,
  type RestTask,
} from "../api.js";
import { useWords } from "../i18n/index.js";
import { DecisionCard, type DecisionCardProps } from "./decision-list.js";
import { isPicture, namedFile, placed, placing, unusedName } from "./files.js";
import { Markdown } from "./markdown.js";
import { Lightbox, PictureThumb, usePicture } from "./pictures.js";
import { RunCard } from "./runs.js";
import { Button, formatBytes, PersonChip, personName, Time } from "./ui.js";

// The discussion on a task (ADR-0024): what people and agents said about it, each word with
// the files put in it, read in one thread with the runs on the task and the decisions about
// it, in the order they came. A picture is a thumbnail that opens large over the page. Takes
// its data as props and nothing from the network.

export interface CommentCardProps {
  readonly comment: RestComment;
  /** Where a file put in the comment is read: the project's address for it. Left out, a file is named and not linked. */
  readonly fileHref?: ((file: RestCommentFile) => string) | undefined;
  /** Where a document of the project is read, by its path, for the links in what was written. */
  readonly docHref?: ((path: string) => string) | undefined;
}

export function CommentCard(props: CommentCardProps) {
  const words = useWords();
  const { comment } = props;
  const pictures = usePicture();
  const hrefOf = (file: RestCommentFile) => props.fileHref?.(file);
  // A picture the text names by its file name is shown where the text puts it; the rest of
  // the files follow the text, pictures in place and everything else as a link.
  const named = (source: string): string | undefined => {
    const name = namedFile(source);
    const file = comment.files.find(
      (candidate) => candidate.file.name === name && isPicture(candidate.file.contentType),
    );
    return file === undefined ? undefined : hrefOf(file);
  };
  const following = comment.files.filter((file) => !placed(comment.body, file.file.name));
  return (
    <article
      className="sc-comment"
      aria-label={words.comments.label(personName(comment.author))}
      id={comment.id}
    >
      <header className="sc-comment-header">
        <PersonChip person={comment.author} />
        {comment.agent !== null && (
          <span className="sc-feed-agent" title={comment.agent}>
            {words.feed.as(agentLabel(comment.agent))}
          </span>
        )}
        <span className="sc-comment-meta">
          <Time iso={comment.createdAt} />
        </span>
      </header>
      {comment.body.trim().length > 0 && (
        <Markdown
          source={comment.body}
          docHref={props.docHref}
          fileSrc={named}
          onOpenPicture={pictures.open}
        />
      )}
      {following.length > 0 && (
        <ul className="sc-comment-files" aria-label={words.comments.files}>
          {following.map((attached) => {
            const href = hrefOf(attached);
            const { file } = attached;
            if (href !== undefined && isPicture(file.contentType)) {
              return (
                <li key={attached.id} className="sc-comment-picture">
                  <PictureThumb
                    picture={{
                      src: href,
                      alt: words.comments.picture(file.name),
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
      )}
      <Lightbox picture={pictures.shown} onClose={pictures.close} />
    </article>
  );
}

/** What a comment form hands over: the word, and the files chosen or pasted. */
export interface CommentDraft {
  readonly body: string;
  readonly files: readonly File[];
}

export interface CommentFormProps {
  readonly onSubmit: (draft: CommentDraft) => void;
  readonly busy?: boolean | undefined;
}

export function CommentForm(props: CommentFormProps) {
  const words = useWords().comments;
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const empty = body.trim().length === 0 && files.length === 0;

  const add = (chosen: readonly File[]): File[] => {
    const added: File[] = [];
    let held = files;
    for (const file of chosen) {
      if (held.length >= MAX_FILES_PER_COMMENT) {
        break;
      }
      const name = unusedName(
        file.name,
        held.map((kept) => kept.name),
      );
      const kept = name === file.name ? file : new File([file], name, { type: file.type });
      held = [...held, kept];
      added.push(kept);
    }
    setFiles(held);
    return added;
  };

  // A picture pasted in goes with the comment, placed in the text where pictures are read.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].filter((file) => isPicture(file.type));
    if (pasted.length === 0) {
      return;
    }
    event.preventDefault();
    const added = add(pasted);
    if (added.length > 0) {
      setBody((current) =>
        placing(
          current,
          added.map((file) => file.name),
        ),
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (empty || props.busy === true) {
      return;
    }
    props.onSubmit({ body, files });
    setBody("");
    setFiles([]);
  };

  return (
    <form className="sc-comment-form" aria-label={words.write} onSubmit={submit}>
      <textarea
        className="sc-input sc-textarea"
        aria-label={words.write}
        placeholder={words.placeholder}
        maxLength={MAX_BODY_LENGTH}
        rows={4}
        value={body}
        disabled={props.busy === true}
        onChange={(event) => setBody(event.target.value)}
        onPaste={paste}
      />
      {files.length > 0 && (
        <ul className="sc-comment-chosen" aria-label={words.files}>
          {files.map((file) => (
            <li key={file.name} className="sc-comment-chosen-file">
              <span>{file.name}</span> <span className="sc-muted">{formatBytes(file.size)}</span>{" "}
              <Button
                variant="ghost"
                size="sm"
                aria-label={words.removeFile(file.name)}
                onClick={() => setFiles((current) => current.filter((held) => held !== file))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-comment-form-actions">
        <label className="sc-button sc-button-ghost sc-button-sm">
          {words.chooseFiles}
          <input
            className="sc-comment-file-input"
            type="file"
            multiple
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={empty || props.busy === true}>
          {words.one}
        </Button>
      </div>
      <p className="sc-field-hint">{words.hint}</p>
    </form>
  );
}

/** One thing said or done about a task, with when, for the thread's order. */
export type ThreadItem =
  | { readonly kind: "comment"; readonly at: string; readonly comment: RestComment }
  | { readonly kind: "run"; readonly at: string; readonly run: RestRun }
  | { readonly kind: "decision"; readonly at: string; readonly decision: RestDecision };

/** The comments, the runs and the decisions of a task as one thread, in the order they came. */
export function threadOf(
  comments: readonly RestComment[],
  runs: readonly RestRun[],
  decisions: readonly RestDecision[],
): ThreadItem[] {
  const items: ThreadItem[] = [
    ...comments.map((comment) => ({ kind: "comment" as const, at: comment.createdAt, comment })),
    ...runs.map((run) => ({ kind: "run" as const, at: run.startedAt, run })),
    ...decisions.map((decision) => ({
      kind: "decision" as const,
      at: decision.createdAt,
      decision,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export interface TaskThreadProps {
  readonly task: RestTask;
  readonly comments: readonly RestComment[];
  readonly runs: readonly RestRun[];
  readonly decisions: readonly RestDecision[];
  /** Where a file of the project is read, by its id: a run's as a comment's. */
  readonly fileHref?: ((fileId: string) => string) | undefined;
  /** Where a decision is answered, for a run that waits for one. */
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  readonly docHref?: ((path: string) => string) | undefined;
  readonly onAnswer?: DecisionCardProps["onAnswer"];
  readonly onUpdateDecision?: DecisionCardProps["onUpdate"];
  readonly onAbandonRun?: ((run: RestRun) => void) | undefined;
  /** Called with what was written; left out, nothing can be said here. */
  readonly onComment?: ((draft: CommentDraft) => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly empty?: ReactNode;
}

export function TaskThread(props: TaskThreadProps) {
  const items = threadOf(props.comments, props.runs, props.decisions);
  const fileHref = props.fileHref;
  const shown = (item: ThreadItem): ReactNode => {
    if (item.kind === "comment") {
      return (
        <CommentCard
          key={item.comment.id}
          comment={item.comment}
          fileHref={fileHref === undefined ? undefined : (file) => fileHref(file.id)}
          docHref={props.docHref}
        />
      );
    }
    if (item.kind === "run") {
      return (
        <RunCard
          key={item.run.id}
          run={item.run}
          decisionHref={props.decisionHref}
          fileHref={fileHref === undefined ? undefined : (artifact) => fileHref(artifact.id)}
          docHref={props.docHref}
          onAbandon={props.onAbandonRun}
          busy={props.busy}
        />
      );
    }
    return (
      <DecisionCard
        key={item.decision.id}
        decision={item.decision}
        task={props.task}
        docHref={props.docHref}
        onAnswer={props.onAnswer}
        onUpdate={props.onUpdateDecision}
        busy={props.busy}
      />
    );
  };
  return (
    <div className="sc-thread">
      {items.length === 0 && props.empty}
      {items.map(shown)}
      {props.onComment !== undefined && (
        <CommentForm onSubmit={props.onComment} busy={props.busy} />
      )}
    </div>
  );
}
