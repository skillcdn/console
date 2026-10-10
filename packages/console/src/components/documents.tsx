import { type FormEvent, type ReactNode, useState } from "react";
import {
  foldersAbove,
  isDocumentPath,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_SEARCH_LENGTH,
  MAX_TITLE_LENGTH,
  nameOf,
  type RestBacklink,
  type RestDocument,
  type RestDocumentFile,
  type RestDocumentSummary,
  type RestDocuments,
  type RestVersion,
  type RestVersionSummary,
} from "../api.js";
import { Markdown } from "./markdown.js";
import { Badge, Button, cx, formatBytes, PersonChip, Time } from "./ui.js";

// The documents of a project (ADR-0009): a folder with its pages and its folders, the way to
// find pages by their words, one page with its versions, what it links to, what refers to it
// and its files, and the forms to write and attach. Each takes its data as props and nothing
// from the network; what people and agents wrote is text or Markdown rendered to elements.

/** The folder a path is in, as crumbs from the root: the root, then each folder above, then the name. */
export function DocumentCrumbs(props: {
  readonly path: string;
  readonly folderHref: (folder: string) => string;
  /** The last crumb is a link too, when the page is on something below it. */
  readonly last?: boolean | undefined;
}) {
  const folders = props.path === "" ? [] : foldersAbove(props.path);
  const name = props.path === "" ? undefined : nameOf(props.path);
  return (
    <nav className="sc-doc-crumbs" aria-label="Folders">
      <a href={props.folderHref("")}>Docs</a>
      {folders.map((folder) => (
        <span key={folder}>
          <span className="sc-crumb-separator" aria-hidden="true">
            /
          </span>
          <a href={props.folderHref(folder)}>{nameOf(folder)}</a>
        </span>
      ))}
      {name !== undefined && (
        <span>
          <span className="sc-crumb-separator" aria-hidden="true">
            /
          </span>
          {props.last === true ? <a href={props.folderHref(props.path)}>{name}</a> : name}
        </span>
      )}
    </nav>
  );
}

/** Who wrote a version, and through which agent, as a chip and a word. */
function Writer(props: {
  readonly by: RestDocumentSummary["updatedBy"];
  readonly agent: string | null;
}) {
  return (
    <>
      <PersonChip person={props.by} />
      {props.agent !== null && (
        <span className="sc-feed-agent" title="The agent the person wrote it through">
          as {props.agent}
        </span>
      )}
    </>
  );
}

export interface DocumentListProps {
  /** The pages, in the order the server gave them: by title in a folder, the best first in a search. */
  readonly items: readonly RestDocumentSummary[];
  readonly docHref: (path: string) => string;
  readonly empty?: ReactNode;
}

