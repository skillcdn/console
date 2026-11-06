import { argUsage } from "../plugin/args.js";
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
  RestPlugin,
  RestPluginArg,
  RestPluginDetail,
  RestPluginGrant,
  RestPluginInvocation,
  RestPluginOperation,
  RestPluginRecord,
  RestPluginRecordPage,
  RestPluginRecordRead,
  RestPluginRecordVersions,
  RestPluginSetting,
  RestPlugins,
  RestProject,
  RestProjectRules,
  RestRules,
  RestRulesPlugin,
  RestRun,
  RestTask,
  RestVersion,
  RestVersionSummary,
  RestWork,
  RestWorkspace,
} from "../schemas.js";

// What the command prints: one line per thing in a list, a few lines for one thing in full.
// Plain text, for an agent to read and a person to skim; ids are given, since the commands take
// them, and the words are the vocabulary's own, since the options take those.

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The time zone moments are printed in: the workspace's, as the command last learned it (ADR-0035); none leaves them as the API gives them. */
let momentZone: string | undefined;

/** Says which time zone the moments printed from now on are in, or none. */
export function setMomentZone(zone: string | undefined): void {
  momentZone = zone;
}

/**
 * An instant as the command prints it: in the workspace's time zone, as ISO 8601 with its
 * offset (`2026-10-18T15:04:17+09:00`), when a zone is known; else as the API gave it, in UTC.
 */
export function moment(iso: string): string {
  if (momentZone === undefined) {
    return iso;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: momentZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    }).formatToParts(date);
  } catch {
    return iso;
  }
  const of = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const offset = of("timeZoneName").replace("GMT", "");
  return `${of("year")}-${of("month")}-${of("day")}T${of("hour")}:${of("minute")}:${of("second")}${offset === "" ? "Z" : offset}`;
}

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
    `pack token: ${project.packToken === null ? "none" : `set ${moment(project.packToken.setAt)}`}`,
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

/** The workspace as its Settings page shows it: what it is called, who sees whom, the week, the time zone, where the skills come from, and what tokens may last. */
export function formatWorkspace(workspace: RestWorkspace): string {
  const visibility = workspace.peopleVisibility ?? "everyone";
  const zone = workspace.timeZone ?? null;
  const token = workspace.skills.packToken ?? null;
  return [
    `workspace ${workspace.name}`,
    `people visibility: ${visibility}  (${visibility === "everyone" ? "everyone sees everyone" : "a member sees only the people they share a project with; an administrator sees everyone"})`,
    `week begins on: ${workspace.weekStart ?? "auto"}  (auto: the system default, as each device has it)`,
    `time zone: ${zone ?? "none"}  (${zone === null ? "moments are printed as the API gives them, in UTC" : "moments are printed in it, as ISO 8601 with its offset"})`,
    `skills: ${workspace.skills.address ?? "no address of the organization's"}  at ${workspace.skills.source}`,
    `SkillCDN token: ${token === null ? "none" : `set ${moment(token.setAt)}`}  (${token === null ? "the organization's pack is read with none" : "the organization's pack is read with it by a project with no address and no token of its own"})`,
    `token days at most: ${workspace.tokenDaysAtMost ?? "a person chooses"}`,
  ].join("\n");
}

/** One member of a project: their login, what they are in it, and since when. */
export function formatMemberLine(member: RestMember): string {
  return `${member.person.login}  ${member.role}  (since ${moment(member.addedAt).slice(0, 10)})`;
}

/** The line under a page of a listing that has more after it: how to ask for the next page. */
export function formatMore(more: boolean, limit: number, offset: number): string {
  return more ? `\n... more: --offset ${offset + limit}` : "";
}

/** The logins of the people at work on a task, in the order they came to it. */
const logins = (people: readonly RestPerson[]): string =>
  people.map((person) => person.login).join(", ");

export function formatTaskLine(task: RestTask): string {
  const notes = [`owner ${task.owner.login}`];
  if (task.workers.length > 0) {
    notes.push(`workers ${logins(task.workers)}`);
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
    task.startedAt === null ? undefined : `started: ${moment(task.startedAt)}`,
    task.doneAt === null ? undefined : `done: ${moment(task.doneAt)}`,
    task.archivedAt === null ? undefined : `archived: ${moment(task.archivedAt)}`,
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
    `state: ${task.state}  priority: ${task.priority}  owner: ${task.owner.login}  workers: ${task.workers.length === 0 ? "nobody" : logins(task.workers)}`,
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
  const lines = [`  ${who}, ${moment(comment.createdAt)}, comment ${comment.id}:`];
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
    notes.push(`last heard ${moment(run.lastHeardAt)}`);
  }
  return `${run.id}  ${run.status}  ${run.agent} for ${run.person.login}  task #${run.taskNumber}  (${notes.join(", ")})`;
}

