import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PersonRole, RestPerson, TaskPriority, TaskState } from "../api.js";

// Small building blocks. Each one is a class in styles/console.css and nothing more. Classes
// are prefixed `sc-` so that a custom console's own styles never collide with them.

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

/**
 * A person's picture as the git host serves it: loaded lazily, without a referrer, and gone as
 * a whole when there is none or it cannot be loaded, leaving the initial of the login instead.
 */
export function Avatar(props: { readonly person: RestPerson; readonly size?: "sm" | "md" | "lg" }) {
  const size = props.size ?? "md";
  const initial = props.person.login.slice(0, 1).toUpperCase();
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

/** A person, as a picture and a name, wherever one is named. */
export function PersonChip(props: { readonly person: RestPerson; readonly size?: "sm" | "md" }) {
  return (
    <span className="sc-person" title={props.person.name ?? props.person.login}>
      <Avatar person={props.person} size={props.size ?? "sm"} />
      <span className="sc-person-login">{props.person.login}</span>
    </span>
  );
}

/** The words of the vocabulary as people read them. */
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
  return (
    <Badge tone={props.role === "admin" ? "point" : "neutral"}>{ROLE_LABELS[props.role]}</Badge>
  );
}

export function StateBadge(props: { readonly state: TaskState }) {
  const tone =
    props.state === "done"
      ? "success"
      : props.state === "dropped"
        ? "neutral"
        : props.state === "in_progress" || props.state === "in_review"
          ? "accent"
          : "neutral";
  return <Badge tone={tone}>{STATE_LABELS[props.state]}</Badge>;
}

export function PriorityBadge(props: { readonly priority: TaskPriority }) {
  if (props.priority === "normal") {
    return null;
  }
  const tone =
    props.priority === "urgent" ? "danger" : props.priority === "high" ? "point" : "neutral";
  return <Badge tone={tone}>{PRIORITY_LABELS[props.priority]}</Badge>;
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

/** An instant as people read one: the date, and the time of day. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
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

export function Time(props: { readonly iso: string }) {
  return (
    <time className="sc-time" dateTime={props.iso}>
      {formatInstant(props.iso)}
    </time>
  );
}
