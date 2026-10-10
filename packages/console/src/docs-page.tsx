import { useEffect, useState } from "react";
import {
  ApiError,
  folderOf,
  type RestDocument,
  type RestDocumentFile,
  type RestDocuments,
  type RestProject,
  type RestVersion,
  type RestVersionSummary,
} from "./api.js";
import {
  DocumentCrumbs,
  DocumentForm,
  DocumentList,
  DocumentSearch,
  DocumentView,
  FolderView,
} from "./components/documents.js";
import { Button, Callout, EmptyState, Spinner } from "./components/ui.js";
import type { ConsoleData } from "./data.js";
import { docHref, projectHref, taskHref } from "./router.js";
import { projectPath } from "./routes.js";
import { useAction } from "./use-action.js";

// The Docs page of a project (ADR-0009): the folder or the page the path names, read on its
// own since the tree may be large, and read again whenever the project's feed grows; a search
// over the pages; and the ways to write, archive, restore and attach. Part of the default
// composition; a custom console composes the same components its own way.

export interface DocsPageProps {
  readonly project: RestProject;
  /** The path the page is on: a folder, a page, or `""` for the root. */
  readonly path: string;
  readonly data: ConsoleData;
  readonly navigate: (href: string) => void;
}

/** A document the server has no page for, as the page remembers it. */
type Found = RestDocument | null | undefined;

