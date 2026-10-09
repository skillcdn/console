import type {
  RestDecision,
  RestEvent,
  RestMember,
  RestPerson,
  RestProject,
  RestRun,
  RestTask,
  RestToken,
} from "@skillcdn/console/api";
import type { DecisionRecord } from "../db/queries/decisions.js";
import type { EventRecord } from "../db/queries/events.js";
import type { PersonRecord } from "../db/queries/people.js";
import type { MemberRecord, ProjectView } from "../db/queries/projects.js";
import type { RunRecord } from "../db/queries/runs.js";
import type { TaskRecord } from "../db/queries/tasks.js";
import type { TokenRecord } from "../db/queries/tokens.js";

// What the records of the database are on the wire. The shapes are the package's; this is the
// one place they are built, so that the server and its tests agree with the schemas. Absent
// values are `null`, never missing keys.

export function restPerson(person: PersonRecord): RestPerson {
  return {
    id: person.id,
    login: person.login,
    name: person.name ?? null,
    avatar: person.avatarUrl ?? null,
    role: person.role,
  };
}

/** A project as the asker sees it: with what they are in it, and what waits in it. */
export function restProject(project: ProjectView): RestProject {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    skillsAddress: project.skillsAddress ?? null,
    role: project.role,
    openDecisions: project.openDecisions,
    openRuns: project.openRuns,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function restMember(member: MemberRecord): RestMember {
  return {
    person: restPerson(member.person),
    role: member.role,
    addedAt: member.addedAt.toISOString(),
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
    openRuns: task.openRuns,
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
    taskNumber: decision.taskNumber ?? null,
    raisedBy: restPerson(decision.raisedBy),
    run: decision.run === undefined ? null : { id: decision.run.id, agent: decision.run.agent },
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

/** A token as its person's page lists it: never the secret, which is answered once and not kept. */
export function restToken(token: TokenRecord): RestToken {
  return {
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  };
}

export function restRun(run: RunRecord): RestRun {
  return {
    id: run.id,
    taskId: run.taskId,
    taskNumber: run.taskNumber,
    person: restPerson(run.person),
    agent: run.agent,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    summary: run.summary ?? null,
    reports: run.reports.map((report) => ({
      id: report.id,
      body: report.body,
      createdAt: report.createdAt.toISOString(),
    })),
    artifacts: run.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      url: artifact.url ?? null,
      label: artifact.label ?? null,
      file:
        artifact.file === undefined
          ? null
          : {
              name: artifact.file.name,
              size: artifact.file.size,
              contentType: artifact.file.contentType,
              sha256: artifact.file.sha256,
            },
      createdAt: artifact.createdAt.toISOString(),
    })),
    waitingFor: run.waitingFor ?? null,
  };
}

export function restEvent(event: EventRecord): RestEvent {
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actor === undefined ? null : restPerson(event.actor),
    agent: event.agent ?? null,
    projectId: event.projectId ?? null,
    taskId: event.taskId ?? null,
    decisionId: event.decisionId ?? null,
    runId: event.runId ?? null,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
  };
}
