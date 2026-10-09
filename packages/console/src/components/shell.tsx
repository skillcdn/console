import type { ReactNode } from "react";
import type { RestPerson } from "../api.js";
import { Avatar, Button, cx } from "./ui.js";

// The frame every page sits in: the name of the workspace, the project the page is on, the way
// to each page, who is signed in and the way out. Takes its data as props and nothing from the
// network.

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
  /** A count beside the label: the decisions waiting, for example. */
  readonly count?: number | undefined;
}

export interface ShellProps {
  readonly title: string;
  /** The project the page is on, named after the workspace, or nothing on the workspace's own pages. */
  readonly project?: { readonly name: string; readonly href: string } | undefined;
  readonly nav: readonly NavItem[];
  readonly person: RestPerson | undefined;
  /** Follows a link inside the app without loading a document. */
  readonly onNavigate: (href: string) => void;
  readonly onSignOut?: (() => void) | undefined;
  /** Whether the feed is connected: a dot in the header says so. */
  readonly live?: boolean | undefined;
  readonly children: ReactNode;
}

export function Shell(props: ShellProps) {
  const follow = (href: string) => (event: React.MouseEvent) => {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      props.onNavigate(href);
    }
  };
  return (
    <div className="sc-shell">
      <a className="sc-skip" href="#sc-content">
        Skip to content
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
          <nav className="sc-nav" aria-label="Pages">
            {props.nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cx("sc-nav-link", item.current && "sc-nav-current")}
                aria-current={item.current ? "page" : undefined}
                onClick={follow(item.href)}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <span className="sc-nav-count">{item.count}</span>
                )}
              </a>
            ))}
          </nav>
          <div className="sc-header-end">
            {props.live !== undefined && (
              <span
                className={cx("sc-live", props.live && "sc-live-on")}
                title={props.live ? "Live" : "Reconnecting"}
              >
                <span className="sc-visually-hidden">{props.live ? "Live" : "Reconnecting"}</span>
              </span>
            )}
            {props.person !== undefined && (
              <>
                <span className="sc-person" title={props.person.name ?? props.person.login}>
                  <Avatar person={props.person} size="sm" />
                  <span className="sc-person-login">{props.person.login}</span>
                </span>
                {props.onSignOut !== undefined && (
                  <Button size="sm" variant="ghost" onClick={props.onSignOut}>
                    Sign out
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      <main id="sc-content" className="sc-main">
        {props.children}
      </main>
    </div>
  );
}
