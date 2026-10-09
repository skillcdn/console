import type { ReactNode } from "react";
import type { RestEvent } from "../api.js";
import { PersonChip, STATE_LABELS, Time } from "./ui.js";

// The feed: one line per event, newest first, as a sentence a person reads at a glance: who,
// as which agent when through one, and what. It takes its data as props and nothing from the
// network.

const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: "the title",
  body: "the body",
  priority: "the priority",
  assigneeId: "the assignee",
  parentId: "what it is part of",
  links: "the links",
  name: "the name",
  description: "the description",
  visibility: "who is a member",
  skillsAddress: "the skills address",
};

const roleWords = (role: string | undefined): string =>
  role === "admin"
    ? "an administrator"
    : role === "owner"
      ? "an owner"
      : role === "member"
        ? "a member"
        : "something";

/** What an event says, without its actor: the words after the name. */
export function describeEvent(event: RestEvent): string {
  const { data } = event;
  const task =
    data.number === undefined
      ? "a task"
      : `#${data.number}${data.title === undefined ? "" : ` ${data.title}`}`;
  const project = data.name ?? data.key ?? "a project";
  const fields = (data.fields ?? []).map((field) => FIELD_WORDS[field] ?? field);
  switch (event.kind) {
    case "person.joined":
      return "joined the board";
    case "person.role_changed":
      return `made ${data.login ?? "someone"} ${roleWords(data.role)}`;
    case "project.created":
      return `made the project ${project}`;
    case "project.updated":
      return `changed ${fields.length === 0 ? "something" : fields.join(", ")} of the project ${project}`;
    case "project.member_added":
      return `added ${data.login ?? "someone"} to ${project} as ${roleWords(data.role)}`;
    case "project.member_changed":
      return `made ${data.login ?? "someone"} ${roleWords(data.role)} of ${project}`;
    case "project.member_removed":
      return `removed ${data.login ?? "someone"} from ${project}`;
    case "task.created":
      return `wrote ${task}`;
    case "task.moved":
      return `moved ${task} from ${STATE_LABELS[data.from ?? "idea"]} to ${STATE_LABELS[data.to ?? "idea"]}`;
    case "task.updated":
      return `changed ${fields.length === 0 ? "something" : fields.join(", ")} of ${task}`;
    case "decision.raised":
      return `asked: ${data.question ?? "a question"}`;
    case "decision.answered":
      return `answered "${data.question ?? "a question"}": ${data.option ?? ""}`;
    case "run.started":
      return `started on ${task}`;
    case "run.reported":
      return `reported on ${task}${data.excerpt === undefined ? "" : `: ${data.excerpt}`}`;
    case "run.handed_in":
      return `handed in ${data.label ?? "something"} on ${task}`;
    case "run.ended":
      return `${data.status === "finished" ? "finished" : data.status === "failed" ? "failed on" : "gave up on"} ${task}`;
  }
}

export interface EventFeedProps {
  /** Oldest first, as the API hands them over; the feed shows them newest first. */
  readonly events: readonly RestEvent[];
  /** Where the line of an event leads, when it is about a task or a decision. */
  readonly href?: ((event: RestEvent) => string | undefined) | undefined;
  readonly empty?: ReactNode;
}

export function EventFeed(props: EventFeedProps) {
  if (props.events.length === 0) {
    return <div className="sc-feed">{props.empty ?? null}</div>;
  }
  const newestFirst = [...props.events].reverse();
  return (
    <ol className="sc-feed" aria-label="What happened">
      {newestFirst.map((event) => {
        const href = props.href?.(event);
        const words = describeEvent(event);
        return (
          <li key={event.id} className="sc-feed-item">
            <span className="sc-feed-actor">
              {event.actor === null ? (
                <span className="sc-person-login">The console</span>
              ) : (
                <PersonChip person={event.actor} />
              )}
              {event.agent !== null && (
                <span className="sc-feed-agent" title="The agent the person acted through">
                  as {event.agent}
                </span>
              )}
            </span>
            <span className="sc-feed-words">
              {href === undefined ? words : <a href={href}>{words}</a>}
            </span>
            <Time iso={event.createdAt} />
          </li>
        );
      })}
    </ol>
  );
}
