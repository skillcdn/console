import type {
  RestAgent,
  RestCategory,
  RestComment,
  RestDecision,
  RestDecisionBrief,
  RestDocument,
  RestDocumentFile,
  RestDocumentSummary,
  RestEvent,
  RestGoal,
  RestListing,
  RestMember,
  RestPerson,
  RestProject,
  RestRules,
  RestRun,
  RestSession,
  RestTask,
  RestTaskBrief,
  RestTeam,
  RestToken,
  RestVersion,
  RestVersionSummary,
} from "@skillcdn/console/api";
import type { SessionView } from "../auth/sessions.js";
import { describeUserAgent } from "../auth/user-agent.js";
import type { AgentRecord } from "../db/queries/agents.js";
import type { CategoryRecord } from "../db/queries/categories.js";
import type { CommentRecord } from "../db/queries/comments.js";
import type { DecisionRecord } from "../db/queries/decisions.js";
import type {
  DocumentFileRecord,
  DocumentRecord,
  DocumentSummary,
  VersionRecord,
  VersionSummary,
} from "../db/queries/documents.js";
import type { EventRecord } from "../db/queries/events.js";
import type { GoalRecord } from "../db/queries/goals.js";
import { isInvited, type ListingRecord, type PersonRecord } from "../db/queries/people.js";
import type { MemberRecord, ProjectView } from "../db/queries/projects.js";
import type { RulesRecord } from "../db/queries/rules.js";
import type { RunRecord } from "../db/queries/runs.js";
import type { TaskRecord } from "../db/queries/tasks.js";
import type { TeamRecord } from "../db/queries/teams.js";
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
    status: person.status,
    source: person.source,
    deactivatedAt: person.deactivatedAt?.toISOString() ?? null,
    managerId: person.managerId ?? null,
    language: person.language ?? null,
    kind: person.kind,
    handle: person.handle ?? null,
    title: person.title ?? null,
    avatarParts: person.avatarParts ?? null,
    // Said only of an agent account nobody has signed in with yet (ADR-0084).
    ...(isInvited(person) ? { invited: true } : {}),
  };
}

/** An agent account (ADR-0084): the member it is, and whom it reports to, where the asker may see them. */
export function restAgent(agent: AgentRecord): RestAgent {
  return {
    person: restPerson(agent.person),
    manager: agent.manager === undefined ? null : restPerson(agent.manager),
    supervised: agent.supervised,
  };
}

/**
 * A person with their work email: for an administrator, for the person themselves, and for a
 * plugin with `people:read:email`; everyone else reads `restPerson`, which carries none.
 */
export function restPersonWithEmail(person: PersonRecord): RestPerson {
  return { ...restPerson(person), email: person.email ?? null };
}

/** A team (ADR-0073), with the members among `visible`, or every member where nobody narrows the reading. */
export function restTeam(team: TeamRecord, visible?: ReadonlySet<string>): RestTeam {
  return {
    id: team.id,
    key: team.key,
    name: team.name,
    memberIds:
      visible === undefined ? [...team.memberIds] : team.memberIds.filter((id) => visible.has(id)),
    createdAt: team.createdAt.toISOString(),
  };
}

/** A login let in that nobody has signed in with yet (ADR-0022). */
export function restListing(listing: ListingRecord): RestListing {
  return {
    id: listing.id,
    host: listing.host,
    login: listing.login,
    createdAt: listing.createdAt.toISOString(),
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
    color: project.color ?? null,
    symbol: project.symbol ?? null,
    icon: project.icon ?? null,
    packToken:
      project.packToken === undefined ? null : { setAt: project.packToken.setAt.toISOString() },
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
    listed: member.listed,
  };
}

