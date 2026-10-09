import type { RestDecision, RestEvent, RestPerson, RestTask } from "@skillcdn/console/api";
import type { DecisionRecord } from "../db/queries/decisions.js";
import type { EventRecord } from "../db/queries/events.js";
import type { PersonRecord } from "../db/queries/people.js";
import type { TaskRecord } from "../db/queries/tasks.js";

// What the records of the database are on the wire. The shapes are the package's; this is the
// one place they are built, so that the server and its tests agree with the schemas. Absent
// values are `null`, never missing keys.

export function restPerson(person: PersonRecord): RestPerson {
  return {
    id: person.id,
    login: person.login,
    name: person.name ?? null,
    avatar: person.avatarUrl ?? null,
  };
}

export function restTask(task: TaskRecord): RestTask {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    body: task.body,
    state: task.state,
    priority: task.priority,
    owner: restPerson(task.owner),
    assignee: task.assignee === undefined ? null : restPerson(task.assignee),
    parentId: task.parentId ?? null,
    links: task.links.map((link) => ({ url: link.url, label: link.label ?? null })),
    openDecisions: task.openDecisions,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function restDecision(decision: DecisionRecord): RestDecision {
  return {
    id: decision.id,
    question: decision.question,
    body: decision.body,
    options: decision.options.map((option) => ({ id: option.id, label: option.label })),
    taskId: decision.taskId ?? null,
    raisedBy: restPerson(decision.raisedBy),
    answer:
      decision.answer === undefined
        ? null
        : {
            option: decision.answer.option,
            note: decision.answer.note ?? null,
            by: restPerson(decision.answer.by),
            at: decision.answer.at.toISOString(),
          },
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}

export function restEvent(event: EventRecord): RestEvent {
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actor === undefined ? null : restPerson(event.actor),
    taskId: event.taskId ?? null,
    decisionId: event.decisionId ?? null,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
  };
}
