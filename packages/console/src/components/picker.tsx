import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useWords } from "../i18n/index.js";
import { cx } from "./ui.js";

// Choosing one thing out of a listing too long to offer whole (ADR-0037): the task a new one is
// part of, the goal it works towards. The picker asks for what the words typed find, a page at a
// time, and never holds the listing: the first page as soon as the field is entered, the words'
// page once the typing rests, the next page on a press. What is chosen stands in the field's
// place, and a press clears it. Takes a search and nothing else from the network.

/** How many items one page of a picker holds: enough to find the one meant, few enough to read at a glance. */
export const PICKER_PAGE_LIMIT = 10;
/** How long the typing rests before the words are searched. */
const SEARCH_DELAY_MS = 200;

export interface PickerPage<T> {
  readonly items: readonly T[];
  readonly more: boolean;
}

/** What the words find, from `offset` on; the first page of everything while the words are empty. */
export type PickerSearch<T> = (
  query: string,
  page: { readonly limit: number; readonly offset: number },
  signal: AbortSignal,
) => Promise<PickerPage<T>>;

/** How far the list stands from the field, in pixels, as the stylesheet has it. */
const LIST_GAP = 4;

/**
 * Whether the list opens above the field: only where the window has no room for it below the
 * field and more room above than below; else below, as a list does.
 */
export function opensAbove(
  field: { readonly top: number; readonly bottom: number },
  listHeight: number,
  windowHeight: number,
): boolean {
  const below = windowHeight - field.bottom - LIST_GAP;
  const over = field.top - LIST_GAP;
  return listHeight > below && over > below;
}

export interface PickerProps<T> {
  /** What is chosen, if anything. */
  readonly value: T | undefined;
  /** What stands for a choice made but not read back yet: shown in the chip's place, and cleared as one. */
  readonly held?: ReactNode | undefined;
  readonly search: PickerSearch<T>;
  readonly keyOf: (item: T) => string;
  /** How an item reads, in the list and once chosen. */
  readonly render: (item: T) => ReactNode;
  readonly onChange: (item: T | undefined) => void;
  /** The field's name, for the input and the list. */
  readonly label: string;
  readonly placeholder: string;
  readonly disabled?: boolean | undefined;
  /** What the search may answer with but cannot be chosen: a task, as its own parent. */
  readonly exclude?: ((item: T) => boolean) | undefined;
}

export function Picker<T>(props: PickerProps<T>) {
  const words = useWords().common;
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly T[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [above, setAbove] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The search and the exclusion as the page last gave them, read at the moment of a request,
  // so that a page rendering again starts no search over.
  const search = useRef(props.search);
  search.current = props.search;
  const exclude = useRef(props.exclude);
  exclude.current = props.exclude;
  const latest = useRef(query);
  latest.current = query;

  // The list opens below the field, and above it only where the window has no room below and
  // more above: measured before anything is painted, once it is open and again whenever what it
  // holds changes its height, so that it never shows below for a frame on its way up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the items, the loading and the more are what changes the list's height
  useLayoutEffect(() => {
    if (!open || field.current === null || list.current === null) {
      return;
    }
    setAbove(
      opensAbove(
        field.current.getBoundingClientRect(),
        list.current.offsetHeight,
        window.innerHeight,
      ),
    );
  }, [open, items, loading, more]);

  // The words' page once the typing rests; the first page of everything at once on entering.
  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        search
          .current(query, { limit: PICKER_PAGE_LIMIT, offset: 0 }, controller.signal)
          .then((page) => {
            if (!controller.signal.aborted) {
              setItems(page.items.filter((item) => exclude.current?.(item) !== true));
              setMore(page.more);
              setActive(-1);
              setLoading(false);
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setItems([]);
              setMore(false);
              setLoading(false);
            }
          });
      },
      query === "" ? 0 : SEARCH_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  /** The next page of the same words, put under the ones shown; dropped when the words moved on. */
  const loadMore = () => {
    const wanted = query;
    setLoading(true);
    search
      .current(
        wanted,
        { limit: PICKER_PAGE_LIMIT, offset: items.length },
        new AbortController().signal,
      )
      .then((page) => {
        if (wanted !== latest.current) {
          return;
        }
        setItems((current) => [
          ...current,
          ...page.items.filter((item) => exclude.current?.(item) !== true),
        ]);
        setMore(page.more);
        setLoading(false);
      })
      .catch(() => {
        if (wanted === latest.current) {
          setMore(false);
          setLoading(false);
        }
      });
  };

  const choose = (item: T) => {
    props.onChange(item);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((current) => (items.length === 0 ? -1 : (current + 1) % items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        items.length === 0 ? -1 : current <= 0 ? items.length - 1 : current - 1,
      );
    } else if (event.key === "Enter") {
      // A choice, or nothing: the form around the field is never sent by this key.
      event.preventDefault();
      const chosen = active >= 0 ? items[active] : undefined;
      if (chosen !== undefined) {
        choose(chosen);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  if (props.value !== undefined || props.held !== undefined) {
    return (
      <div className="sc-picker sc-picker-chosen">
        <span className="sc-picker-value">
          {props.value === undefined ? props.held : props.render(props.value)}
        </span>
        <button
          type="button"
          className="sc-picker-clear"
          aria-label={words.remove}
          disabled={props.disabled}
          onClick={() => props.onChange(undefined)}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sc-picker">
      <input
        ref={field}
        className="sc-input"
        type="text"
        role="combobox"
        aria-label={props.label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={props.placeholder}
        value={query}
        disabled={props.disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        // The list of a combobox: read and chosen through the input, which keeps the focus; an
        // option is chosen on the press, before the input loses its focus and the list closes.
        <div
          ref={list}
          className={cx("sc-picker-list", above && "sc-picker-list-above")}
          id={listId}
          role="listbox"
          aria-label={props.label}
        >
          {items.map((item, index) => (
            <div
              key={props.keyOf(item)}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cx("sc-picker-option", index === active && "sc-picker-option-active")}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {props.render(item)}
            </div>
          ))}
          {!loading && items.length === 0 && (
            <div className="sc-picker-note sc-muted">{words.picker.nothingFound}</div>
          )}
          {loading && <div className="sc-picker-note sc-muted">{words.picker.searching}</div>}
          {more && !loading && (
            <div className="sc-picker-note">
              <button
                type="button"
                className="sc-button sc-button-ghost sc-button-sm"
                onMouseDown={(event) => {
                  event.preventDefault();
                  loadMore();
                }}
              >
                {words.picker.more}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
