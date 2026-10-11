import { useState } from "react";
import { useWords } from "../i18n/index.js";
import { Button } from "./ui.js";

// A long list shown a page at a time, from what the page already holds: the record of the
// decisions, the feed, the tasks with no day. The next page is a click away and nothing is
// asked of the server; the API's own pages (`limit`, `offset`) are for the command and scripts.

/** How many items a list shows before it asks to be told to show more. */
export const PAGE_SIZE = 50;

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
