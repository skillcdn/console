import { useState } from "react";
import { useWords } from "../i18n/index.js";
import { Button } from "./ui.js";

// A long list shown a page at a time, from what the page already holds: the feed and the tasks
// with no day grow by a page on a click; the record of the decisions turns its pages, each with
// an address. Nothing is asked of the server either way; the API's own pages (`limit`, `offset`)
// are for the command and scripts.

/** How many items a list shows before it asks to be told to show more. */
export const PAGE_SIZE = 50;

/** How many rows the record of the decisions shows on a page: each says what was asked and what was answered. */
export const RECORD_PAGE_SIZE = 20;

/** The first `shown` items of a list, and the way to show the next page of it. */
export function usePaged<T>(
  items: readonly T[],
  pageSize = PAGE_SIZE,
): { readonly shown: readonly T[]; readonly rest: number; readonly more: () => void } {
  const [pages, setPages] = useState(1);
  const shown = items.slice(0, pages * pageSize);
  return {
    shown,
    rest: items.length - shown.length,
    more: () => setPages((current) => current + 1),
  };
}

/** The button under a paged list, saying how many more there are; nothing when there are none. */
export function ShowMore(props: { readonly rest: number; readonly onMore: () => void }) {
  const words = useWords();
  if (props.rest <= 0) {
    return null;
  }
  return (
    <div className="sc-show-more">
      <Button variant="secondary" size="sm" onClick={props.onMore}>
        {words.common.showMore(Math.min(props.rest, PAGE_SIZE), props.rest)}
      </Button>
    </div>
  );
}

/**
 * The page `page` of a list, counted from one and `pageSize` long, and which it is of how many:
 * a page past the end, or no page at all, is the last or the first, and an empty list has one.
 */
export function pageOf<T>(
  items: readonly T[],
  page: number | undefined,
  pageSize = RECORD_PAGE_SIZE,
): { readonly shown: readonly T[]; readonly page: number; readonly pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current =
    page === undefined || !Number.isInteger(page) ? 1 : Math.min(Math.max(page, 1), pages);
  return {
    shown: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pages,
  };
}

/**
 * The way between the pages of a list: the page before, which items of how many are shown, the
 * page after; nothing for a list of one page. Given `pageHref`, each page has an address and the
 * steps lead there; else `onPage` turns the page in place.
 */
export function Pager(props: {
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly pageSize: number;
  readonly pageHref?: ((page: number) => string) | undefined;
  readonly onPage?: ((page: number) => void) | undefined;
}) {
  const words = useWords().common.pager;
  if (props.pages <= 1) {
    return null;
  }
  const from = (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.page * props.pageSize, props.total);
  const step = (label: string, target: number, there: boolean) => {
    if (!there) {
      return (
        <span className="sc-button sc-button-secondary sc-button-sm" aria-disabled="true">
          {label}
        </span>
      );
    }
    return props.pageHref === undefined ? (
      <Button variant="secondary" size="sm" onClick={() => props.onPage?.(target)}>
        {label}
      </Button>
    ) : (
      <a className="sc-button sc-button-secondary sc-button-sm" href={props.pageHref(target)}>
        {label}
      </a>
    );
  };
  return (
    <nav className="sc-pager" aria-label={words.label}>
      {step(words.previous, props.page - 1, props.page > 1)}
      <span className="sc-pager-range">{words.range(from, to, props.total)}</span>
      {step(words.next, props.page + 1, props.page < props.pages)}
    </nav>
  );
}
