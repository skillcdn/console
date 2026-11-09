import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { RestPerson } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Avatar, cx, personName } from "./ui.js";

// The frame every page sits in (ADR-0010): a header that names the workspace and the project the
// page is on, with the person's menu at its end; a row of tabs below it with the pages of the
// level the person is on; the page itself. Takes its data as props and nothing from the network.

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
  /** A count beside the label: the decisions waiting, for example. */
  readonly count?: number | undefined;
  /** The pages the tab opens a list of, as a group of plugins does (ADR-0054); the tab itself leads to the first. */
  readonly children?: readonly NavItem[] | undefined;
  /** What the page is, in a line: said under its name in a group's list, as a plugin describes itself. */
  readonly description?: string | undefined;
}

/** The addresses of a brand's marks (ADR-0013): shown beside the workspace's name, and above it when signing in. */
export interface Brand {
  /** A small square mark, as an image the browser loads. */
  readonly symbol?: string | undefined;
  /** The name as a mark, as an image the browser loads. */
  readonly wordmark?: string | undefined;
}

/** A language the person may switch to, as the menu offers it (ADR-0012). */
export interface LanguageChoice {
  readonly tag: string;
  readonly label: string;
  readonly current: boolean;
}

export interface ShellProps {
  readonly title: string;
  /** The marks to show beside the name; none shows the name alone. */
  readonly brand?: Brand | undefined;
  /** The project the page is on, named after the workspace, with its mark when the page has it, or nothing on the workspace's own pages. */
  readonly project?:
    | { readonly name: string; readonly href: string; readonly mark?: ReactNode }
    | undefined;
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
  /** Whether the page takes the whole width of the window, as the board does, rather than the column the rest read in. */
  readonly wide?: boolean | undefined;
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

/**
 * A page of a menu: followed in place for a plain click, and the menu closes. In a group's list
 * it says what the page is under its name, where the item has a description.
 */
function MenuLink(props: {
  readonly item: NavItem;
  readonly onFollow: (href: string) => void;
  readonly described?: boolean | undefined;
}) {
  const { item } = props;
  const described = props.described === true;
  return (
    <a
      href={item.href}
      className={cx("sc-menu-link", described && "sc-group-link")}
      aria-current={item.current ? "page" : undefined}
      onClick={(event) => {
        if (isPlainClick(event)) {
          event.preventDefault();
          props.onFollow(item.href);
        }
      }}
    >
      {described ? (
        <>
          <span className="sc-group-link-name">{item.label}</span>
          {item.description !== undefined && item.description !== "" && (
            <span className="sc-group-link-note">{item.description}</span>
          )}
        </>
      ) : (
        item.label
      )}
    </a>
  );
}

/**
 * The longest name a tab shows whole: the stylesheet stops a longer one short with an ellipsis,
 * about here, and the tab's title carries it whole. A plugin's name runs to 40 characters.
 */
const TAB_LABEL_WHOLE = 28;

/** A tab's name, as the stylesheet may stop it short, and the title that then says it whole. */
function tabLabel(label: string): { readonly title: string | undefined } {
  return { title: label.length > TAB_LABEL_WHOLE ? label : undefined };
}

/** How close to the window's edge a list opened from a tab may come. */
const PANEL_GUTTER_PX = 8;
/** How far below its tab, off the header's line, a list opens. */
const PANEL_DROP_PX = 6;
/** How far a list's edge stands before the names in it: its own padding and a link's. */
const PANEL_INSET_PX = 14;

/**
 * Puts the list a tab opened under the tab, the names in it lined up with the tab's, within the
 * window: the list is in the top layer, where nothing of the page places it.
 */
function placeUnder(tab: HTMLElement | null, box: HTMLElement | null): void {
  if (tab === null || box === null) {
    return;
  }
  const at = tab.getBoundingClientRect();
  const room = window.innerWidth - box.offsetWidth - PANEL_GUTTER_PX;
  box.style.left = `${Math.max(PANEL_GUTTER_PX, Math.min(at.left - PANEL_INSET_PX, room))}px`;
  box.style.top = `${at.bottom + PANEL_DROP_PX}px`;
}

/**
 * A tab that opens a list of pages, as a group of several plugins does. The list is a popover:
 * in the top layer, out of the row of tabs, which scrolls sideways and clips whatever hangs out
 * of it, and dismissed by a click elsewhere or the escape key, as the browser does it. Placed
 * under its tab when it opens; closed once used, and when the row scrolls or the window changes.
 */
function TabGroup(props: { readonly item: NavItem; readonly onNavigate: (href: string) => void }) {
  const id = useId();
  const tab = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const box = panel.current;
    if (box === null) {
      return;
    }
    const onToggle = (event: Event) => {
      setOpen((event as ToggleEvent).newState === "open");
    };
    box.addEventListener("toggle", onToggle);
    return () => box.removeEventListener("toggle", onToggle);
  }, []);
  useEffect(() => {
    if (!open) {
      return;
    }
    // Placed again now that the list has its width. The row of tabs scrolling, or the window
    // changing, would leave it where the tab no longer is.
    placeUnder(tab.current, panel.current);
    const close = () => panel.current?.hidePopover();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  const { item } = props;
  return (
    <div className="sc-tab-group">
      <button
        type="button"
        ref={tab}
        className={cx("sc-tab", "sc-tab-summary", item.current && "sc-tab-current")}
        aria-current={item.current ? "page" : undefined}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        {...tabLabel(item.label)}
        // Placed before the browser shows it, so that it never shows anywhere else first.
        onClick={() => placeUnder(tab.current, panel.current)}
      >
        <span className="sc-tab-label">{item.label}</span>
        <svg className="sc-menu-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div id={id} ref={panel} popover="auto" className="sc-menu-panel sc-tab-group-panel">
        <div className="sc-menu-list">
          {(item.children ?? []).map((child) => (
            <MenuLink
              key={child.href}
              item={child}
              described
              onFollow={(href) => {
                panel.current?.hidePopover();
                props.onNavigate(href);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
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
  const follow = (href: string) => {
    close();
    props.onNavigate(href);
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
      <summary className="sc-menu-summary" aria-label={words.shell.menu(personName(person))}>
        <Avatar person={person} size="sm" />
        <span className="sc-person-login">{personName(person)}</span>
        <svg className="sc-menu-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="sc-menu-panel">
        <p className="sc-menu-who">
          <span>{person.name ?? person.login}</span>
          {person.name !== null && <span className="sc-muted">{person.login}</span>}
        </p>
        <nav className="sc-menu-list" aria-label={words.shell.workspace}>
          {props.items.map((item) =>
            item.children !== undefined && item.children.length > 0 ? (
              // A group of plugins, one by one under the group's name: where a tab opens a list.
              <Fragment key={item.href}>
                <p className="sc-menu-heading">{item.label}</p>
                {item.children.map((child) => (
                  <MenuLink key={child.href} item={child} onFollow={follow} />
                ))}
              </Fragment>
            ) : (
              <MenuLink key={item.href} item={item} onFollow={follow} />
            ),
          )}
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
  // Where the tabs scroll sideways, the current one is brought into the bar's view.
  const tabs = useRef<HTMLElement>(null);
  const current = props.nav.find((item) => item.current)?.href;
  useEffect(() => {
    const bar = tabs.current;
    if (current === undefined || bar === null) {
      return;
    }
    const bring = () => {
      const tab = bar.querySelector<HTMLElement>(".sc-tab-current");
      if (tab === null) {
        return;
      }
      const left = tab.offsetLeft - bar.offsetLeft;
      // The last part of the bar fades where it scrolls (the stylesheet's mask): a tab there
      // counts as out of view.
      const seen = bar.scrollWidth > bar.clientWidth ? bar.clientWidth * 0.85 : bar.clientWidth;
      if (left < bar.scrollLeft || left + tab.offsetWidth > bar.scrollLeft + seen) {
        bar.scrollLeft = left - (bar.clientWidth - tab.offsetWidth) / 2;
      }
    };
    bring();
    // The tabs grow once the page's face has loaded, and the bar narrows with the window: either
    // may put the current tab out of view again.
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const watch = new ResizeObserver(bring);
    watch.observe(bar);
    const inner = bar.firstElementChild;
    if (inner !== null) {
      watch.observe(inner);
    }
    return () => watch.disconnect();
  }, [current]);
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
          <a className="sc-brand" href="/" onClick={follow("/")} aria-label={props.title}>
            {props.brand?.symbol !== undefined && (
              <img className="sc-brand-symbol" src={props.brand.symbol} alt="" />
            )}
            {props.brand?.wordmark !== undefined ? (
              <img className="sc-brand-wordmark" src={props.brand.wordmark} alt="" />
            ) : (
              <span className="sc-brand-name">{props.title}</span>
            )}
          </a>
          {props.brand?.wordmark !== undefined && (
            // With the marks in the brand's place, the workspace is named after them, as a crumb.
            <span className="sc-crumb">
              <span className="sc-crumb-separator" aria-hidden="true">
                /
              </span>
              <a className="sc-crumb-link" href="/" onClick={follow("/")}>
                {props.title}
              </a>
            </span>
          )}
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
                {props.project.mark}
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
          <nav ref={tabs} className="sc-tabs" aria-label={words.shell.pages}>
            <div className="sc-tabs-inner">
              {props.nav.map((item) =>
                item.children !== undefined && item.children.length > 0 ? (
                  <TabGroup key={item.href} item={item} onNavigate={props.onNavigate} />
                ) : (
                  <a
                    key={item.href}
                    href={item.href}
                    className={cx("sc-tab", item.current && "sc-tab-current")}
                    aria-current={item.current ? "page" : undefined}
                    {...tabLabel(item.label)}
                    onClick={follow(item.href)}
                  >
                    <span className="sc-tab-label">{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className="sc-nav-count">{item.count}</span>
                    )}
                  </a>
                ),
              )}
            </div>
          </nav>
        )}
      </header>
      <main id="sc-content" className={cx("sc-main", props.wide === true && "sc-main-wide")}>
        {props.children}
      </main>
    </div>
  );
}