export function DocsPage(props: DocsPageProps) {
  const { project, path, data, navigate } = props;
  const [listing, setListing] = useState<RestDocuments | undefined>(undefined);
  const [document, setDocument] = useState<Found>(undefined);
  const [versions, setVersions] = useState<readonly RestVersionSummary[] | undefined>(undefined);
  const [version, setVersion] = useState<RestVersion | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RestDocuments | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState(false);
  const { busy, error, act } = useAction();
  const { actions } = data;
  const key = project.key;
  const feedLength = data.events.length;

  // The folder and the page at the path, asked for again whenever the project's feed grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the feed's length is the trigger
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setProblem(undefined);
    const load = async () => {
      const [folder, found] = await Promise.all([
        actions.documents({ folder: path }, signal),
        path === ""
          ? Promise.resolve<Found>(null)
          : actions.document(path, signal).catch((failure: unknown): Found => {
              if (failure instanceof ApiError && failure.code === "document.not_found") {
                return null;
              }
              throw failure;
            }),
      ]);
      if (signal.aborted) {
        return;
      }
      setListing(folder);
      setDocument(found);
      if (found !== null && found !== undefined) {
        actions
          .documentVersions(path, signal)
          .then((answer) => {
            if (!signal.aborted) {
              setVersions(answer.items);
            }
          })
          .catch(() => undefined);
      } else {
        setVersions(undefined);
      }
    };
    load().catch((failure: unknown) => {
      if (!signal.aborted) {
        setProblem(
          failure instanceof ApiError ? failure.message : "The documents could not be loaded.",
        );
      }
    });
    return () => controller.abort();
  }, [actions, path, feedLength]);

  // Another path starts over: no version shown, no form open, no search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger
  useEffect(() => {
    setVersion(undefined);
    setEditing(false);
    setWriting(false);
    setResults(undefined);
    setQuery("");
  }, [path]);

  const toDoc = (target: string) => docHref(key, target);
  const toFolder = (folder: string) => docHref(key, folder);
  const toFile = (file: RestDocumentFile) => `${projectPath(key, "docs", path)}/files/${file.id}`;
  const toTask = (taskId: string) => taskHref(key, taskId);
  const toDecision = (decisionId: string) => `${projectHref(key, "decisions")}#${decisionId}`;

  const search = (words: string) => {
    setQuery(words);
    if (words === "") {
      setResults(undefined);
      return;
    }
    void act(async () => {
      setResults(await actions.documents({ q: words }));
    });
  };

  const head = (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">Docs</h1>
        <Button
          variant="primary"
          onClick={() => {
            setWriting(true);
            setEditing(false);
          }}
          disabled={writing}
        >
          New page
        </Button>
      </div>
      <DocumentSearch query={query} busy={busy} onSearch={search} />
      {problem !== undefined && <Callout tone="danger">{problem}</Callout>}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
    </>
  );

  if (results !== undefined) {
    return (
      <>
        {head}
        <section aria-label="Pages found">
          <h2 className="sc-section-title">Pages with "{query}"</h2>
          <DocumentList
            items={results.items}
            docHref={toDoc}
            empty={<EmptyState title="No page has these words" />}
          />
        </section>
      </>
    );
  }

  if (writing) {
    return (
      <>
        {head}
        <section className="sc-panel" aria-label="New page">
          <DocumentForm
            folder={document === null || document === undefined ? path : folderOf(path)}
            busy={busy}
            onSubmit={(input) =>
              void act(async () => {
                const written = await actions.writeDocument(input.path, {
                  title: input.title,
                  body: input.body,
                });
                setWriting(false);
                navigate(toDoc(written.path));
              })
            }
            onCancel={() => setWriting(false)}
          />
        </section>
      </>
    );
  }

  if (document === undefined && listing === undefined) {
    return (
      <>
        {head}
        <div className="sc-loading">
          <Spinner label="Loading the documents" />
        </div>
      </>
    );
  }

  if (document !== null && document !== undefined) {
    if (editing) {
      return (
        <>
          {head}
          <section className="sc-panel" aria-label="Edit the page">
            <DocumentForm
              document={document}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  const written = await actions.writeDocument(document.path, {
                    title: input.title,
                    body: input.body,
                    ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
                  });
                  setDocument(written);
                  setVersion(undefined);
                  setEditing(false);
                })
              }
              onCancel={() => setEditing(false)}
            />
          </section>
        </>
      );
    }
    return (
      <>
        {head}
        <DocumentView
          document={document}
          version={version}
          versions={versions}
          docHref={toDoc}
          folderHref={toFolder}
          fileHref={toFile}
          taskHref={toTask}
          decisionHref={toDecision}
          busy={busy}
          onEdit={() => setEditing(true)}
          onArchive={() =>
            void act(async () => {
              setDocument(await actions.archiveDocument(document.path));
            })
          }
          onRestore={() =>
            void act(async () => {
              setDocument(await actions.restoreDocument(document.path));
            })
          }
          onAttach={(file, label) =>
            void act(async () => {
              const bytes = new Uint8Array(await file.arrayBuffer());
              setDocument(
                await actions.attachDocumentFile(document.path, {
                  name: file.name,
                  bytes,
                  ...(file.type === "" ? {} : { contentType: file.type }),
                  ...(label === undefined ? {} : { label }),
                }),
              );
            })
          }
          onShowVersion={(number) =>
            void act(async () => {
              setVersion(
                number === undefined
                  ? undefined
                  : await actions.documentVersion(document.path, number),
              );
            })
          }
        />
      </>
    );
  }

  const something =
    listing !== undefined && (listing.folders.length > 0 || listing.items.length > 0);
  return (
    <>
      {head}
      {path !== "" && <DocumentCrumbs path={path} folderHref={toFolder} />}
      {something && listing !== undefined ? (
        <FolderView listing={listing} docHref={toDoc} folderHref={toFolder} />
      ) : path === "" ? (
        <EmptyState
          title="No pages yet"
          body="Write the first one: what the project rests on, in Markdown, at a path of its own."
          action={<Button onClick={() => setWriting(true)}>New page</Button>}
        />
      ) : (
        <EmptyState
          title="No page at this path"
          body="Nothing is written here yet, and no folder of that name holds a page."
          action={<Button onClick={() => setWriting(true)}>Write it</Button>}
        />
      )}
    </>
  );
}