/** The pages of a folder, or found by a search: each with its title, its path, and who wrote it last. */
export function DocumentList(props: DocumentListProps) {
  if (props.items.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  return (
    <ul className="sc-docs" aria-label="Pages">
      {props.items.map((document) => (
        <li key={document.id} className="sc-doc-row">
          <a className="sc-doc-title" href={props.docHref(document.path)}>
            {document.title}
          </a>
          {document.archivedAt !== null && <Badge tone="neutral">Archived</Badge>}
          <span className="sc-doc-meta">
            <code className="sc-doc-path">{document.path}</code> · v{document.version} ·{" "}
            <Writer by={document.updatedBy} agent={document.agent} />{" "}
            <Time iso={document.updatedAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface FolderViewProps {
  /** The folder as the server listed it. */
  readonly listing: RestDocuments;
  readonly docHref: (path: string) => string;
  readonly folderHref: (folder: string) => string;
  readonly empty?: ReactNode;
}

/** A folder: its folders, then its pages. */
export function FolderView(props: FolderViewProps) {
  const { listing } = props;
  return (
    <div className="sc-folder">
      {listing.folders.length > 0 && (
        <ul className="sc-folders" aria-label="Folders">
          {listing.folders.map((folder) => (
            <li key={folder}>
              <a className="sc-folder-link" href={props.folderHref(folder)}>
                {nameOf(folder)}/
              </a>
            </li>
          ))}
        </ul>
      )}
      <DocumentList
        items={listing.items}
        docHref={props.docHref}
        empty={listing.folders.length === 0 ? props.empty : undefined}
      />
    </div>
  );
}

export interface DocumentSearchProps {
  /** The words searched for now, if any. */
  readonly query?: string | undefined;
  readonly busy?: boolean | undefined;
  readonly onSearch: (query: string) => void;
}

/** The way to find pages by their words. An empty search goes back to the folders. */
export function DocumentSearch(props: DocumentSearchProps) {
  const [query, setQuery] = useState(props.query ?? "");
  return (
    <form
      className="sc-doc-search"
      aria-label="Find pages"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSearch(query.trim());
      }}
    >
      <input
        className="sc-input"
        type="search"
        placeholder="Find pages by their words"
        aria-label="Find pages"
        maxLength={MAX_SEARCH_LENGTH}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={props.busy === true}>
        Find
      </Button>
    </form>
  );
}

export interface DocumentFormProps {
  /** The document to write a new version of; left out, a new page is written. */
  readonly document?: RestDocument | undefined;
  /** The folder a new page goes in, as the path's first part. */
  readonly folder?: string | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: {
    readonly path: string;
    readonly title: string;
    readonly body: string;
    readonly baseVersion?: number | undefined;
  }) => void;
  readonly onCancel?: (() => void) | undefined;
}

/** Writing a page: its path (once), its title, and its body in Markdown. */
export function DocumentForm(props: DocumentFormProps) {
  const existing = props.document;
  const [path, setPath] = useState(
    existing?.path ?? (props.folder === undefined || props.folder === "" ? "" : `${props.folder}/`),
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const ready = title.trim().length > 0 && (existing !== undefined || isDocumentPath(path));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    props.onSubmit({
      path: existing?.path ?? path,
      title: title.trim(),
      body,
      ...(existing === undefined ? {} : { baseVersion: existing.version }),
    });
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">Path</span>
        <input
          className="sc-input"
          value={path}
          maxLength={MAX_DOCUMENT_PATH_LENGTH}
          required
          disabled={existing !== undefined}
          placeholder="guides/onboarding"
          onChange={(event) => setPath(event.target.value.trim().toLowerCase())}
        />
        {existing === undefined && (
          <span className="sc-muted">
            Lowercase letters, digits and hyphens, with slashes between folders. It does not change
            once written.
          </span>
        )}
      </label>
      <label className="sc-field">
        <span className="sc-field-label">Title</span>
        <input
          className="sc-input"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="sc-field">
        <span className="sc-field-label">Body</span>
        <textarea
          className="sc-input sc-textarea sc-doc-editor"
          value={body}
          maxLength={MAX_DOCUMENT_LENGTH}
          rows={16}
          placeholder="Markdown. A link to another page's path, such as guides/onboarding, refers to that page."
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy === true || !ready}>
          {existing === undefined ? "Write the page" : "Write a new version"}
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

/** What refers to a page, each by what people call it, linked where the page knows where. */
function BacklinkItem(props: {
  readonly backlink: RestBacklink;
  readonly docHref: (path: string) => string;
  readonly taskHref?: ((backlink: RestBacklink) => string) | undefined;
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
}) {
  const { backlink } = props;
  if (backlink.kind === "document") {
    return (
      <a href={props.docHref(backlink.path ?? "")}>
        {backlink.title} <code className="sc-doc-path">{backlink.path}</code>
      </a>
    );
  }
  if (backlink.kind === "task") {
    const words = (
      <>
        <span className="sc-card-number">#{backlink.number}</span> {backlink.title}
      </>
    );
    return props.taskHref === undefined ? (
      <span>{words}</span>
    ) : (
      <a href={props.taskHref(backlink)}>{words}</a>
    );
  }
  const words = <>Decision: {backlink.title}</>;
  return props.decisionHref === undefined ? (
    <span>{words}</span>
  ) : (
    <a href={props.decisionHref(backlink.id)}>{words}</a>
  );
}

export interface DocumentFilesProps {
  readonly files: readonly RestDocumentFile[];
  /** Where a file's bytes are read, by its id. */
  readonly fileHref: (file: RestDocumentFile) => string;
  /** Called with a file to attach; left out, nothing can be attached here. */
  readonly onAttach?: ((file: File, label: string | undefined) => void) | undefined;
  readonly busy?: boolean | undefined;
}

/** The files attached to a page, and the way to attach one. */
export function DocumentFiles(props: DocumentFilesProps) {
  const [label, setLabel] = useState("");
  const [chosen, setChosen] = useState<File | undefined>(undefined);
  return (
    <section className="sc-task-section" aria-label="Files">
      <h2 className="sc-section-title">Files</h2>
      {props.files.length > 0 && (
        <ul className="sc-link-list">
          {props.files.map((attached) => (
            <li key={attached.id}>
              <a href={props.fileHref(attached)} rel="nofollow ugc">
                {attached.label ?? attached.file.name}
              </a>{" "}
              <span className="sc-muted">
                {attached.label === null ? "" : `${attached.file.name}, `}
                {formatBytes(attached.file.size)}, by{" "}
              </span>
              <Writer by={attached.addedBy} agent={attached.agent} />{" "}
              <Time iso={attached.createdAt} />
            </li>
          ))}
        </ul>
      )}
      {props.onAttach !== undefined && (
        <form
          className="sc-doc-attach"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen !== undefined) {
              props.onAttach?.(chosen, label.trim() === "" ? undefined : label.trim());
              setChosen(undefined);
              setLabel("");
            }
          }}
        >
          <input
            className="sc-input"
            type="file"
            aria-label="A file to attach"
            onChange={(event) => setChosen(event.target.files?.[0] ?? undefined)}
          />
          <input
            className="sc-input"
            placeholder="What to call it, if not its name"
            maxLength={MAX_LINK_LABEL_LENGTH}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={chosen === undefined || props.busy === true}>
            Attach
          </Button>
        </form>
      )}
    </section>
  );
}

export interface DocumentViewProps {
  readonly document: RestDocument;
  /** An earlier version shown in place of the latest, when a person asked for one. */
  readonly version?: RestVersion | undefined;
  /** The versions, newest first, when the page has read them. */
  readonly versions?: readonly RestVersionSummary[] | undefined;
  readonly docHref: (path: string) => string;
  readonly folderHref: (folder: string) => string;
  readonly fileHref: (file: RestDocumentFile) => string;
  /** Where a task that refers to the page is read. */
  readonly taskHref?: ((backlink: RestBacklink) => string) | undefined;
  readonly decisionHref?: ((decisionId: string) => string) | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  /** Where the page is edited; left out where the person may not, or the page is archived. */
  readonly editHref?: string | undefined;
  /** Where a version of the page is read, by its number, or the latest again with nothing. */
  readonly versionHref?: ((number: number | undefined) => string) | undefined;
  /** The ways to change the page; each left out where the person may not. */
  readonly onArchive?: (() => void) | undefined;
  readonly onRestore?: (() => void) | undefined;
  readonly onAttach?: ((file: File, label: string | undefined) => void) | undefined;
}

/** One page: its latest version or an earlier one, its links both ways, its files, its versions. */
export function DocumentView(props: DocumentViewProps) {
  const { document, version } = props;
  const archived = document.archivedAt !== null;
  const shown = version ?? {
    number: document.version,
    title: document.title,
    body: document.body,
    author: document.updatedBy,
    agent: document.agent,
    createdAt: document.updatedAt,
  };
  return (
    <article className={cx("sc-doc", archived && "sc-doc-archived")}>
      <DocumentCrumbs path={document.path} folderHref={props.folderHref} />
      <header className="sc-task-header">
        <h1 className="sc-task-title">{shown.title}</h1>
        <div className="sc-task-badges">
          {archived && <Badge tone="neutral">Archived</Badge>}
          {version !== undefined && version.number !== document.version && (
            <Badge tone="warning">
              Version {version.number} of {document.version}
            </Badge>
          )}
        </div>
      </header>
      <p className="sc-doc-meta">
        <code className="sc-doc-path">{document.path}</code> · version {shown.number}, written by{" "}
        <Writer by={shown.author} agent={shown.agent} /> <Time iso={shown.createdAt} />
        {version !== undefined && props.versionHref !== undefined && (
          <>
            {" "}
            · <a href={props.versionHref(undefined)}>Show the latest</a>
          </>
        )}
      </p>
      {archived && (
        <p className="sc-doc-notice">
          This page is archived: out of the folders and the search, and not written to.
        </p>
      )}
      {(props.editHref !== undefined ||
        props.onArchive !== undefined ||
        props.onRestore !== undefined) && (
        <div className="sc-task-actions">
          {!archived && props.editHref !== undefined && (
            <a className="sc-button sc-button-secondary" href={props.editHref}>
              Edit
            </a>
          )}
          {!archived && props.onArchive !== undefined && (
            <Button variant="ghost" onClick={props.onArchive} disabled={props.busy === true}>
              Archive
            </Button>
          )}
          {archived && props.onRestore !== undefined && (
            <Button onClick={props.onRestore} disabled={props.busy === true}>
              Restore
            </Button>
          )}
        </div>
      )}
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      {shown.body.trim().length > 0 ? (
        <Markdown source={shown.body} docHref={props.docHref} />
      ) : (
        <p className="sc-muted">Nothing is written on this page yet.</p>
      )}
      {document.links.length > 0 && (
        <section className="sc-task-section" aria-label="Refers to">
          <h2 className="sc-section-title">Refers to</h2>
          <ul className="sc-link-list">
            {document.links.map((link) => (
              <li key={link.path}>
                <a href={props.docHref(link.path)}>{link.title ?? link.path}</a>{" "}
                {link.title === null ? (
                  <span className="sc-muted">no page there yet</span>
                ) : (
                  <code className="sc-doc-path">{link.path}</code>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {document.backlinks.length > 0 && (
        <section className="sc-task-section" aria-label="Referred to by">
          <h2 className="sc-section-title">Referred to by</h2>
          <ul className="sc-link-list">
            {document.backlinks.map((backlink) => (
              <li key={`${backlink.kind}-${backlink.id}`}>
                <BacklinkItem
                  backlink={backlink}
                  docHref={props.docHref}
                  taskHref={props.taskHref}
                  decisionHref={props.decisionHref}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(document.files.length > 0 || (!archived && props.onAttach !== undefined)) && (
        <DocumentFiles
          files={document.files}
          fileHref={props.fileHref}
          onAttach={archived ? undefined : props.onAttach}
          busy={props.busy}
        />
      )}
      {props.versions !== undefined && props.versions.length > 0 && (
        <section className="sc-task-section" aria-label="Versions">
          <h2 className="sc-section-title">Versions</h2>
          <ol className="sc-versions">
            {props.versions.map((entry) => (
              <li key={entry.number} className="sc-version">
                {props.versionHref === undefined || entry.number === shown.number ? (
                  <span className="sc-version-number">v{entry.number}</span>
                ) : (
                  <a
                    className="sc-version-number"
                    href={props.versionHref(
                      entry.number === document.version ? undefined : entry.number,
                    )}
                  >
                    v{entry.number}
                  </a>
                )}{" "}
                {entry.title} · <Writer by={entry.author} agent={entry.agent} />{" "}
                <Time iso={entry.createdAt} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
