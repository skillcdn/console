import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";
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
import { AVATAR_SETS, type AvatarSet, avatarDataUrl } from "../avatar.js";
import { dayOf, daysBetween, formatDay, today } from "../dates.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { useRemotePictureSrc } from "./remote-pictures.js";

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
  /** What the badge says, which the stylesheet shows in how it is filled: a state is a soft fill, a priority dark words on one, a due day a line and bold words, a count figures. */
  readonly kind?: "state" | "priority" | "due" | "count" | undefined;
  /**
   * What the badge names is at work this moment: a dot of its hue before its words, a ring spreading
   * slowly from it, and a dot that stands still for whoever asked their device for less motion.
   */
  readonly live?: boolean | undefined;
  /** A class of the badge's own beside the tone's and the kind's, for a step within a kind. */
  readonly className?: string | undefined;
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "sc-badge",
        `sc-badge-${props.tone ?? "neutral"}`,
        props.kind !== undefined && `sc-badge-kind-${props.kind}`,
        props.live === true && "sc-badge-live",
        props.className,
      )}
      title={props.title}
    >
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
 * The sets the avatars of agent accounts are drawn from (ADR-0084, ADR-0097): the package's,
 * unless a console built on it brings its own (`createConsole`'s `persona.avatarSets`).
 */
export const AvatarSetsContext = createContext<readonly AvatarSet[]>(AVATAR_SETS);

/**
 * How many pixels a side an avatar is drawn with at each size of a picture: about twice what the
 * stylesheet gives it, so that it is sharp on a dense screen, and no more, since a picture is
 * drawn in the page.
 */
const AVATAR_PIXELS = { xs: 32, sm: 48, md: 72, lg: 128, xl: 224 } as const;
export type AvatarSize = keyof typeof AVATAR_PIXELS;

/**
 * An agent account's avatar, drawn from its parts where it is shown (ADR-0084, ADR-0097): a
 * picture this page draws itself, pixel by pixel, from the numbers alone, and never one fetched
 * or markup from anywhere. Cut as a soft square, where a person's picture is round, so that an
 * agent account is told from a person at a glance. Sized by `className`, as a picture is;
 * `size` says how finely it is drawn.
 */
export function AvatarPicture(props: {
  readonly parts: NonNullable<RestPerson["avatarParts"]>;
  readonly className?: string | undefined;
  readonly size?: AvatarSize | undefined;
}) {
  const sets = useContext(AvatarSetsContext);
  const pixels = AVATAR_PIXELS[props.size ?? "lg"];
  return (
    <img
      className={cx("sc-avatar-drawn", props.className)}
      src={avatarDataUrl(props.parts, pixels, sets)}
      width={pixels}
      height={pixels}
      alt=""
      decoding="async"
      draggable={false}
    />
  );
}

/**
 * A member's picture. A person's is as the git host serves it, read through the console
 * (ADR-0048): loaded lazily, without a referrer, and gone as a whole when there is none or it
 * cannot be loaded, leaving the initial of the name instead. An agent account's is drawn from
 * its parts (ADR-0084).
 */
export function Avatar(props: { readonly person: RestPerson; readonly size?: AvatarSize }) {
  const remote = useRemotePictureSrc();
  const size = props.size ?? "md";
  const initial = personName(props.person).slice(0, 1).toUpperCase();
  const parts = props.person.avatarParts ?? undefined;
  const src = props.person.avatar === null ? undefined : remote(props.person.avatar);
  // A picture that would not load gives way to the initial, and never to a broken image.
  const [failed, setFailed] = useState<string | undefined>(undefined);
  if (parts !== undefined) {
    return (
      <AvatarPicture parts={parts} size={size} className={cx("sc-avatar", `sc-avatar-${size}`)} />
    );
  }
  if (src === undefined || src === failed) {
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
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
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

/**
 * What a member is, where it is no person: a mark of two letters after the name, wherever a
 * member is named short, a worker, a decider, an owner, a manager, so that an agent account is
 * told from a person where its picture is small. What the letters stand for is there on hover.
 * Nothing for a person: most members are people, and a mark on each would say nothing.
 */
export function KindMark(props: {
  readonly person: { readonly kind?: RestPerson["kind"] | undefined };
}) {
  const words = useWords().people.kindMark;
  if (props.person.kind !== "agent") {
    return null;
  }
  return (
    <span className="sc-kind-mark" title={words.agentTitle}>
      {words.agent}
    </span>
  );
}

/**
 * A member, as a picture and their name, wherever one is named; the login is there on hover, and
 * an agent account carries its mark after the name.
 */
export function PersonChip(props: { readonly person: RestPerson; readonly size?: "sm" | "md" }) {
  return (
    <span className="sc-person" title={props.person.login}>
      <Avatar person={props.person} size={props.size ?? "sm"} />
      <span className="sc-person-login">{personName(props.person)}</span>
      <KindMark person={props.person} />
    </span>
  );
}

/**
 * A person among others to choose from, where there is room for a second line: the picture, the
 * name, and under it what they do (ADR-0084), or their login where no title says.
 */
export function PersonOption(props: { readonly person: RestPerson }) {
  const { person } = props;
  const title = person.title ?? "";
  const handle = typeof person.handle === "string" ? `@${person.handle}` : person.login;
  return (
    <span className="sc-person sc-person-option" title={person.login}>
      <Avatar person={person} size="sm" />
      <span className="sc-person-option-who">
        <span className="sc-person-option-name">
          <span className="sc-person-login">{personName(person)}</span>
          <KindMark person={person} />
        </span>
        <span className="sc-person-option-note">{title === "" ? handle : title}</span>
      </span>
    </span>
  );
}

/**
 * A thing named among others in a row (`sc-chips`): a person (a `PersonChip` inside), a team, an
 * item of a list, a holder of a role. Given `onRemove`, it carries the way to take it out, named
 * for a screen reader by `removeLabel`; left out, the chip is read, not changed. Every row of
 * things a person adds to and takes from is made of these, so that they read alike everywhere.
 */
export function Chip(props: {
  readonly children: ReactNode;
  readonly onRemove?: (() => void) | undefined;
  /** What the way out says to a screen reader: the word for removing, and what the chip names. */
  readonly removeLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  /** A class of the chip's own beside `sc-chip`. */
  readonly className?: string | undefined;
}) {
  const words = useWords().common;
  return (
    <span className={cx("sc-chip", props.className)} title={props.title}>
      <span className="sc-chip-label">{props.children}</span>
      {props.onRemove !== undefined && (
        <button
          type="button"
          className="sc-chip-remove"
          aria-label={props.removeLabel ?? words.remove}
          title={props.removeLabel ?? words.remove}
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </span>
  );
}

/** How many of a task's workers are shown as pictures before the rest are a count. */
const WORKERS_SHOWN = 3;

/** The people at work on a task (ADR-0037), as pictures side by side with a count of the rest; nothing while nobody is. */
export function Workers(props: {
  readonly workers: readonly RestPerson[];
  readonly size?: "xs" | "sm";
  /** How many are shown as pictures; the rest are a count. */
  readonly shown?: number;
}) {
  const mark = useWords().people.kindMark.agent;
  if (props.workers.length === 0) {
    return null;
  }
  const shown = props.shown ?? WORKERS_SHOWN;
  const rest = props.workers.length - shown;
  // Pictures alone say little of who is an agent account: the names on hover say it.
  const names = props.workers
    .map((worker) => `${personName(worker)}${worker.kind === "agent" ? ` (${mark})` : ""}`)
    .join(", ");
  return (
    <span className="sc-workers" title={names}>
      {props.workers.slice(0, shown).map((worker) => (
        <Avatar key={worker.id} person={worker} size={props.size ?? "sm"} />
      ))}
      {rest > 0 && <span className="sc-workers-more">+{rest}</span>}
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
    <Badge tone={props.role === "admin" ? "accent" : "neutral"}>
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
  return (
    <Badge tone={tone} kind="state">
      {words.vocabulary.state[props.state]}
    </Badge>
  );
}

export function PriorityBadge(props: { readonly priority: TaskPriority }) {
  const words = useWords();
  if (props.priority === "normal") {
    return null;
  }
  const tone =
    props.priority === "urgent" ? "danger" : props.priority === "high" ? "point" : "neutral";
  return (
    <Badge tone={tone} kind="priority">
      {words.vocabulary.priority[props.priority]}
    </Badge>
  );
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
  return (
    <Badge tone={tone} kind="state">
      {words.vocabulary.goalState[props.state]}
    </Badge>
  );
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
    return (
      <Badge tone="neutral" kind="due">
        {words.board.due.on(day)}
      </Badge>
    );
  }
  if (days < 0) {
    return (
      <Badge tone="danger" kind="due" title={day}>
        {words.board.due.overdue(-days)}
      </Badge>
    );
  }
  if (days === 0) {
    return (
      <Badge tone="point" kind="due" className="sc-badge-due-today">
        {words.board.due.today}
      </Badge>
    );
  }
  if (days === 1) {
    return (
      <Badge tone="point" kind="due">
        {words.board.due.tomorrow}
      </Badge>
    );
  }
  if (days <= 7) {
    return (
      <Badge tone="warning" kind="due" title={day}>
        {words.board.due.inDays(days)}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" kind="due">
      {words.board.due.on(day)}
    </Badge>
  );
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
  /**
   * `day` shows the day alone, with the moment as the title, where a row has no room for the hour;
   * `clock` the hour alone for a moment of today and the day with the hour for another, with the
   * whole moment as the title, where moments follow one another down a log.
   */
  readonly precision?: "minute" | "day" | "clock";
  /** For `clock`: the moment whose day the hour alone is read against; now, where none is given. */
  readonly against?: string | undefined;
}) {
  const { tag } = useLanguage();
  const full = formatInstant(props.iso, tag);
  if (props.precision === "clock") {
    const date = new Date(props.iso);
    if (Number.isNaN(date.getTime())) {
      return <time className="sc-time">{props.iso}</time>;
    }
    const shown = date.toLocaleString(
      tag,
      dayOf(date) === dayOf(props.against === undefined ? new Date() : new Date(props.against))
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    );
    return (
      <time className="sc-time" dateTime={props.iso} title={full}>
        {shown}
      </time>
    );
  }
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

/** A link that reads as a button: where a form is, for instance. */
export function LinkButton(props: {
  readonly href: string;
  readonly variant?: "primary" | "secondary";
  readonly children: ReactNode;
}) {
  return (
    <a className={`sc-button sc-button-${props.variant ?? "secondary"}`} href={props.href}>
      {props.children}
    </a>
  );
}
