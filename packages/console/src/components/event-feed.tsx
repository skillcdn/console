import type { ReactNode } from "react";
import type { RestEvent } from "../api.js";
import { en, type Messages } from "../i18n/en.js";
import { useWords } from "../i18n/index.js";
import { PersonChip, Time } from "./ui.js";

// The feed: one line per event, newest first, as a sentence a person reads at a glance: who,
// as which agent when through one, and what. It takes its data as props and nothing from the
// network; the sentence is the language's (ADR-0012).

/** What an event says, without its actor: the words after the name, in the words given. */
export function describeEvent(event: RestEvent, words: Messages = en): string {
  const { data } = event;
  const { feed, vocabulary } = words;
  const task =
    data.number === undefined
      ? feed.aTask
      : `#${data.number}${data.title === undefined ? "" : ` ${data.title}`}`;
  const project = data.name ?? data.key ?? feed.aProject;
  const changed = (data.fields ?? []).map((field) => feed.field[field] ?? field);
  const fields = changed.length === 0 ? feed.something : changed.join(", ");
  const page = feed.thePage(data.title ?? data.path ?? "");
  const role = (value: string | undefined): string =>
    value === "admin"
      ? feed.role.admin
      : value === "owner"
        ? feed.role.owner
        : value === "member"
          ? feed.role.member
          : feed.role.other;
  const login = data.login ?? feed.someone;
  const question = data.question ?? feed.aQuestion;
  switch (event.kind) {
    case "person.joined":
      return feed.event.personJoined();
    case "person.role_changed":
      return feed.event.roleChanged(login, role(data.role));
    case "project.created":
      return feed.event.projectCreated(project);
    case "project.updated":
      return feed.event.projectUpdated(fields, project);
    case "project.member_added":
      return feed.event.memberAdded(login, project, role(data.role));
    case "project.member_changed":
      return feed.event.memberChanged(login, role(data.role), project);
    case "project.member_removed":
      return feed.event.memberRemoved(login, project);
    case "task.created":
      return feed.event.taskCreated(task);
    case "task.moved":
      return feed.event.taskMoved(
        task,
        vocabulary.state[data.from ?? "idea"],
        vocabulary.state[data.to ?? "idea"],
      );
    case "task.updated":
      return feed.event.taskUpdated(fields, task);
    case "decision.raised":
      return feed.event.decisionRaised(question);
    case "decision.answered":
      return feed.event.decisionAnswered(question, data.option ?? "");
    case "decision.updated":
      return feed.event.decisionUpdated(fields, data.question ?? "");
    case "run.started":
      return feed.event.runStarted(task);
    case "run.reported":
      return feed.event.runReported(task, data.excerpt);
    case "run.handed_in":
      return feed.event.runHandedIn(data.label ?? feed.something, task);
    case "run.ended":
      return data.status === "finished"
        ? feed.event.runFinished(task)
        : data.status === "failed"
          ? feed.event.runFailed(task)
          : feed.event.runAbandoned(task);
    case "document.written":
      return feed.event.documentWritten(page, data.version);
    case "document.archived":
      return feed.event.documentArchived(page);
    case "document.restored":
      return feed.event.documentRestored(page);
    case "document.file_attached":
      return feed.event.fileAttached(data.label ?? feed.aFile, page);
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
  const words = useWords();
  if (props.events.length === 0) {
    return <div className="sc-feed">{props.empty ?? null}</div>;
  }
  const newestFirst = [...props.events].reverse();
  return (
    <ol className="sc-feed" aria-label={words.feed.list}>
      {newestFirst.map((event) => {
        const href = props.href?.(event);
        const said = describeEvent(event, words);
        return (
          <li key={event.id} className="sc-feed-item">
            <span className="sc-feed-actor">
              {event.actor === null ? (
                <span className="sc-person-login">{words.feed.console}</span>
              ) : (
                <PersonChip person={event.actor} />
              )}
              {event.agent !== null && (
                <span className="sc-feed-agent" title={words.feed.asTitle}>
                  {words.feed.as(event.agent)}
                </span>
              )}
            </span>
            <span className="sc-feed-words">
              {href === undefined ? said : <a href={href}>{said}</a>}
            </span>
            <Time iso={event.createdAt} />
          </li>
        );
      })}
    </ol>
  );
}
