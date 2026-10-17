import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import {
  type CategoryColor,
  type GoalState,
  OPEN_TASK_STATES,
  type PersonRole,
  type RestPerson,
  type RestTaskCounts,
  type TaskPriority,
  type TaskState,
} from "../api.js";
import { dayOf, daysBetween, formatDay, today } from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";

// Small building blocks. Each one is a class in styles/console.css and nothing more. Classes
// are prefixed `sc-` so that a custom console's own styles never collide with them. The words
// come from the language the page is in (ADR-0012).

export function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly variant?: "primary" | "secondary" | "ghost" | "danger";
    readonly size?: "md" | "sm";
  },
) {
  const { variant = "secondary", size = "md", className, type = "button", ...rest } = props;
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        "sc-button",
        `sc-button-${variant}`,
        size === "sm" && "sc-button-sm",
        className,
      )}
    />
  );
}

export function Badge(props: {
  readonly tone?: "neutral" | "accent" | "point" | "success" | "warning" | "danger";
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={cx("sc-badge", `sc-badge-${props.tone ?? "neutral"}`)} title={props.title}>
      {props.children}
    </span>
  );
}

export function Callout(props: {
  readonly tone?: "info" | "warning" | "danger";
  readonly title?: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  const tone = props.tone ?? "info";
  return (
    <div
      className={cx("sc-callout", `sc-callout-${tone}`)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        {props.title !== undefined && <p className="sc-callout-title">{props.title}</p>}
        {props.children !== undefined && <div className="sc-callout-body">{props.children}</div>}
      </div>
      {props.action}
    </div>
  );
}

/** What a person is called on the pages: the name the host gives, or the login where there is none. */
export function personName(person: {
  readonly login: string;
  readonly name: string | null;
}): string {
  const name = person.name?.trim() ?? "";
  return name === "" ? person.login : name;
}

/**
 * A person's picture as the git host serves it: loaded lazily, without a referrer, and gone as
 * a whole when there is none or it cannot be loaded, leaving the initial of the name instead.
 */
export function Avatar(props: {
  readonly person: RestPerson;
  readonly size?: "xs" | "sm" | "md" | "lg";
}) {
  const size = props.size ?? "md";
  const initial = personName(props.person).slice(0, 1).toUpperCase();
  if (props.person.avatar === null) {
    return (
      <span
        className={cx("sc-avatar", "sc-avatar-initial", `sc-avatar-${size}`)}
        aria-hidden="true"
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      className={cx("sc-avatar", `sc-avatar-${size}`)}
      src={props.person.avatar}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/** Puts a text on the clipboard, where the browser offers one, and says so once it is there. */
export function CopyButton(props: { readonly text: string; readonly size?: "md" | "sm" }) {
  const words = useWords().common;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
      return;
    }
    void navigator.clipboard.writeText(props.text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Button size={props.size ?? "md"} onClick={copy}>
      {copied ? words.copied : words.copy}
    </Button>
  );
}

/** A person, as a picture and their name, wherever one is named; the login is there on hover. */
export function PersonChip(props: { readonly person: RestPerson; readonly size?: "sm" | "md" }) {
  return (
    <span className="sc-person" title={props.person.login}>
      <Avatar person={props.person} size={props.size ?? "sm"} />
      <span className="sc-person-login">{personName(props.person)}</span>
    </span>
  );
}

/** The words of the vocabulary as people read them, in English: the default pack's. */
export const STATE_LABELS: Readonly<Record<TaskState, string>> = {
  idea: "Idea",
  ready: "Ready",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  dropped: "Dropped",
};

export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const ROLE_LABELS: Readonly<Record<PersonRole, string>> = {
  admin: "Administrator",
  member: "Member",
};

export function RoleBadge(props: { readonly role: PersonRole }) {
  const words = useWords();
  return (
    <Badge tone={props.role === "admin" ? "point" : "neutral"}>
      {words.vocabulary.role[props.role]}
    </Badge>
  );
}

export function StateBadge(props: { readonly state: TaskState }) {
  const words = useWords();
  const tone =
    props.state === "done"
      ? "success"
      : props.state === "dropped"
        ? "neutral"
        : props.state === "in_progress" || props.state === "in_review"
          ? "accent"
          : "neutral";
  return <Badge tone={tone}>{words.vocabulary.state[props.state]}</Badge>;
}

export function PriorityBadge(props: { readonly priority: TaskPriority }) {
  const words = useWords();
  if (props.priority === "normal") {
    return null;
  }
  const tone =
    props.priority === "urgent" ? "danger" : props.priority === "high" ? "point" : "neutral";
  return <Badge tone={tone}>{words.vocabulary.priority[props.priority]}</Badge>;
}

/** A category as a badge, in its colour: a class the stylesheet paints, never a value typed by hand. */
export function CategoryBadge(props: {
  readonly category: { readonly name: string; readonly color: CategoryColor };
}) {
  return (
    <span className={cx("sc-badge", "sc-badge-category", `sc-category-${props.category.color}`)}>
      {props.category.name}
    </span>
  );
}

export function GoalStateBadge(props: { readonly state: GoalState }) {
  const words = useWords();
  const tone =
    props.state === "done"
      ? "success"
      : props.state === "active"
        ? "accent"
        : props.state === "dropped"
          ? "neutral"
          : "neutral";
  return <Badge tone={tone}>{words.vocabulary.goalState[props.state]}</Badge>;
}

/**
 * When a task is due, as a person needs to read it: how late it is while it is open and past
 * its day, how soon it is due within the week, and the day itself otherwise. A task that is
 * over keeps its day as a plain fact.
 */
export function DueBadge(props: {
  readonly dueOn: string;
  readonly state: TaskState;
  /** The day to count from; the browser's today when left out. */
  readonly today?: string | undefined;
}) {
  const words = useWords();
  const { tag } = useLanguage();
  const now = props.today ?? today();
  const open = OPEN_TASK_STATES.includes(props.state);
  const days = daysBetween(now, props.dueOn);
  const day = formatDay(props.dueOn, tag);
  if (!open) {
    return <Badge tone="neutral">{words.board.due.on(day)}</Badge>;
  }
  if (days < 0) {
    return (
      <Badge tone="danger" title={day}>
        {words.board.due.overdue(-days)}
      </Badge>
    );
  }
  if (days === 0) {
    return <Badge tone="warning">{words.board.due.today}</Badge>;
  }
  if (days === 1) {
    return <Badge tone="warning">{words.board.due.tomorrow}</Badge>;
  }
  if (days <= 7) {
    return (
      <Badge tone="point" title={day}>
        {words.board.due.inDays(days)}
      </Badge>
    );
  }
  return <Badge tone="neutral">{words.board.due.on(day)}</Badge>;
}

/** How far a goal is, read from its tasks: the done ones, the ones at work, and the rest. */
export function ProgressBar(props: { readonly counts: RestTaskCounts }) {
  const words = useWords();
  const { counts } = props;
  const total = counts.idea + counts.ready + counts.in_progress + counts.in_review + counts.done;
  const working = counts.in_progress + counts.in_review;
  const share = (count: number) => (total === 0 ? 0 : (count / total) * 100);
  return (
    <div className="sc-progress">
      <div
        className="sc-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={counts.done}
        aria-label={words.roadmap.progress(counts.done, total)}
      >
        <span className="sc-progress-done" style={{ width: `${share(counts.done)}%` }} />
        <span className="sc-progress-working" style={{ width: `${share(working)}%` }} />
      </div>
      <span className="sc-progress-words">
        {words.roadmap.progress(counts.done, total)}
        {working > 0 && ` · ${words.roadmap.inProgress(working)}`}
      </span>
    </div>
  );
}

/** A day as people read one, in the language of the page. */
export function Day(props: { readonly day: string }) {
  const { tag } = useLanguage();
  return (
    <time className="sc-time" dateTime={props.day}>
      {formatDay(props.day, tag)}
    </time>
  );
}

export function Spinner(props: { readonly label: string }) {
  return (
    <span className="sc-spinner" role="status">
      <span className="sc-spinner-ring" aria-hidden="true" />
      <span className="sc-visually-hidden">{props.label}</span>
    </span>
  );
}

/** Where there is nothing yet, said plainly, with the way to the first thing. */
export function EmptyState(props: {
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="sc-empty">
      <p className="sc-empty-title">{props.title}</p>
      {props.body !== undefined && <p className="sc-empty-body">{props.body}</p>}
      {props.action !== undefined && <div className="sc-empty-action">{props.action}</div>}
    </div>
  );
}

/** An instant as people read one in a language: the date, and the time of day. */
export function formatInstant(iso: string, language?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A size in bytes as people read one: `12 B`, `3.4 KB`, `120 MB`. */
export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const kb = size / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function Time(props: {
  readonly iso: string;
  /** `day` shows the day alone, with the moment as the title, where a row has no room for the hour. */
  readonly precision?: "minute" | "day";
}) {
  const { tag } = useLanguage();
  const full = formatInstant(props.iso, tag);
  if (props.precision === "day") {
    const date = new Date(props.iso);
    return (
      <time className="sc-time" dateTime={props.iso} title={full}>
        {Number.isNaN(date.getTime()) ? props.iso : formatDay(dayOf(date), tag)}
      </time>
    );
  }
  return (
    <time className="sc-time" dateTime={props.iso}>
      {full}
    </time>
  );
}
