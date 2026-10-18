import type {
  RestArtifact,
  RestCategory,
  RestComment,
  RestDecision,
  RestDocument,
  RestDocumentSummary,
  RestDocuments,
  RestGoal,
  RestListing,
  RestMember,
  RestPerson,
  RestPersonWork,
  RestProject,
  RestProjectRules,
  RestRules,
  RestRun,
  RestTask,
  RestVersion,
  RestVersionSummary,
  RestWork,
} from "../schemas.js";

// What the command prints: one line per thing in a list, a few lines for one thing in full.
// Plain text, for an agent to read and a person to skim; ids are given, since the commands take
// them, and the words are the vocabulary's own, since the options take those.

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

const indent = (text: string): string =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

const asker = (decision: RestDecision): string =>
  decision.run === null
    ? decision.raisedBy.login
    : `${decision.run.agent} for ${decision.raisedBy.login}`;

/** One project: its key, its name, what the person is in it, and what waits in it. */
export function formatProjectLine(project: RestProject): string {
  const notes: string[] = [project.role];
  if (project.openDecisions > 0) {
    notes.push(`${plural(project.openDecisions, "decision")} waiting`);
  }
  return `${project.key}  ${project.name}  (${notes.join("; ")})`;
}

/** One project in full: what it is, how it is marked, and what the person is in it. */
export function formatProject(project: RestProject): string {
  const lines = [
    `project ${project.key}: ${project.name}`,
    `visibility: ${project.visibility}  role: ${project.role}  skills: ${project.skillsAddress ?? "the organization's"}`,
    `color: ${project.color ?? "none"}  symbol: ${project.symbol ?? "none"}  image: ${project.icon === null ? "none" : project.icon.contentType}`,
    `pack token: ${project.packToken === null ? "none" : `set ${project.packToken.setAt}`}`,
  ];
  if (project.description.trim().length > 0) {
    lines.push("", project.description.trimEnd());
  }
  return lines.join("\n");
}

/** One person: their login, their name where the host gives one, what they are in the workspace, and that they are out when they are. */
export function formatPersonLine(person: RestPerson): string {
  const standing = person.status === "active" ? person.role : `${person.role}, deactivated`;
  return person.name === null
    ? `${person.login}  (${standing})`
    : `${person.login}  ${person.name}  (${standing})`;
}

/** The provider a listing names, as people call it. */
const HOST_NAMES = { gh: "GitHub", google: "Google" } as const;

/** One login let in that nobody has signed in with yet (ADR-0022). */
export function formatListingLine(listing: RestListing): string {
  return `${listing.login}  (let in at ${HOST_NAMES[listing.host]}, not signed in yet)`;
}

/** One member of a project: their login, what they are in it, and since when. */
export function formatMemberLine(member: RestMember): string {
  return `${member.person.login}  ${member.role}  (since ${member.addedAt.slice(0, 10)})`;
}

/** The line under a page of a listing that has more after it: how to ask for the next page. */
export function formatMore(more: boolean, limit: number, offset: number): string {
  return more ? `\n... more: --offset ${offset + limit}` : "";
}

export function formatTaskLine(task: RestTask): string {
  const notes = [`owner ${task.owner.login}`];
  if (task.assignee !== null) {
    notes.push(`assigned to ${task.assignee.login}`);
  }
  if (task.category !== null) {
    notes.push(task.category.key);
  }
  if (task.dueOn !== null) {
    notes.push(`due ${task.dueOn}`);
  }
  if (task.openDecisions > 0) {
    notes.push(`${plural(task.openDecisions, "decision")} waiting`);
  }
  if (task.archivedAt !== null) {
    notes.push("archived");
  }
  return `#${task.number}  ${task.state}  ${task.priority}  ${task.title}  (${notes.join("; ")})`;
}

/** The plan and what happened, as a line each, only where there is something to say. */
function scheduleLines(task: RestTask): string[] {
  const lines: string[] = [];
  const plan = [
    task.category === null ? undefined : `category: ${task.category.key}`,
    task.goalId === null ? undefined : `goal: ${task.goalId}`,
    task.startsOn === null ? undefined : `starts: ${task.startsOn}`,
    task.dueOn === null ? undefined : `due: ${task.dueOn}`,
  ].filter((part) => part !== undefined);
  if (plan.length > 0) {
    lines.push(plan.join("  "));
  }
  const happened = [
    task.startedAt === null ? undefined : `started: ${task.startedAt}`,
    task.doneAt === null ? undefined : `done: ${task.doneAt}`,
    task.archivedAt === null ? undefined : `archived: ${task.archivedAt}`,
  ].filter((part) => part !== undefined);
  if (happened.length > 0) {
    lines.push(happened.join("  "));
  }
  return lines;
}