export function restCategory(category: CategoryRecord): RestCategory {
  return {
    key: category.key,
    name: category.name,
    color: category.color,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function restGoal(goal: GoalRecord): RestGoal {
  return {
    id: goal.id,
    title: goal.title,
    body: goal.body,
    state: goal.state,
    category: goal.category ?? null,
    startsOn: goal.startsOn ?? null,
    dueOn: goal.dueOn ?? null,
    createdBy: restPerson(goal.createdBy),
    agent: goal.agent ?? null,
    taskCounts: goal.taskCounts,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
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
    plugin: task.plugin ?? null,
    agent: task.agent ?? null,
    workers: task.workers.map(restPerson),
    parentId: task.parentId ?? null,
    category: task.category ?? null,
    goalId: task.goalId ?? null,
    startsOn: task.startsOn ?? null,
    dueOn: task.dueOn ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    doneAt: task.doneAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    links: task.links.map((link) => ({ url: link.url, label: link.label ?? null })),
    openDecisions: task.openDecisions,
    openRuns: task.openRuns,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** A task as the plate's page asks for it (`brief=true`): everything but its body. */
export function restTaskBrief(task: TaskRecord): RestTaskBrief {
  const { body: _body, ...brief } = restTask(task);
  return brief;
}

/** A decision as the plate's page asks for it (`brief=true`): everything but its body. */
export function restDecisionBrief(decision: DecisionRecord): RestDecisionBrief {
  const { body: _body, ...brief } = restDecision(decision);
  return brief;
}

export function restDecision(decision: DecisionRecord): RestDecision {
  return {
    id: decision.id,
    question: decision.question,
    body: decision.body,
    options: decision.options.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.key === undefined ? {} : { key: option.key }),
      ...(option.own === true ? { own: true as const } : {}),
    })),
    taskId: decision.taskId ?? null,
    taskNumber: decision.taskNumber ?? null,
    raisedBy: restPerson(decision.raisedBy),
    decider: restPerson(decision.decider),
    deciders: decision.deciders.map(restPerson),
    run: decision.run === undefined ? null : { id: decision.run.id, agent: decision.run.agent },
    plugin: decision.plugin ?? null,
    answer:
      decision.answer === undefined
        ? null
        : {
            option: decision.answer.option,
            note: decision.answer.note ?? null,
            by: restPerson(decision.answer.by),
            at: decision.answer.at.toISOString(),
            agent: decision.answer.agent ?? null,
          },
    outcome: decision.outcome ?? null,
    outcomeBy: decision.outcomeBy === undefined ? null : restPerson(decision.outcomeBy),
    outcomeAgent: decision.outcomeAgent ?? null,
    outcomeAt: decision.outcomeAt?.toISOString() ?? null,
    files: decision.files.map((attached) => ({
      id: attached.id,
      file: {
        name: attached.file.name,
        size: attached.file.size,
        contentType: attached.file.contentType,
        sha256: attached.file.sha256,
      },
    })),
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}

export function restComment(comment: CommentRecord): RestComment {
  return {
    id: comment.id,
    taskId: comment.taskId,
    author: restPerson(comment.author),
    agent: comment.agent ?? null,
    body: comment.body,
    files: comment.files.map((attached) => ({
      id: attached.id,
      file: {
        name: attached.file.name,
        size: attached.file.size,
        contentType: attached.file.contentType,
        sha256: attached.file.sha256,
      },
    })),
    createdAt: comment.createdAt.toISOString(),
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
    client: token.client ?? null,
  };
}

/** A session as its person sees it: the browser and the platform read from what it called itself, never the token. */
export function restSession(session: SessionView): RestSession {
  const { browser, platform } = describeUserAgent(session.userAgent);
  return {
    id: session.id,
    current: session.current,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    browser,
    platform,
    address: session.address,
    kind: session.kind,
    name: session.name,
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
    lastHeardAt: run.lastHeardAt.toISOString(),
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
    documentId: event.documentId ?? null,
    goalId: event.goalId ?? null,
    plugin: event.plugin ?? null,
    via: event.via ?? null,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
  };
}

export function restDocumentSummary(document: DocumentSummary): RestDocumentSummary {
  return {
    id: document.id,
    path: document.path,
    title: document.title,
    version: document.version,
    updatedBy: restPerson(document.updatedBy),
    agent: document.agent ?? null,
    plugin: document.plugin ?? null,
    archivedAt: document.archivedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function restDocumentFile(file: DocumentFileRecord): RestDocumentFile {
  return {
    id: file.id,
    label: file.label ?? null,
    file: {
      name: file.file.name,
      size: file.file.size,
      contentType: file.file.contentType,
      sha256: file.file.sha256,
    },
    addedBy: restPerson(file.addedBy),
    agent: file.agent ?? null,
    createdAt: file.createdAt.toISOString(),
  };
}

/** The rules that hold in a scope (ADR-0023), with the page they are written on when they are. */
export function restRules(rules: RulesRecord): RestRules {
  return {
    source: rules.source,
    body: rules.body ?? null,
    page: rules.page === undefined ? null : restDocumentSummary(rules.page),
  };
}

export function restDocument(document: DocumentRecord): RestDocument {
  return {
    ...restDocumentSummary(document),
    body: document.body,
    createdBy: restPerson(document.createdBy),
    links: document.links.map((link) => ({ path: link.path, title: link.title ?? null })),
    backlinks: document.backlinks.map((backlink) => ({
      kind: backlink.kind,
      id: backlink.id,
      path: backlink.path ?? null,
      number: backlink.number ?? null,
      title: backlink.title,
    })),
    files: document.files.map(restDocumentFile),
  };
}

export function restVersionSummary(version: VersionSummary): RestVersionSummary {
  return {
    number: version.number,
    title: version.title,
    author: restPerson(version.author),
    agent: version.agent ?? null,
    createdAt: version.createdAt.toISOString(),
  };
}

export function restVersion(version: VersionRecord): RestVersion {
  return { ...restVersionSummary(version), body: version.body };
}