/** One run in full; with where each file handed in is read, when the caller knows. */
export function formatRun(run: RestRun, fileUrl?: (artifactId: string) => string): string {
  const lines = [
    formatRunLine(run),
    `started: ${moment(run.startedAt)}${run.endedAt === null ? "" : `  ended: ${moment(run.endedAt)}`}`,
  ];
  if (run.summary !== null) {
    lines.push("", "summary:", indent(run.summary));
  }
  if (run.reports.length > 0) {
    lines.push("", "reports:");
    for (const report of run.reports) {
      lines.push(`  [${moment(report.createdAt)}]`, indent(report.body));
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
      : `v${page.version}, by ${writer(page.updatedBy, page.agent)}; ${moment(page.updatedAt)}`;
  if (rules.source === "none" || rules.body === null) {
    return `Rules of ${where}: none of its own; the workspace's hold.`;
  }
  const head =
    rules.source === "reference"
      ? `Rules of ${where}: the console's own, until an administrator writes the organization's (console rules write --workspace).`
      : `Rules of ${where} (${facts ?? "written"}):`;
  return `${head}\n\n${rules.body.trimEnd()}`;
}

/**
 * The rules that hold: the workspace's, and what the project adds when the command works in one;
 * then the plugins the console names after them, a line each, where there are any.
 */
export function formatRules(
  rules: RestProjectRules | RestRules,
  language?: string | null | undefined,
): string {
  const parts =
    "workspace" in rules
      ? [
          formatRulesHalf("the workspace", rules.workspace),
          "",
          formatRulesHalf("this project", rules.project),
        ]
      : [formatRulesHalf("the workspace", rules)];
  if (rules.plugins !== undefined && rules.plugins.length > 0) {
    parts.push("", formatRulesPlugins(rules.plugins, language));
  }
  return parts.join("\n");
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
    lines.push("No open task is on your plate.");
  } else {
    lines.push("tasks you work on:");
    for (const { project, task } of work.tasks) {
      lines.push(`  ${project.key}  ${formatTaskLine(task)}`);
    }
  }
  lines.push(
    "",
    work.decisions.length === 0 ? "decisions waiting for you: none" : "decisions waiting for you:",
  );
  for (const { project, decision } of work.decisions) {
    lines.push(`  ${project.key}  ${formatDecisionLine(decision)}`);
  }
  return lines.join("\n");
}

/** Another person's plate: their open tasks, each with its project; no decisions, which wait for anyone. */
export function formatPersonWork(person: RestPerson, work: RestPersonWork): string {
  if (work.tasks.length === 0) {
    return `No open task is on ${person.login}'s plate.`;
  }
  return [
    `tasks ${person.login} works on:`,
    ...work.tasks.map(({ project, task }) => `  ${project.key}  ${formatTaskLine(task)}`),
  ].join("\n");
}

/** Whom a decision is for, where that is not the one who asked (ADR-0042). */
const addressed = (decision: RestDecision): string =>
  decision.decider.id === decision.raisedBy.id ? "" : `, for ${decision.decider.login}`;

export function formatDecisionLine(decision: RestDecision): string {
  const state = decision.answer === null ? "waiting" : `answered ${decision.answer.option}`;
  return `${decision.id}  ${state}  ${decision.question}  (asked by ${asker(decision)}${addressed(decision)})`;
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
    return `waits for ${decision.decider.login}.`;
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
    `asked by ${asker(decision)}${addressed(decision)}${decision.taskNumber === null ? "" : `, about task #${decision.taskNumber}`}`,
  ];
  if (decision.body.trim().length > 0) {
    lines.push("", decision.body.trimEnd());
  }
  // The files put on it (ADR-0055), each with the command that reads it.
  const files = decision.files ?? [];
  if (files.length > 0) {
    lines.push(
      "",
      ...files.map(
        (attached) =>
          `file: ${attached.file.name} (${attached.file.size} bytes, ${attached.file.contentType}): console file ${attached.id}`,
      ),
    );
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
  return `${document.path}  ${document.title}  (${notes.join(", ")}; ${moment(document.updatedAt)})`;
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
    `version ${document.version}, by ${writer(document.updatedBy, document.agent)} at ${moment(document.updatedAt)}${document.archivedAt === null ? "" : `; archived ${moment(document.archivedAt)}`}`,
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
  return `v${version.number}  ${version.title}  (by ${writer(version.author, version.agent)}; ${moment(version.createdAt)})`;
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

// ---- The plugins (docs/specs/plugins.md, "The command") ----

/** A text in the person's language, else in English, else the first the manifest has; nothing for none. */
export function localized(
  texts: Readonly<Record<string, string>> | null | undefined,
  language: string | null | undefined,
): string {
  if (texts === null || texts === undefined) {
    return "";
  }
  const tag = language ?? "en";
  return texts[tag] ?? texts[tag.split("-")[0] ?? tag] ?? texts.en ?? Object.values(texts)[0] ?? "";
}

/** One plugin in a line: its key, its name and version, its state, the roles held in it, its problems. */
export function formatPluginLine(plugin: RestPlugin, language: string | null | undefined): string {
  const notes = [
    plugin.roles.length === 0 ? undefined : `roles: ${plugin.roles.join(", ")}`,
    plugin.problems.length === 0 ? undefined : `problems: ${plugin.problems.join("; ")}`,
  ].filter((note): note is string => note !== undefined);
  return `${plugin.key}  ${localized(plugin.name, language)} ${plugin.version}  ${plugin.state}${notes.length === 0 ? "" : `  ${notes.join("  ")}`}`;
}

/** The plugins one may use, a line each, and how to go on. */
export function formatPlugins(plugins: RestPlugins, language: string | null | undefined): string {
  if (plugins.items.length === 0) {
    return "This console has no plugins you may use.";
  }
  return [
    ...plugins.items.map((plugin) => formatPluginLine(plugin, language)),
    "",
    "One plugin, with its commands: console plugin <key>. One command in full: console plugin <key> help <command>.",
  ].join("\n");
}

/** How a command or a query of a plugin is given, as help prints it: the positionals, then the flags. */
export function formatOperationUsage(key: string, operation: RestPluginOperation): string {
  const entries = Object.entries(operation.args);
  const usage = [
    ...entries.filter(([, arg]) => arg.positional).map(([name, arg]) => argUsage(name, arg)),
    ...entries.filter(([, arg]) => !arg.positional).map(([name, arg]) => argUsage(name, arg)),
  ];
  return `console plugin ${key} ${operation.name}${usage.map((part) => ` ${part}`).join("")}`;
}

/** What an argument takes, in a line: its form, its type with its bounds, and what it is for. */
function formatArgLine(name: string, arg: RestPluginArg): string {
  const kind = (description: RestPluginArg): string => {
    switch (description.type) {
      case "text":
      case "markdown":
        return `${description.type}${description.max === undefined ? "" : `, up to ${description.max} characters`}${description.secret === true ? ", hidden in the event" : ""}`;
      case "number": {
        const bounds = [
          description.integer === true ? "whole" : undefined,
          description.min === undefined ? undefined : `from ${description.min}`,
          description.max === undefined ? undefined : `to ${description.max}`,
        ].filter((bound): bound is string => bound !== undefined);
        return `number${bounds.length === 0 ? "" : ` (${bounds.join(", ")})`}`;
      }
      case "boolean":
        return "true or false; the flag alone is true";
      case "enum":
        return `one of ${(description.options ?? []).join(", ")}`;
      case "day":
        return "a day as YYYY-MM-DD";
      case "person":
        return "a login, or me";
      case "project":
        return "a project's key";
      case "record":
        return `the id of a record of ${description.collection ?? "a collection"}`;
      case "file":
        return "a file: --file <path>, or - for standard input";
      case "list":
        return `a list of ${description.of === undefined ? "items" : kind(description.of)}${description.max === undefined ? "" : `, up to ${description.max}`}; the flag given again, or commas between`;
      default:
        return description.type;
    }
  };
  const about = arg.about === undefined ? "" : `: ${arg.about}`;
  return `  ${argUsage(name, arg)}  ${kind(arg)}${arg.optional ? ", optional" : ""}${about}`;
}

/** The refusals a plugin's command or query may meet, as `console help` words them. */
const PLUGIN_COMMAND_REFUSALS = [
  "plugin.invalid_args: a word does not fit the definition; the message names the first at fault",
  "plugin.forbidden: the command needs a role you do not hold in the plugin",
  "plugin.disabled, plugin.unavailable: the plugin is not enabled, or cannot run right now",
  "plugin.timeout: the plugin ran past its time",
  "plugin.<key>.<code>: the plugin's own refusal, in its own words",
];

/** One command or query of a plugin in full, as `console help <command>` prints one; or every one in a line. */
export function formatPluginHelp(detail: RestPluginDetail, name: string | undefined): string {
  if (name === undefined) {
    if (detail.operations.length === 0) {
      return `${detail.key} has no command or query you may run.`;
    }
    return [
      ...detail.operations.flatMap((operation) => [
        formatOperationUsage(detail.key, operation),
        `    ${operation.kind === "query" ? "[query] " : ""}${operation.about}`,
      ]),
      "",
      `One in full: console plugin ${detail.key} help <command>.`,
    ].join("\n");
  }
  const operation = detail.operations.find((candidate) => candidate.name === name);
  if (operation === undefined) {
    return `${detail.key} has no command or query ${name} you may run.`;
  }
  const args = Object.entries(operation.args);
  const parts = [
    formatOperationUsage(detail.key, operation),
    "",
    `${operation.kind === "query" ? "A query: reads only, and answers JSON. " : "A command. "}${operation.about}`,
  ];
  if (args.length > 0) {
    parts.push(
      "",
      "Arguments (a positional one by its place, the others as --<name> <value> or --<name>=<value>):",
      ...args.map(([argName, arg]) => formatArgLine(argName, arg)),
    );
  }
  if (operation.roles !== null) {
    parts.push("", `Roles: ${operation.roles.join(", ")}`);
  }
  parts.push(
    "",
    operation.kind === "query"
      ? "Prints the answer as JSON; a query that answers a file saves it under its name."
      : "Prints what the command says; --json prints its data. A command that raised a decision prints its id and exits with 3: console decision <id> --wait 100 waits for the answer.",
    "",
    "Refusals:",
    ...PLUGIN_COMMAND_REFUSALS.map((refusal) => `  ${refusal}`),
  );
  return parts.join("\n");
}

/** A setting in a line: its key and type, what it holds or whether it is set, and its name. */
export function formatPluginSettingLine(
  setting: RestPluginSetting,
  language: string | null | undefined,
): string {
  const holds =
    setting.type === "secret"
      ? setting.set
        ? `set${setting.setAt === null ? "" : ` ${moment(setting.setAt)}`}`
        : "not set"
      : setting.set
        ? setting.value === null
          ? "set"
          : JSON.stringify(setting.value)
        : setting.default === null
          ? "not set"
          : `default ${JSON.stringify(setting.default)}`;
  return `  ${setting.key} (${setting.type}${setting.required ? ", required" : ""}): ${holds}  ${localized(setting.name, language)}`;
}

/** A grant in a line: its id, the role, whom it is to, since when. */
export function formatPluginGrantLine(grant: RestPluginGrant): string {
  const whom =
    grant.person !== null
      ? `person ${grant.person.login}`
      : grant.project !== null
        ? `the members of ${grant.project.key}`
        : "everyone";
  return `${grant.id}  ${grant.role} to ${whom}  since ${moment(grant.createdAt)}`;
}

/** One plugin in full: what it is, how it stands, what one may run, its skills and its settings. */
export function formatPlugin(
  detail: RestPluginDetail,
  language: string | null | undefined,
): string {
  const name = localized(detail.name, language);
  const lines = [`${detail.key}: ${name} ${detail.version}, ${detail.state}`];
  const description = localized(detail.description, language);
  if (description.length > 0) {
    lines.push(description);
  }
  const note = localized(detail.agentNote, language);
  if (note.length > 0) {
    lines.push(`For agents: ${note}`);
  }
  if (detail.problems.length > 0) {
    lines.push(`problems: ${detail.problems.join("; ")}`);
  }
  lines.push(
    detail.roles.length === 0
      ? "You hold no role in it."
      : `Your roles in it: ${detail.roles.join(", ")}.`,
  );
  if (detail.board !== null) {
    lines.push(`Board project: ${detail.board.key} (${detail.board.name}).`);
  } else if (detail.boardNeeds !== "none") {
    lines.push("Board project: none yet.");
  }
  lines.push("");
  if (detail.operations.length === 0) {
    lines.push("No command or query you may run.");
  } else {
    lines.push("Commands and queries:");
    for (const operation of detail.operations) {
      lines.push(
        `  ${formatOperationUsage(detail.key, operation)}`,
        `      ${operation.kind === "query" ? "[query] " : ""}${operation.about}`,
      );
    }
    lines.push(`One in full: console plugin ${detail.key} help <command>.`);
  }
  if (detail.skills !== null) {
    lines.push(
      "",
      `Skills: console plugin ${detail.key} skills lists them; console plugin ${detail.key} skill <path> reads one. Read the one that fits before the first command.`,
    );
  }
  if (detail.settings.length > 0) {
    lines.push(
      "",
      "Settings:",
      ...detail.settings.map((setting) => formatPluginSettingLine(setting, language)),
    );
  }
  if (detail.grants !== null) {
    lines.push(
      "",
      detail.grants.length === 0
        ? "Grants: none; the default role, where the manifest names one, is everyone's."
        : "Grants:",
      ...detail.grants.map((grant) => `  ${formatPluginGrantLine(grant)}`),
    );
  }
  return lines.join("\n");
}

/** What a command or a query answered, as the command prints it. */
export function formatInvocation(result: RestPluginInvocation): string {
  if (result.kind === "query") {
    return result.data === undefined ? "null" : JSON.stringify(result.data, null, 2);
  }
  const text = result.text.length === 0 ? "Done." : result.text;
  return result.waiting === null
    ? text
    : `${text}\ndecision id: ${result.waiting}\nThe decision waits for a person: console decision ${result.waiting} --wait 100`;
}

/** A record's data on one line, cut where it runs long. */
function compactData(data: Readonly<Record<string, unknown>>): string {
  const text = JSON.stringify(data);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** A record in a line: its id, its version, when it last changed, whether it is put away, its data. */
export function formatPluginRecordLine(record: RestPluginRecord): string {
  return `${record.id}  v${record.version}  ${moment(record.updatedAt)}${record.archivedAt === null ? "" : "  archived"}  ${compactData(record.data)}`;
}

/** A page of records, and how the next is asked for. */
export function formatPluginRecords(page: RestPluginRecordPage): string {
  if (page.items.length === 0) {
    return "No records.";
  }
  const lines = page.items.map(formatPluginRecordLine);
  if (page.after !== null) {
    lines.push(`More: --after ${page.after}`);
  }
  return lines.join("\n");
}

/** One record in full, or one version of it as it was. */
export function formatPluginRecord(record: RestPluginRecordRead): string {
  if (!("id" in record)) {
    return [
      `version ${record.version}, ${moment(record.at)}, by ${record.by ?? "the console"}`,
      JSON.stringify(record.data, null, 2),
    ].join("\n");
  }
  const facts = [
    `id: ${record.id}  collection: ${record.collection}  version: ${record.version}`,
    `created: ${moment(record.createdAt)} by ${record.createdBy ?? "the console"}  updated: ${moment(record.updatedAt)} by ${record.updatedBy ?? "the console"}`,
  ];
  if (record.project !== null) {
    facts.push(`project: ${record.project}`);
  }
  if (record.owner !== null) {
    facts.push(`owner: ${record.owner}`);
  }
  if (record.archivedAt !== null) {
    facts.push(`archived: ${moment(record.archivedAt)}`);
  }
  return [...facts, JSON.stringify(record.data, null, 2)].join("\n");
}

/** The versions of a record, newest first, a line each. */
export function formatPluginRecordVersions(versions: RestPluginRecordVersions): string {
  if (versions.items.length === 0) {
    return "No versions.";
  }
  return versions.items
    .map(
      (version) =>
        `v${version.version}  ${moment(version.at)}  by ${version.by ?? "the console"}  ${compactData(version.data)}`,
    )
    .join("\n");
}

/** The plugins named after the rules: a line each, with the sentence for agents and where to start. */
export function formatRulesPlugins(
  plugins: readonly RestRulesPlugin[],
  language: string | null | undefined,
): string {
  return [
    "## Plugins",
    "",
    ...plugins.map((plugin) => {
      const note = localized(plugin.agentNote, language) || localized(plugin.description, language);
      return `- ${plugin.key} (${localized(plugin.name, language)}): ${note} Start with console plugin ${plugin.key}.`;
    }),
  ].join("\n");
}