/** One task in full; with the decisions about it and the runs on it, when given. */
export function formatTask(
  task: RestTask,
  decisions?: readonly RestDecision[],
  runs?: readonly RestRun[],
  comments?: readonly RestComment[],
): string {
  const lines = [
    `#${task.number} ${task.title}`,
    `state: ${task.state}  priority: ${task.priority}  owner: ${task.owner.login}  assignee: ${task.assignee?.login ?? "nobody"}`,
    `id: ${task.id}${task.parentId === null ? "" : `  part of: ${task.parentId}`}`,
    ...scheduleLines(task),
  ];
  if (task.links.length > 0) {
    lines.push("links:");
    for (const link of task.links) {
      lines.push(`  ${link.label === null ? link.url : `${link.label}: ${link.url}`}`);
    }
  }
  if (task.body.trim().length > 0) {
    lines.push("", task.body.trimEnd());
  }
  if (decisions !== undefined) {
    lines.push("", decisions.length === 0 ? "decisions: none" : "decisions:");
    for (const decision of decisions) {
      lines.push(`  ${formatDecisionLine(decision)}`);
    }
  }
  if (runs !== undefined) {
    lines.push("", runs.length === 0 ? "runs: none" : "runs:");
    for (const run of runs) {
      lines.push(`  ${formatRunLine(run)}`);
    }
  }
  if (comments !== undefined) {
    lines.push("", comments.length === 0 ? "comments: none" : "comments:");
    for (const comment of comments) {
      lines.push(formatComment(comment));
    }
  }
  return lines.join("\n");
}

/**
 * One comment of the discussion, indented under the list: who said it, through which agent,
 * when, the whole word, and each file put in it with the command that reads it.
 */
export function formatComment(comment: RestComment): string {
  const who =
    comment.agent === null ? comment.author.login : `${comment.author.login} as ${comment.agent}`;
  const lines = [`  ${who}, ${comment.createdAt}, comment ${comment.id}:`];
  if (comment.body.trim().length > 0) {
    lines.push(indent(comment.body));
  }
  for (const attached of comment.files) {
    lines.push(
      `    file: ${attached.file.name} (${attached.file.size} bytes, ${attached.file.contentType}): console file ${attached.id}`,
    );
  }
  return lines.join("\n");
}

export function formatRunLine(run: RestRun): string {
  const notes = [plural(run.reports.length, "report"), plural(run.artifacts.length, "artifact")];
  if (run.waitingFor !== null) {
    notes.push(`waiting for decision ${run.waitingFor}`);
  }
  if (run.endedAt === null) {
    notes.push(`last heard ${run.lastHeardAt}`);
  }
  return `${run.id}  ${run.status}  ${run.agent} for ${run.person.login}  task #${run.taskNumber}  (${notes.join(", ")})`;
}

/** One run in full; with where each file handed in is read, when the caller knows. */
export function formatRun(run: RestRun, fileUrl?: (artifactId: string) => string): string {
  const lines = [
    formatRunLine(run),
    `started: ${run.startedAt}${run.endedAt === null ? "" : `  ended: ${run.endedAt}`}`,
  ];
  if (run.summary !== null) {
    lines.push("", "summary:", indent(run.summary));
  }
  if (run.reports.length > 0) {
    lines.push("", "reports:");
    for (const report of run.reports) {
      lines.push(`  [${report.createdAt}]`, indent(report.body));
    }
  }
  if (run.artifacts.length > 0) {
    lines.push("", "artifacts:");
    for (const artifact of run.artifacts) {
      lines.push(`  ${formatArtifact(artifact, fileUrl)}`);
    }
  }
  return lines.join("\n");
}

/** What was handed in: the link, or the file with its size and where its bytes are read. */
export function formatArtifact(
  artifact: RestArtifact,
  fileUrl?: (artifactId: string) => string,
): string {
  const what =
    artifact.file === null
      ? (artifact.url ?? "")
      : `${artifact.file.name} (${artifact.file.size} bytes, ${artifact.file.contentType}${fileUrl === undefined ? "" : `; read at ${fileUrl(artifact.id)}`}; console file ${artifact.id})`;
  return artifact.label === null ? what : `${artifact.label}: ${what}`;
}

