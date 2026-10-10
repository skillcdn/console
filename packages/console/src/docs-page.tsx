import { useEffect, useState } from "react";
import {
  ApiError,
  folderOf,
  type RestBacklink,
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
import { Callout, EmptyState, Spinner } from "./components/ui.js";
import type { ConsoleData } from "./data.js";
import { useWords } from "./i18n/index.js";
import {
  type DocsView,
  decisionHref,
  docHref,
  type Navigation,
  projectHref,
  taskHref,
} from "./router.js";
import { projectPath } from "./routes.js";
import { useAction } from "./use-action.js";

// The Docs page of a project (ADR-0009): the folder or the page the path names, read on its
// own since the tree may be large, and read again whenever the project's feed grows; and the
// view the address asks for (ADR-0010): a search, a form, an earlier version. Part of the
// default composition; a custom console composes the same components its own way.

export interface DocsPageProps {
  readonly project: RestProject;
  /** The path the page is on: a folder, a page, or `""` for the root. */
  readonly path: string;
  /** How the address says the path is shown. */
  readonly view: DocsView;
  readonly data: ConsoleData;
  readonly navigation: Navigation;
}

/** A document the server has no page for, as the page remembers it. */
type Found = RestDocument | null | undefined;

export function DocsPage(props: DocsPageProps) {
  const words = useWords().docs;
  const { project, path, view, data, navigation } = props;
  const [listing, setListing] = useState<RestDocuments | undefined>(undefined);
  const [document, setDocument] = useState<Found>(undefined);
  const [versions, setVersions] = useState<readonly RestVersionSummary[] | undefined>(undefined);
  const [version, setVersion] = useState<RestVersion | undefined>(undefined);
  const [results, setResults] = useState<RestDocuments | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { busy, error, act } = useAction();
  const { actions } = data;
  const key = project.key;
  const feedLength = data.events.length;
  const wanted = view.kind === "read" ? view.version : undefined;
  const query = view.kind === "search" ? view.q : undefined;
  const latest = document?.version;

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
        setProblem(failure instanceof ApiError ? failure.message : words.couldNotLoad);
      }
    });
    return () => controller.abort();
  }, [actions, path, feedLength]);

  // The earlier version the address asks for, once the page is known.
  useEffect(() => {
    if (wanted === undefined || latest === undefined) {
      setVersion(undefined);
      return;
    }
    const controller = new AbortController();
    actions
      .documentVersion(path, wanted, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setVersion(answer);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [actions, path, wanted, latest]);

  // The search the address asks for, over all the project's pages.
  useEffect(() => {
    if (query === undefined) {
      setResults(undefined);
      return;
    }
    const controller = new AbortController();
    actions
      .documents({ q: query }, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setResults(answer);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setProblem(failure instanceof ApiError ? failure.message : words.searchFailed);
        }
      });
    return () => controller.abort();
  }, [actions, query, words]);

  const toDoc = (target: string) => docHref(key, target);
  const toFolder = (folder: string) => docHref(key, folder);
  const toFile = (file: RestDocumentFile) => `${projectPath(key, "docs", path)}/files/${file.id}`;
  const toTask = (backlink: RestBacklink) =>
    backlink.number === null ? projectHref(key) : taskHref(key, backlink.number);
  const toDecision = (decisionId: string) => decisionHref(key, decisionId);
  /** The plain address of what the page is on. */
  const here = toDoc(path);
  const page = document !== null && document !== undefined ? document : undefined;
  /** The folder a new page goes in: this one, or the one the page shown is in. */
  const folder = page === undefined ? path : folderOf(path);

  const search = (typed: string) =>
    navigation.go(typed === "" ? here : docHref(key, path, { kind: "search", q: typed }));

  const head = (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">{words.title}</h1>
        {view.kind !== "new" && (
          <a className="sc-button sc-button-primary" href={docHref(key, folder, { kind: "new" })}>
            {words.newPage}
          </a>
        )}
      </div>
      <DocumentSearch key={query ?? ""} query={query} busy={busy} onSearch={search} />
      {problem !== undefined && <Callout tone="danger">{problem}</Callout>}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
    </>
  );

  if (view.kind === "search") {
    return (
      <>
        {head}
        <section aria-label={words.found}>
          <h2 className="sc-section-title">{words.pagesWith(view.q)}</h2>
          {results === undefined ? (
            <div className="sc-loading">
              <Spinner label={words.searching} />
            </div>
          ) : (
            <DocumentList
              items={results.items}
              docHref={toDoc}
              empty={<EmptyState title={words.noPageHasWords} />}
            />
          )}
        </section>
      </>
    );
  }

  if (view.kind === "new") {
    return (
      <>
        {head}
        <section className="sc-panel" aria-label={words.newPageAria}>
          <DocumentForm
            folder={folder}
            busy={busy}
            onSubmit={(input) =>
              void act(async () => {
                const written = await actions.writeDocument(input.path, {
                  title: input.title,
                  body: input.body,
                });
                navigation.replace(toDoc(written.path));
              })
            }
            onCancel={() => navigation.back(here)}
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
          <Spinner label={words.loading} />
        </div>
      </>
    );
  }

  if (page !== undefined) {
    if (view.kind === "edit") {
      return (
        <>
          {head}
          <section className="sc-panel" aria-label={words.editPageAria}>
            <DocumentForm
              document={page}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  const written = await actions.writeDocument(page.path, {
                    title: input.title,
                    body: input.body,
                    ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
                  });
                  setDocument(written);
                  navigation.replace(here);
                })
              }
              onCancel={() => navigation.back(here)}
            />
          </section>
        </>
      );
    }
    const archived = page.archivedAt !== null;
    return (
      <>
        {head}
        <DocumentView
          document={page}
          version={wanted !== undefined && version?.number === wanted ? version : undefined}
          versions={versions}
          docHref={toDoc}
          folderHref={toFolder}
          fileHref={toFile}
          taskHref={toTask}
          decisionHref={toDecision}
          busy={busy}
          editHref={archived ? undefined : docHref(key, path, { kind: "edit" })}
          versionHref={(number) =>
            number === undefined ? here : docHref(key, path, { kind: "read", version: number })
          }
          onArchive={() =>
            void act(async () => {
              setDocument(await actions.archiveDocument(page.path));
            })
          }
          onRestore={() =>
            void act(async () => {
              setDocument(await actions.restoreDocument(page.path));
            })
          }
          onAttach={(file, label) =>
            void act(async () => {
              const bytes = new Uint8Array(await file.arrayBuffer());
              setDocument(
                await actions.attachDocumentFile(page.path, {
                  name: file.name,
                  bytes,
                  ...(file.type === "" ? {} : { contentType: file.type }),
                  ...(label === undefined ? {} : { label }),
                }),
              );
            })
          }
        />
      </>
    );
  }

  const something =
    listing !== undefined && (listing.folders.length > 0 || listing.items.length > 0);
  const write = (
    <a className="sc-button sc-button-secondary" href={docHref(key, path, { kind: "new" })}>
      {path === "" ? words.newPage : words.writeIt}
    </a>
  );
  return (
    <>
      {head}
      {path !== "" && <DocumentCrumbs path={path} folderHref={toFolder} />}
      {something && listing !== undefined ? (
        <FolderView listing={listing} docHref={toDoc} folderHref={toFolder} />
      ) : path === "" ? (
        <EmptyState title={words.emptyRoot.title} body={words.emptyRoot.body} action={write} />
      ) : (
        <EmptyState title={words.emptyPath.title} body={words.emptyPath.body} action={write} />
      )}
    </>
  );
}
