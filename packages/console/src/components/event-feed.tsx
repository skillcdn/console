import type { ReactNode } from "react";
import { agentLabel, type RestEvent } from "../api.js";
import { dayOf } from "../dates.js";
import { en, type Messages } from "../i18n/en.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { ShowMore, usePaged } from "./paged.js";
import { formatInstant, PersonChip } from "./ui.js";

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
  const goal = data.title ?? feed.aGoal;
  const category = data.name ?? data.key ?? feed.aCategory;
  switch (event.kind) {
    case "person.joined":
      return feed.event.personJoined();
    case "person.role_changed":
      return feed.event.roleChanged(login, role(data.role));
    case "person.listed":
      return feed.event.personListed(login);
    case "person.unlisted":
      return feed.event.personUnlisted(login);
    case "person.deactivated":
      return feed.event.personDeactivated(login);
    case "person.reactivated":
      return feed.event.personReactivated(login);
    case "workspace.updated":
      return feed.event.workspaceUpdated(fields);
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
    case "category.created":
      return feed.event.categoryCreated(category);
    case "category.updated":
      return feed.event.categoryUpdated(fields, category);
    case "category.removed":
      return feed.event.categoryRemoved(category);
    case "goal.created":
      return feed.event.goalCreated(goal);
    case "goal.updated":
      return feed.event.goalUpdated(fields, goal);
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
    case "task.commented":
      return feed.event.taskCommented(task, data.excerpt);
    case "task.archived":
      return feed.event.taskArchived(task);
    case "task.restored":
      return feed.event.taskRestored(task);
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
    case "run.taken_over":
      return feed.event.runTakenOver(task, data.agent ?? feed.someone);
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

/** The day an event fell on, by this machine's clock, as the calendar spells a day. */
function dayOfEvent(event: RestEvent): string {
  const date = new Date(event.createdAt);
  return Number.isNaN(date.getTime()) ? event.createdAt : dayOf(date);
}

/** A day as the feed heads it: the weekday and the date, with the year where it is not this one. */
function formatFeedDay(day: string, language: string, now: Date = new Date()): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return day;
  }
  return date.toLocaleDateString(language, {
    weekday: "short",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Whether two events were done by the same person as the same agent, so the name is said once. */
function sameHands(a: RestEvent, b: RestEvent): boolean {
  return (a.actor?.id ?? null) === (b.actor?.id ?? null) && a.agent === b.agent;
}

/** The hour of an event, for a row whose day is in the heading above it. */
function formatClock(iso: string, language: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

type FeedRun = { readonly actor: RestEvent; readonly events: RestEvent[] };
type FeedDay = { readonly day: string; readonly runs: FeedRun[] };

/** The events by the day they fell on, and within a day by runs of the same hands; newest first. */
function groupFeed(events: readonly RestEvent[]): FeedDay[] {
  const days: FeedDay[] = [];
  for (const event of events) {
    const day = dayOfEvent(event);
    let last = days[days.length - 1];
    if (last === undefined || last.day !== day) {
      last = { day, runs: [] };
      days.push(last);
    }
    const run = last.runs[last.runs.length - 1];
    if (run !== undefined && sameHands(run.actor, event)) {
      run.events.push(event);
    } else {
      last.runs.push({ actor: event, events: [event] });
    }
  }
  return days;
}

export function EventFeed(props: EventFeedProps) {
  const words = useWords();
  const { tag } = useLanguage();
  const newestFirst = [...props.events].reverse();
  const { shown, rest, more } = usePaged(newestFirst);
  if (props.events.length === 0) {
    return <div className="sc-feed">{props.empty ?? null}</div>;
  }
  return (
    <>
      <section className="sc-feed" aria-label={words.feed.list}>
        {groupFeed(shown).map((group) => (
          <section key={group.day} className="sc-feed-day">
            <h3 className="sc-feed-day-title">
              <time dateTime={group.day}>{formatFeedDay(group.day, tag)}</time>
            </h3>
            <ol className="sc-feed-day-list">
              {group.runs.map((run) => (
                <li key={run.actor.id} className="sc-feed-run">
                  <span className="sc-feed-actor">
                    {run.actor.actor === null ? (
                      <span className="sc-person-login">{words.feed.console}</span>
                    ) : (
                      <PersonChip person={run.actor.actor} />
                    )}
                    {run.actor.agent !== null && (
                      <span
                        className="sc-feed-agent"
                        title={
                          agentLabel(run.actor.agent) === run.actor.agent
                            ? words.feed.asTitle
                            : run.actor.agent
                        }
                      >
                        {words.feed.as(agentLabel(run.actor.agent))}
                      </span>
                    )}
                  </span>
                  <ol className="sc-feed-run-list">
                    {run.events.map((event) => {
                      const href = props.href?.(event);
                      const said = describeEvent(event, words);
                      return (
                        <li key={event.id} className="sc-feed-item">
                          <time
                            className="sc-time sc-feed-clock"
                            dateTime={event.createdAt}
                            title={formatInstant(event.createdAt, tag)}
                          >
                            {formatClock(event.createdAt, tag)}
                          </time>
                          <span className="sc-feed-words">
                            {href === undefined ? said : <a href={href}>{said}</a>}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </section>
      <ShowMore rest={rest} onMore={more} />
    </>
  );
}