/** One half of the rules: where it comes from, and the text as it stands. */
function formatRulesHalf(where: "the workspace" | "this project", rules: RestRules): string {
  const page = rules.page;
  const facts =
    page === null
      ? undefined
      : `v${page.version}, by ${writer(page.updatedBy, page.agent)}; ${page.updatedAt}`;
  if (rules.source === "none" || rules.body === null) {
    return `Rules of ${where}: none of its own; the workspace's hold.`;
  }
  const head =
    rules.source === "reference"
      ? `Rules of ${where}: the console's own, until an administrator writes the organization's (console rules write --workspace).`
      : `Rules of ${where} (${facts ?? "written"}):`;
  return `${head}\n\n${rules.body.trimEnd()}`;
}

/** The rules that hold: the workspace's, and what the project adds when the command works in one. */
export function formatRules(rules: RestProjectRules | RestRules): string {
  if ("workspace" in rules) {
    return [
      formatRulesHalf("the workspace", rules.workspace),
      "",
      formatRulesHalf("this project", rules.project),
    ].join("\n");
  }
  return formatRulesHalf("the workspace", rules);
}

/** How far a goal is, from its tasks: the done, the at work, and the rest, in one phrase. */
function progressOf(goal: RestGoal): string {
  const counts = goal.taskCounts;
  const total = counts.idea + counts.ready + counts.in_progress + counts.in_review + counts.done;
  const working = counts.in_progress + counts.in_review;
  return `${counts.done}/${total} done${working === 0 ? "" : `, ${working} in progress`}${counts.dropped === 0 ? "" : `, ${counts.dropped} dropped`}`;
}

/** One goal: its id, its state, its title, its category, its days, and how far it is. */
export function formatGoalLine(goal: RestGoal): string {
  const notes = [
    ...(goal.category === null ? [] : [goal.category.key]),
    ...(goal.startsOn === null ? [] : [`starts ${goal.startsOn}`]),
    goal.dueOn === null ? "no target day" : `due ${goal.dueOn}`,
    progressOf(goal),
  ];
  return `${goal.id}  ${goal.state}  ${goal.title}  (${notes.join("; ")})`;
}

/** One goal in full; with the tasks that work towards it, when given. */
export function formatGoal(goal: RestGoal, tasks?: readonly RestTask[]): string {
  const lines = [
    `goal ${goal.id}: ${goal.title}`,
    `state: ${goal.state}  category: ${goal.category?.key ?? "none"}  starts: ${goal.startsOn ?? "none"}  due: ${goal.dueOn ?? "none"}  set by: ${goal.createdBy.login}`,
    `progress: ${progressOf(goal)}`,
  ];
  if (goal.body.trim().length > 0) {
    lines.push("", goal.body.trimEnd());
  }
  if (tasks !== undefined) {
    lines.push("", tasks.length === 0 ? "tasks: none" : "tasks:");
    for (const task of tasks) {
      lines.push(`  ${formatTaskLine(task)}`);
    }
  }
  return lines.join("\n");
}

/** One category: its key, what people call it, and its colour. */
export function formatCategoryLine(category: RestCategory): string {
  return `${category.key}  ${category.name}  (${category.color})`;
}

/** What is on a person's plate: their open tasks by project, and the decisions waiting. */
export function formatWork(work: RestWork): string {
  const lines: string[] = [];
  if (work.tasks.length === 0) {
    lines.push("No open task is assigned to you.");
  } else {
    lines.push("tasks assigned to you:");
    for (const { project, task } of work.tasks) {
      lines.push(`  ${project.key}  ${formatTaskLine(task)}`);
    }
  }
  lines.push("", work.decisions.length === 0 ? "decisions waiting: none" : "decisions waiting:");
  for (const { project, decision } of work.decisions) {
    lines.push(`  ${project.key}  ${formatDecisionLine(decision)}`);
  }
  return lines.join("\n");
}

/** Another person's plate: their open tasks, each with its project; no decisions, which wait for anyone. */
export function formatPersonWork(person: RestPerson, work: RestPersonWork): string {
  if (work.tasks.length === 0) {
    return `No open task is assigned to ${person.login}.`;
  }
  return [
    `tasks assigned to ${person.login}:`,
    ...work.tasks.map(({ project, task }) => `  ${project.key}  ${formatTaskLine(task)}`),
  ].join("\n");
}

export function formatDecisionLine(decision: RestDecision): string {
  const state = decision.answer === null ? "waiting" : `answered ${decision.answer.option}`;
  return `${decision.id}  ${state}  ${decision.question}  (asked by ${asker(decision)})`;
}

/** The options, one a line; the person's own answer, when they wrote one, is the last and says so. */
export function formatOptions(decision: RestDecision): string {
  return decision.options
    .map(
      (option) =>
        `  ${option.id}) ${option.label}${option.own === true ? "  (the person's own answer, not one given)" : ""}`,
    )
    .join("\n");
}

