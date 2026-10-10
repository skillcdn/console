import { type ReactNode, useEffect, useRef } from "react";
import type { RestPerson } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Avatar, cx } from "./ui.js";

// The frame every page sits in (ADR-0010): a header that names the workspace and the project the
// page is on, with the person's menu at its end; a row of tabs below it with the pages of the
// level the person is on; the page itself. Takes its data as props and nothing from the network.

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
  /** A count beside the label: the decisions waiting, for example. */
  readonly count?: number | undefined;
}

/** A language the person may switch to, as the menu offers it (ADR-0012). */
export interface LanguageChoice {
  readonly tag: string;
  readonly label: string;
  readonly current: boolean;
}

export interface ShellProps {
  readonly title: string;
  /** The project the page is on, named after the workspace, or nothing on the workspace's own pages. */
  readonly project?: { readonly name: string; readonly href: string } | undefined;
  /** The pages of the level the person is on, as tabs: the project's, or the workspace's. */
  readonly nav: readonly NavItem[];
  /** The workspace's pages, reached from anywhere through the person's menu. */
  readonly menu?: readonly NavItem[] | undefined;
  /** The languages the pages speak, for the menu to switch between. */
  readonly languages?: readonly LanguageChoice[] | undefined;
  readonly onLanguage?: ((tag: string) => void) | undefined;
  readonly person: RestPerson | undefined;
  /** Follows a link inside the app without loading a document. */
  readonly onNavigate: (href: string) => void;
  readonly onSignOut?: (() => void) | undefined;
  /** Whether the feed is connected: a dot in the header says so. */
  readonly live?: boolean | undefined;
  readonly children: ReactNode;
}

/** Whether a click on a link is a plain one, to be followed in place; a modified one is the browser's. */
export function isPlainClick(event: {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The person's menu: who they are, the workspace's pages, the languages, and the way out. Closes once used. */
function PersonMenu(props: {
  readonly person: RestPerson;
  readonly items: readonly NavItem[];
  readonly languages: readonly LanguageChoice[];
  readonly onLanguage: ((tag: string) => void) | undefined;
  readonly onNavigate: (href: string) => void;
  readonly onSignOut: (() => void) | undefined;
}) {
  const words = useWords();
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (details.current !== null) {
      details.current.open = false;
    }
  };
  // A click elsewhere, or the escape key, closes it, as a menu is expected to.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const element = details.current;
      if (
        element?.open === true &&
        !(event.target instanceof Node && element.contains(event.target))
      ) {
        element.open = false;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.current !== null) {
        details.current.open = false;
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const { person } = props;
  return (
    <details className="sc-menu" ref={details}>
      <summary className="sc-menu-summary" aria-label={words.shell.menu(person.login)}>
        <Avatar person={person} size="sm" />
        <span className="sc-person-login">{person.login}</span>
      </summary>
      <div className="sc-menu-panel">
        <p className="sc-menu-who">
          <span>{person.name ?? person.login}</span>
          {person.name !== null && <span className="sc-muted">{person.login}</span>}
        </p>
        <nav className="sc-menu-list" aria-label={words.shell.workspace}>
          {props.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="sc-menu-link"
              aria-current={item.current ? "page" : undefined}
              onClick={(event) => {
                if (isPlainClick(event)) {
                  event.preventDefault();
                  close();
                  props.onNavigate(item.href);
                }
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {props.languages.length > 1 && props.onLanguage !== undefined && (
          <fieldset className="sc-menu-languages">
            <legend className="sc-menu-heading">{words.common.language}</legend>
            {props.languages.map((language) => (
              <button
                key={language.tag}
                type="button"
                lang={language.tag}
                className={cx("sc-menu-link", language.current && "sc-menu-chosen")}
                aria-pressed={language.current}
                onClick={() => {
                  close();
                  props.onLanguage?.(language.tag);
                }}
              >
                {language.label}
              </button>
            ))}
          </fieldset>
        )}
        {props.onSignOut !== undefined && (
          <button
            type="button"
            className="sc-menu-link sc-menu-out"
            onClick={() => {
              close();
              props.onSignOut?.();
            }}
          >
            {words.shell.signOut}
          </button>
        )}
      </div>
    </details>
  );
}

export function Shell(props: ShellProps) {
  const words = useWords();
  const follow = (href: string) => (event: React.MouseEvent) => {
    if (isPlainClick(event)) {
      event.preventDefault();
      props.onNavigate(href);
    }
  };
  return (
    <div className="sc-shell">
      <a className="sc-skip" href="#sc-content">
        {words.shell.skipToContent}
      </a>
      <header className="sc-header">
        <div className="sc-header-inner">
          <a className="sc-brand" href="/" onClick={follow("/")}>
            {props.title}
          </a>
          {props.project !== undefined && (
            <span className="sc-crumb">
              <span className="sc-crumb-separator" aria-hidden="true">
                /
              </span>
              <a
                className="sc-crumb-link"
                href={props.project.href}
                onClick={follow(props.project.href)}
              >
                {props.project.name}
              </a>
            </span>
          )}
          <div className="sc-header-end">
            {props.live !== undefined && (
              <span
                className={cx("sc-live", props.live && "sc-live-on")}
                title={props.live ? words.shell.live : words.shell.reconnecting}
              >
                <span className="sc-visually-hidden">
                  {props.live ? words.shell.live : words.shell.reconnecting}
                </span>
              </span>
            )}
            {props.person !== undefined && (
              <PersonMenu
                person={props.person}
                items={props.menu ?? []}
                languages={props.languages ?? []}
                onLanguage={props.onLanguage}
                onNavigate={props.onNavigate}
                onSignOut={props.onSignOut}
              />
            )}
          </div>
        </div>
        {props.nav.length > 0 && (
          <nav className="sc-tabs" aria-label={words.shell.pages}>
            <div className="sc-tabs-inner">
              {props.nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={cx("sc-tab", item.current && "sc-tab-current")}
                  aria-current={item.current ? "page" : undefined}
                  onClick={follow(item.href)}
                >
                  {item.label}
                  {item.count !== undefined && item.count > 0 && (
                    <span className="sc-nav-count">{item.count}</span>
                  )}
                </a>
              ))}
            </div>
          </nav>
        )}
      </header>
      <main id="sc-content" className="sc-main">
        {props.children}
      </main>
    </div>
  );
}