/** The answer, with who gave it, and that it is in their own words when it is; or that there is none yet. */
export function formatAnswer(decision: RestDecision): string {
  const { answer } = decision;
  if (answer === null) {
    return "waits for a person.";
  }
  const chosen = decision.options.find((option) => option.id === answer.option);
  const lines = [
    `Answered: ${answer.option}) ${chosen?.label ?? answer.option}${chosen?.own === true ? ", in their own words" : ""}, by ${answer.by.login} at ${answer.at}`,
  ];
  if (answer.note !== null && answer.note.length > 0) {
    lines.push(`Note: ${answer.note}`);
  }
  return lines.join("\n");
}

export function formatDecision(decision: RestDecision): string {
  const lines = [
    `decision ${decision.id}: ${decision.question}`,
    `asked by ${asker(decision)}${decision.taskNumber === null ? "" : `, about task #${decision.taskNumber}`}`,
  ];
  if (decision.body.trim().length > 0) {
    lines.push("", decision.body.trimEnd());
  }
  lines.push("", "options:", formatOptions(decision), "", formatAnswer(decision));
  if (decision.outcome !== null && decision.outcome.trim().length > 0) {
    lines.push("", "what followed:", indent(decision.outcome));
  }
  return lines.join("\n");
}

/** Who wrote a version, and through which agent. */
const writer = (by: { readonly login: string }, agent: string | null): string =>
  agent === null ? by.login : `${agent} for ${by.login}`;

/** One document in a list: its path, its title, its version, who wrote it last and when. */
export function formatDocumentLine(document: RestDocumentSummary): string {
  const notes = [`v${document.version}`, `by ${writer(document.updatedBy, document.agent)}`];
  if (document.archivedAt !== null) {
    notes.push("archived");
  }
  return `${document.path}  ${document.title}  (${notes.join(", ")}; ${document.updatedAt})`;
}

/** A folder's folders and pages, or the pages a search found. */
export function formatDocuments(listing: RestDocuments): string {
  if (listing.folders.length === 0 && listing.items.length === 0) {
    return "No pages here.";
  }
  const lines = listing.folders.map((folder) => `${folder}/`);
  for (const document of listing.items) {
    lines.push(formatDocumentLine(document));
  }
  return lines.join("\n");
}

/** One document in full: its latest version, what it links to, what refers to it, and its files. */
export function formatDocument(
  document: RestDocument,
  fileUrl?: (fileId: string) => string,
): string {
  const lines = [
    `${document.path}: ${document.title}`,
    `version ${document.version}, by ${writer(document.updatedBy, document.agent)} at ${document.updatedAt}${document.archivedAt === null ? "" : `; archived ${document.archivedAt}`}`,
    `id: ${document.id}`,
  ];
  if (document.body.trim().length > 0) {
    lines.push("", document.body.trimEnd());
  }
  if (document.links.length > 0) {
    lines.push("", "refers to:");
    for (const link of document.links) {
      lines.push(
        `  ${link.path}${link.title === null ? "  (no page there yet)" : `  ${link.title}`}`,
      );
    }
  }
  if (document.backlinks.length > 0) {
    lines.push("", "referred to by:");
    for (const backlink of document.backlinks) {
      lines.push(
        `  ${backlink.kind} ${backlink.kind === "task" ? `#${backlink.number ?? "?"}` : (backlink.path ?? backlink.id)}  ${backlink.title}`,
      );
    }
  }
  if (document.files.length > 0) {
    lines.push("", "files:");
    for (const attached of document.files) {
      const where = fileUrl === undefined ? "" : `; read at ${fileUrl(attached.id)}`;
      const what = `${attached.file.name} (${attached.file.size} bytes, ${attached.file.contentType}${where})`;
      lines.push(`  ${attached.label === null ? what : `${attached.label}: ${what}`}`);
    }
  }
  return lines.join("\n");
}

export function formatVersionLine(version: RestVersionSummary): string {
  return `v${version.number}  ${version.title}  (by ${writer(version.author, version.agent)}; ${version.createdAt})`;
}

/** One version of a document, with its body as it was. */
export function formatVersion(path: string, version: RestVersion): string {
  const lines = [`${path}: ${version.title}`, formatVersionLine(version)];
  if (version.body.trim().length > 0) {
    lines.push("", version.body.trimEnd());
  }
  return lines.join("\n");
}

/** The text of one path across the pages a skill came in: the fragments joined in order. */
