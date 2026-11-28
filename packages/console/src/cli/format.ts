import { createHash } from "node:crypto";
import { usageNear, usageSaidTogether, usageStanding, usedHundredths } from "../agent-usage.js";
import { describeEvent } from "../feed-words.js";
import { NOTIFICATION_KINDS, type NotificationKind } from "../notifications.js";
import { argUsage } from "../plugin/args.js";
import type {
  RestAgent,
  RestAgentRunner,
  RestAgentSecret,
  RestArtifact,
  RestCategory,
  RestComment,
  RestDecision,
  RestDocument,
  RestDocumentSummary,
  RestDocuments,
  RestEvent,
  RestEvents,
  RestGoal,
  RestListing,
  RestMember,
  RestNotification,
  RestNotificationSettings,
  RestNotifications,
  RestOwnWake,
  RestPerson,
  RestPersonWork,
  RestPlugin,
  RestPluginArg,
  RestPluginDetail,
  RestPluginGrant,
  RestPluginInvocation,
  RestPluginJob,
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
  RestRunBrief,
  RestSignal,
  RestTask,
  RestTaskBrief,
  RestTaskFollow,
  RestTeam,
  RestVersion,
  RestVersionSummary,
  RestWork,
  RestWorkspace,
} from "../schemas.js";
import { reportCountOf } from "../schemas.js";

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
    ? calledOf(decision.raisedBy)
    : `${decision.run.agent} for ${calledOf(decision.raisedBy)}`;

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
    `color: ${project.color ?? "none"}  symbol: ${project.symbol ?? "none"}  glyph: ${project.glyph ?? "none"}  image: ${project.icon === null ? "none" : project.icon.contentType}`,
    `pack token: ${project.packToken === null ? "none" : `set ${moment(project.packToken.setAt)}`}`,
  ];
  if (project.description.trim().length > 0) {
    lines.push("", project.description.trimEnd());
  }
  return lines.join("\n");
}

/** One person: their login, their name where the host gives one, what they are in the workspace, that they are out when they are, and whom they report to where known. */
export function formatPersonLine(person: RestPerson, reportsTo?: string | undefined): string {
  // An agent account says so, and that nobody has signed in with it yet (ADR-0084).
  const standing = [
    ...(person.kind === "agent" ? ["agent account"] : []),
    person.role,
    ...(person.status === "active" ? [] : ["deactivated"]),
    ...(person.invited === true ? ["not signed in yet"] : []),
  ].join(", ");
  const line = reportsTo === undefined ? "" : `, reports to ${reportsTo}`;
  // The work email where the console answers one: to an administrator, and for oneself.
  const email = typeof person.email === "string" ? `  <${person.email}>` : "";
  // Called by its handle too, where it has one; and by what they do, where a title says.
  const who =
    typeof person.handle === "string" ? `${person.login} @${person.handle}` : person.login;
  const called = [person.name, person.title].filter(
    (word): word is string => typeof word === "string" && word.length > 0,
  );
  return called.length === 0
    ? `${who}${email}  (${standing}${line})`
    : `${who}  ${called.join(", ")}${email}  (${standing}${line})`;
}

/**
 * One agent account (ADR-0084): its handle, its name and what it does, the login it signs in
 * with, whom it reports to where the asker sees them, and that nobody signed in with it yet or
 * that it is out, where so.
 */
export function formatAgentLine(agent: RestAgent): string {
  const { person, manager } = agent;
  const called = [person.name, person.title].filter(
    (word): word is string => typeof word === "string" && word.length > 0,
  );
  const standing = [
    `signs in as ${person.login}`,
    ...(manager === null ? [] : [`reports to ${calledOf(manager)}`]),
    ...(person.invited === true
      ? [
          // At a git host, whether the host said which account the login is (ADR-0126).
          agent.firstSignIn === undefined
            ? "not signed in yet"
            : agent.firstSignIn === "account"
              ? "not signed in yet, its account confirmed at the host"
              : "not signed in yet, its account not confirmed",
        ]
      : []),
    ...(person.status === "active" ? [] : ["deactivated"]),
  ].join(", ");
  return `@${person.handle ?? person.login}  ${called.join(", ")}  (${standing})`;
}

/** What stands for a model or an effort nobody chose: whatever the product runs with by itself. */
const OWN_CHOICE = "the product's own";

/**
 * One agent account in full: its line, how it stands, what its runner last said of itself and
 * what was chosen for it, where the asker is answered that, and whether they supervise it.
 */
export function formatAgent(agent: RestAgent, now: number): string {
  const runner = agent.runner ?? null;
  return [
    formatAgentLine(agent),
    `state: ${formatAgentState(agent)}`,
    ...formatAgentUsage(agent.usage, now),
    ...(runner === null
      ? []
      : [
          ...(runner.machine === null
            ? []
            : [
                `runner: ${runner.runner ?? "?"} on ${runner.machine.name} (${runner.machine.os}), as ${runner.machine.user}`,
              ]),
          ...(runner.product === null
            ? []
            : [
                `product: ${runner.product.name} ${runner.product.version ?? "of a version it did not say"}${runner.product.tried ? "" : ", a version the driver was not tried with"}`,
              ]),
          `set to: model ${runner.settings.model ?? OWN_CHOICE}, effort ${runner.settings.effort ?? OWN_CHOICE}`,
          ...(runner.running === null
            ? []
            : [
                `runs with: model ${runner.running.model ?? OWN_CHOICE}, effort ${runner.running.effort ?? OWN_CHOICE}`,
              ]),
          `signals: ${runner.delivered} of ${runner.latest} delivered`,
          ...(runner.sources === undefined || runner.sources.length === 0
            ? []
            : [
                `wake sources beside the console: ${runner.sources.map(formatWakeSource).join("; ")}`,
              ]),
        ]),
    ...(agent.hours === undefined
      ? []
      : [
          `day: starts ${agent.hours.dayStart}${agent.hours.dayEnd === null ? ", with no end" : `, ends ${agent.hours.dayEnd}`}, in the workspace's time zone`,
        ]),
    ...(agent.accounts === undefined || Object.keys(agent.accounts).length === 0
      ? []
      : [
          `accounts elsewhere: ${Object.entries(agent.accounts)
            .map(([service, name]) => `${service} ${name}`)
            .join(", ")}`,
        ]),
    agent.supervised
      ? "You supervise it: an administrator, or above it in the reporting line."
      : "You do not supervise it.",
  ].join("\n");
}

/**
 * What an agent account's product last said of what its subscription allows (ADR-0156), a line:
 * each window that still stands with how much of it is used and when it resets, then when the
 * product said so. Nothing where it has said none.
 */
export function formatAgentUsage(usage: RestAgent["usage"], now: number): string[] {
  const standing = usageStanding(usage, now);
  if (standing.length === 0) {
    return [];
  }
  // When they were said: once where the product said them together, beside each where not.
  const together = usageSaidTogether(standing);
  const windows = standing.map((window) => {
    const share =
      window.used === null
        ? usageNear(window)
          ? "near its limit"
          : "of a share its product did not say"
        : `${usedHundredths(window.used)}% used${window.used < 1 && usageNear(window) ? ", near its limit" : ""}`;
    return `${window.name} ${share}${window.resetsAt === null ? "" : `, resets ${moment(window.resetsAt)}`}${together === undefined ? `, said ${moment(window.at)}` : ""}`;
  });
  return [
    `usage: ${windows.join("; ")}${together === undefined ? "" : ` (as its product said ${moment(together)})`}`,
  ];
}

/** A wake source as its runner last said it stands (ADR-0144): listening and since when, or not, and why. */
export function formatWakeSource(source: NonNullable<RestAgentRunner["sources"]>[number]): string {
  const why = source.why === undefined ? "" : ` (${source.why})`;
  return source.state === "connected"
    ? `${source.name} connected since ${moment(source.since)}`
    : `${source.name} ${source.state}${why} since ${moment(source.since)}`;
}

/** A wake an agent account keeps for later (ADR-0145): what it is called, when it is raised, and the first words of what it says. */
export function formatOwnWakeLine(wake: RestOwnWake): string {
  const words = wake.text.replaceAll(/\s+/g, " ").trim();
  const said =
    words.length === 0 ? "" : `  ${words.length > 120 ? `${words.slice(0, 119)}…` : words}`;
  return `to come  ${wake.key}  ${moment(wake.at)}${said}`;
}

/**
 * How an agent account stands (ADR-0085), in a few words: the state, why, since when, until when
 * where its runner said, as when a usage limit resets (ADR-0150), and when its runner was last
 * heard from.
 */
export function formatAgentState(agent: RestAgent): string {
  const state = agent.state ?? null;
  if (state === null) {
    return "no runner has been heard from yet";
  }
  const reason = state.reason === null ? "" : ` (${state.reason.replaceAll("_", " ")})`;
  const until =
    state.until === undefined || state.until === null ? "" : `, until ${moment(state.until)}`;
  const heard =
    state.heardAt === null ? "" : `; its runner was last heard from ${moment(state.heardAt)}`;
  return `${state.state}${reason} since ${moment(state.since)}${until}${heard}`;
}

/**
 * One signal of an agent account's record (ADR-0085): its number, its kind, who sent it or where
 * it came from, when, and the first words of what it says.
 */
export function formatSignalLine(signal: RestSignal, delivered?: number): string {
  const who =
    signal.by === null
      ? `${signal.source}${signal.key === null ? "" : `: ${signal.key}`}`
      : `${calledOf(signal.by)}${signal.agent === null ? "" : ` through ${signal.agent}`}`;
  const set =
    signal.set === null
      ? ""
      : `  model ${signal.set.model ?? OWN_CHOICE}, effort ${signal.set.effort ?? OWN_CHOICE}`;
  const words = signal.text.replaceAll(/\s+/g, " ").trim();
  const said =
    words.length === 0 ? "" : `  ${words.length > 120 ? `${words.slice(0, 119)}…` : words}`;
  // Whether it is delivered, where the record says how far it is (ADR-0131): the product took
  // it or the record says what became of it, or it waits for that. An answer that does not
  // say, the one to a signal just sent, has nothing said here.
  const state =
    delivered === undefined ? "" : signal.number <= delivered ? "delivered  " : "waiting  ";
  return `#${signal.number}  ${signal.kind}  ${state}${who}  ${moment(signal.at)}${set}${said}`;
}

/** One secret of an agent account's store (ADR-0087): its name, when it was set and by which side, and the day it ends on where one is known. Never its value. */
export function formatSecretLine(secret: RestAgentSecret): string {
  const facts = [
    `set ${moment(secret.setAt)}`,
    ...(secret.seeded ? ["seeded by a supervisor"] : []),
    ...(secret.expiresOn === null ? [] : [`ends on ${secret.expiresOn}`]),
  ];
  return `${secret.name}  (${facts.join(", ")})`;
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
  const services = Object.entries(workspace.services ?? {}).filter(
    (entry): entry is [string, Record<string, string>] => entry[1] !== undefined,
  );
  return [
    `workspace ${workspace.name}`,
    `handle: ${workspace.handle ?? "none"}  domain: ${workspace.domain ?? "none"}  (what a name at a service is put together from, with an agent account's handle)`,
    ...(services.length === 0
      ? ["services: none  (what the agents' accounts are made at: identity, git, messenger)"]
      : services.map(
          ([role, service]) =>
            `service ${role}: ${[
              service.kind ?? "?",
              ...Object.entries(service)
                .filter(([name]) => name !== "kind")
                .map(([name, value]) => `${name}=${value}`),
            ].join(", ")}`,
        )),
    `people visibility: ${visibility}  (${visibility === "everyone" ? "everyone sees everyone" : "a member sees only the people they share a project with; an administrator sees everyone"})`,
    `week begins on: ${workspace.weekStart ?? "auto"}  (auto: the system default, as each device has it)`,
    `time zone: ${zone ?? "none"}  (${zone === null ? "moments are printed as the API gives them, in UTC" : "moments are printed in it, as ISO 8601 with its offset"})`,
    `language: ${workspace.language ?? "none"}  (${workspace.language == null ? "whoever has not chosen a language reads English, and the plugins write to them in it" : "whoever has not chosen a language reads it, and the plugins write to them in it"})`,
    `skills: ${workspace.skills.address ?? "no address of the organization's"}  at ${workspace.skills.source}`,
    `SkillCDN token: ${token === null ? "none" : `set ${moment(token.setAt)}`}  (${token === null ? "the organization's pack is read with none" : "the organization's pack is read with it by a project with no address and no token of its own"})`,
    `token days at most: ${workspace.tokenDaysAtMost ?? "a person chooses"}`,
  ].join("\n");
}

/** One member of a project: their login, what they are in it, and since when. */
export function formatMemberLine(member: RestMember): string {
  return `${calledOf(member.person)}  ${member.role}  (since ${moment(member.addedAt).slice(0, 10)})`;
}

/** The line under a page of a listing that has more after it: how to ask for the next page. */
export function formatMore(more: boolean, limit: number, offset: number): string {
  return more ? `\n... more: --offset ${offset + limit}` : "";
}

/**
 * What a member is called in a line: an agent account by its handle, `@mira`, which the command
 * takes wherever it takes a login (ADR-0084), so that a line tells an agent account from a
 * person; a person by their login.
 */
export const calledOf = (person: Pick<RestPerson, "login" | "handle">): string =>
  typeof person.handle === "string" ? `@${person.handle}` : person.login;

/** The members at work on a task as a line calls them, in the order they came to it. */
const logins = (people: readonly RestPerson[]): string => people.map(calledOf).join(", ");

export function formatTaskLine(task: RestTaskBrief): string {
  const notes = [`owner ${calledOf(task.owner)}`];
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
  runs?: readonly RestRunBrief[],
  comments?: readonly RestComment[],
  /** The address of the task's page at the console, where the command knows it: what a person is given to open. */
  page?: string,
  /** Whether the task tells the member anything (ADR-0157), where the command read it. */
  follow?: RestTaskFollow | null,
): string {
  const lines = [
    `#${task.number} ${task.title}`,
    `state: ${task.state}  priority: ${task.priority}  owner: ${calledOf(task.owner)}  workers: ${task.workers.length === 0 ? "nobody" : logins(task.workers)}`,
    `id: ${task.id}${task.parentId === null ? "" : `  part of: ${task.parentId}`}`,
    ...(page === undefined ? [] : [pageLine(page)]),
    ...(task.agent == null ? [] : [`written through: ${task.agent}`]),
    ...(follow == null
      ? []
      : [`notifications: ${follow.on ? "on" : "off"}, ${toldOfTask(follow)}`]),
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
    comment.agent === null
      ? calledOf(comment.author)
      : `${calledOf(comment.author)} as ${comment.agent}`;
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

export function formatRunLine(run: RestRunBrief): string {
  // A run of a listing comes without its reports, counted (`?brief=true`); a run read whole,
  // with them.
  const notes = [plural(reportCountOf(run), "report"), plural(run.artifacts.length, "artifact")];
  if (run.waitingFor !== null) {
    notes.push(`waiting for decision ${run.waitingFor}`);
  }
  if (run.endedAt === null) {
    notes.push(`last heard ${moment(run.lastHeardAt)}`);
  }
  return `${run.id}  ${run.status}  ${run.agent} for ${calledOf(run.person)}  task #${run.taskNumber}  (${notes.join(", ")})`;
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

/** When a part of the rules was written and by whom, where a page says; nothing for the console's own. */
function rulesFacts(page: RestRules["page"]): string {
  return page === null
    ? ""
    : ` (v${page.version}, by ${writer(page.updatedBy, page.agent)}; ${moment(page.updatedAt)})`;
}

/** A part of the rules that has a text: what it is, who wrote it where someone did, and the text as it stands. */
const formatRulesPart = (head: string, page: RestRules["page"], body: string): string =>
  `${head}${rulesFacts(page)}:\n\n${body.trimEnd()}`;

/**
 * The parts of the rules as they are printed for whoever reads them (ADR-0120): what the
 * project adds where the command works in one and it adds something, the plugins' lines in the
 * language they are read in, what the organization adds where it adds something, and the
 * console's rules, which always hold.
 */
function rulesParts(rules: RestProjectRules | RestRules, language: string | null | undefined) {
  const named = "workspace" in rules;
  const workspace = named ? rules.workspace : rules;
  const project = named && rules.project.source !== "none" ? rules.project : undefined;
  const count = rules.plugins?.length ?? 0;
  const added = workspace.added ?? null;
  return {
    /** Whether the command works in a project: its rules were asked for, whether it adds any or not. */
    named,
    workspace,
    /** What the project adds, where it adds something. */
    own: project !== undefined && project.body !== null ? project : undefined,
    plugins:
      rules.plugins === undefined || count === 0
        ? undefined
        : formatRulesPlugins(rules.plugins, language),
    pluginCount: count,
    /** What the organization adds, where it adds something. */
    added: added === null ? undefined : added,
    /** The console's rules by themselves. */
    console: workspace.own ?? "",
  };
}

/**
 * The mark of the rules (ADR-0119): the first eight hex characters of a SHA-256 over what they
 * say to whoever reads them: the workspace's text whole, which is the console's rules with
 * what the organization adds (ADR-0120), what the project adds, and the plugins' lines, in the
 * language they are read in. A session that was shown the rules holds their mark, and a later
 * take of that session leaves out the rules the mark stands for; nothing but having been shown
 * them gives it. When they were written and by whom is no part of it: the same rules have the
 * same mark, and a project that adds nothing has the workspace's.
 */
export function rulesMark(
  rules: RestProjectRules | RestRules,
  language?: string | null | undefined,
): string {
  const parts = rulesParts(rules, language);
  return createHash("sha256")
    .update(
      JSON.stringify([
        (parts.workspace.body ?? "").trimEnd(),
        parts.own === undefined ? null : (parts.own.body ?? "").trimEnd(),
        parts.plugins ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 8);
}

/** How long a text of the rules is, as its first line says it. */
const charactersOf = (text: string | null): string => `${(text ?? "").trimEnd().length} characters`;

/**
 * The rules that hold, under a first line that says what follows (ADR-0119): the mark, which
 * parts there are and how long each is, and how a later take of the session leaves them out.
 * What differs stands first and what always holds last (ADR-0120): what the project adds with
 * the plugins' lines, then what the organization adds, then the console's rules. An agent that
 * had read the long part once cut every later print at its head, and never saw what stood
 * after it; and where they differ it is the earlier part that holds. Who adds nothing is said
 * in a clause of the line, and has no part.
 */
export function formatRules(
  rules: RestProjectRules | RestRules,
  language?: string | null | undefined,
): string {
  const parts = rulesParts(rules, language);
  const mark = rulesMark(rules, language);
  const last = `the console's (${charactersOf(parts.console)})`;
  const lastFollows = `the console's follow (${charactersOf(parts.console)})`;
  const plugins = `${parts.pluginCount} plugin${parts.pluginCount === 1 ? "" : "s"}`;
  const HOLDS = "the earlier holding where they differ";
  /** The organization's part and the last, after whatever stood before them. */
  const rest = (first: boolean): string =>
    parts.added === undefined
      ? last
      : `the organization's${first ? " additions first" : ""} (${charactersOf(parts.added.body)}), then ${last}`;
  let follows: string;
  if (parts.own !== undefined) {
    follows = `this project's additions first (${charactersOf(parts.own.body)})${parts.plugins === undefined ? "" : ` with its ${plugins}`}, then ${rest(false)}, ${HOLDS}${parts.added !== undefined ? "" : "; the organization adds nothing"}.`;
  } else {
    const nobody = parts.added === undefined;
    const lead = parts.named
      ? nobody
        ? "this project and the organization add nothing; "
        : "this project adds nothing; "
      : nobody
        ? "the organization adds nothing; "
        : "";
    const theirs = parts.named ? `its ${plugins}` : `the ${plugins} you may use`;
    const body =
      parts.plugins !== undefined
        ? `${theirs} first, then ${parts.added === undefined ? last : `the organization's additions (${charactersOf(parts.added.body)}), then ${last}, ${HOLDS}`}`
        : parts.added === undefined
          ? lastFollows
          : `${rest(true)}, ${HOLDS}`;
    follows = `${lead}${body}${parts.named ? "." : "; no project is named here, and a project's additions stand before them where it has some."}`;
  }
  // The mark ends the line bare, so that it is copied as it is.
  const later = parts.named
    ? ` A later take in this session leaves them out: console take <number> --rules ${mark}`
    : "";
  return [
    `Rules ${mark}: ${follows}${later}`,
    ...(parts.own === undefined
      ? []
      : ["", formatRulesPart("What this project adds", parts.own.page, parts.own.body ?? "")]),
    ...(parts.plugins === undefined ? [] : ["", parts.plugins]),
    ...(parts.added === undefined
      ? []
      : ["", formatRulesPart("What this organization adds", parts.added.page, parts.added.body)]),
    "",
    formatRulesPart("The console's rules, which always hold", null, parts.console),
  ].join("\n");
}

/** What a take says, before the task, where it was told the mark the rules have (ADR-0119): they are left out. */
export const formatRulesLeftOut = (mark: string): string =>
  `Rules ${mark}: left out, since they stand as this session read them. console rules prints them.`;

/**
 * What a take says, before the task, where it was told a mark the rules do not have (ADR-0119):
 * the rules then follow the task whole, as they do without a mark.
 */
export const formatRulesChanged = (given: string): string =>
  `The rules are not the ones marked ${given}: they changed since, or that mark is of another project's. They follow whole after the task, under the mark they have now.`;

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
export function formatGoal(goal: RestGoal, tasks?: readonly RestTaskBrief[]): string {
  const lines = [
    `goal ${goal.id}: ${goal.title}`,
    `state: ${goal.state}  category: ${goal.category?.key ?? "none"}  starts: ${goal.startsOn ?? "none"}  due: ${goal.dueOn ?? "none"}  set by: ${calledOf(goal.createdBy)}${through(goal.agent)}`,
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
    return `No open task is on ${calledOf(person)}'s plate.`;
  }
  return [
    `tasks ${calledOf(person)} works on:`,
    ...work.tasks.map(({ project, task }) => `  ${project.key}  ${formatTaskLine(task)}`),
  ].join("\n");
}

/** The agent a thing came through, beside the person (ADR-0056); nothing when they did it themselves. */
const through = (agent: string | null | undefined): string =>
  agent === null || agent === undefined ? "" : ` through ${agent}`;

/** Everyone a decision is addressed to (ADR-0057): `deciders` where the console answers it, else the one decider. */
const decidersOf = (decision: RestDecision): readonly RestPerson[] =>
  decision.deciders !== undefined && decision.deciders.length > 0
    ? decision.deciders
    : [decision.decider];

/** The logins of everyone a decision is addressed to, with commas between. */
export const deciderLogins = (decision: RestDecision): string =>
  decidersOf(decision).map(calledOf).join(", ");

/** Whom a decision is for, where that is not the one who asked alone (ADR-0042, ADR-0057). */
const addressed = (decision: RestDecision): string =>
  decidersOf(decision).every((person) => person.id === decision.raisedBy.id)
    ? ""
    : `, for ${deciderLogins(decision)}`;

/**
 * One decision in a line, with when it was asked: a decision that waits holds a run, and whoever
 * is told what is on their plate is told since when each one waits.
 */
export function formatDecisionLine(decision: RestDecision): string {
  const state = decision.answer === null ? "waiting" : `answered ${decision.answer.option}`;
  return `${decision.id}  ${state}  ${decision.question}  (asked by ${asker(decision)}${addressed(decision)}, at ${moment(decision.createdAt)})`;
}

/** The options, one a line; the person's own answer, when they wrote one, is the last and says so. */
export function formatOptions(decision: RestDecision): string {
  return decision.options
    .map(
      (option) =>
        `  ${option.id}) ${option.label}${option.key === undefined ? "" : `  [${option.key}]`}${option.own === true ? "  (the person's own answer, not one given)" : ""}`,
    )
    .join("\n");
}

/** The answer, with who gave it, and that it is in their own words when it is; or that there is none yet. */
export function formatAnswer(decision: RestDecision): string {
  const { answer } = decision;
  if (answer === null) {
    return `waits for ${deciderLogins(decision)}.`;
  }
  const chosen = decision.options.find((option) => option.id === answer.option);
  const lines = [
    `Answered: ${answer.option}) ${chosen?.label ?? answer.option}${chosen?.own === true ? ", in their own words" : ""}, by ${calledOf(answer.by)}${through(answer.agent)} at ${moment(answer.at)}`,
  ];
  if (answer.note !== null && answer.note.length > 0) {
    lines.push(`Note: ${answer.note}`);
  }
  return lines.join("\n");
}

/**
 * The address of a task's or a decision's page, on a line of its own: what an agent gives a
 * person to open, in place of the console's front page, or of a number a git host would take
 * for an issue of its own.
 */
export const pageLine = (page: string): string => `page: ${page}`;

/**
 * One decision in full. A decision reached at its own address (ADR-0068), outside the project the
 * command works in, names its files with the command that reads them there, by the decision too:
 * the project's own address knows nothing of it.
 */
export function formatDecision(
  decision: RestDecision,
  options: {
    readonly atItsAddress?: boolean;
    /** The address of the decision's page at the console, where the command knows it. */
    readonly page?: string | undefined;
  } = {},
): string {
  const reads = (fileId: string): string =>
    options.atItsAddress === true
      ? `console file ${fileId} --decision ${decision.id}`
      : `console file ${fileId}`;
  const lines = [
    `decision ${decision.id}: ${decision.question}`,
    `asked by ${asker(decision)}${addressed(decision)}${decision.taskNumber === null ? "" : `, about task #${decision.taskNumber}`}, at ${moment(decision.createdAt)}`,
    ...(options.page === undefined ? [] : [pageLine(options.page)]),
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
          `file: ${attached.file.name} (${attached.file.size} bytes, ${attached.file.contentType}): ${reads(attached.id)}`,
      ),
    );
  }
  lines.push("", "options:", formatOptions(decision), "", formatAnswer(decision));
  if (decision.outcome !== null && decision.outcome.trim().length > 0) {
    lines.push("", "what followed:", indent(decision.outcome));
    if (decision.outcomeBy != null && decision.outcomeAt != null) {
      lines.push(
        indent(
          `written by ${calledOf(decision.outcomeBy)}${through(decision.outcomeAgent)} at ${moment(decision.outcomeAt)}`,
        ),
      );
    }
  }
  return lines.join("\n");
}

/** Who wrote a version, and through which agent. */
const writer = (by: { readonly login: string }, agent: string | null): string =>
  agent === null ? calledOf(by) : `${agent} for ${calledOf(by)}`;

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
    plugin.console === null || plugin.console === undefined
      ? undefined
      : `console: ${plugin.console}`,
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

/**
 * How a command or a query of a plugin is given, as help prints it: the positionals, then the
 * flags. In brief, for a listing that an agent reads whole at every first use, the positionals
 * and the required flags alone, the rest as `[options]`, since `help <command>` has them all.
 */
export function formatOperationUsage(
  key: string,
  operation: RestPluginOperation,
  { brief = false }: { readonly brief?: boolean } = {},
): string {
  const entries = Object.entries(operation.args);
  const shown = brief ? entries.filter(([, arg]) => arg.positional || !arg.optional) : entries;
  const usage = [
    ...shown.filter(([, arg]) => arg.positional).map(([name, arg]) => argUsage(name, arg)),
    ...shown.filter(([, arg]) => !arg.positional).map(([name, arg]) => argUsage(name, arg)),
    ...(brief && shown.length < entries.length ? ["[options]"] : []),
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
        formatOperationUsage(detail.key, operation, { brief: true }),
        `    ${operation.kind === "query" ? "[query] " : ""}${operation.about}`,
      ]),
      "",
      `One in full, with every option: console plugin ${detail.key} help <command>.`,
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

/** When a secret was set, from where where it was sealed from an answer, and when it expires: never what it holds. */
function secretStanding(standing: {
  readonly setAt: string | null;
  readonly source?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
}): string {
  return `set${standing.setAt === null ? "" : ` ${moment(standing.setAt)}`}${
    standing.source === null || standing.source === undefined || standing.source === "administrator"
      ? ""
      : ` from ${standing.source}`
  }${standing.expiresAt === null || standing.expiresAt === undefined ? "" : `, expires ${moment(standing.expiresAt)}`}`;
}

/**
 * A setting in a line: its key and type, what it holds or whether it is set, and its name; for a
 * secret kept per key (ADR-0111), how many keys of how many, and a line under it for each key.
 */
export function formatPluginSettingLine(
  setting: RestPluginSetting,
  language: string | null | undefined,
): string {
  const keys = setting.keys ?? null;
  if (setting.type === "secret" && keys !== null) {
    const max = setting.keyed?.max;
    const count = `${keys.length}${max === undefined ? "" : ` of ${max}`} ${keys.length === 1 && max === undefined ? "key" : "keys"}`;
    return [
      `  ${setting.key} (secret, per key): ${count}  ${localized(setting.name, language)}`,
      ...keys.map((kept) => `    ${kept.key}: ${secretStanding(kept)}`),
    ].join("\n");
  }
  const holds =
    setting.type === "secret"
      ? setting.set
        ? secretStanding(setting)
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
    grant.plugin !== null && grant.plugin !== undefined
      ? `the plugin ${grant.plugin}`
      : grant.team !== null && grant.team !== undefined
        ? `the team ${grant.team.key}`
        : grant.person !== null
          ? `person ${calledOf(grant.person)}`
          : grant.project !== null
            ? `the members of ${grant.project.key}`
            : "everyone";
  return `${grant.id}  ${grant.role} to ${whom}  since ${moment(grant.createdAt)}`;
}

/** A team in a line (ADR-0073): its key (ADR-0074), its name, how many are in it, and their logins. */
export function formatTeamLine(team: RestTeam, loginOf: ReadonlyMap<string, string>): string {
  const logins = team.memberIds.map((id) => loginOf.get(id) ?? id);
  const count = team.memberIds.length === 1 ? "1 member" : `${team.memberIds.length} members`;
  return `${team.key}  ${team.name}  ${count}${logins.length === 0 ? "" : `: ${logins.join(", ")}`}`;
}

/**
 * A job of a plugin in a line (ADR-0128): its name and how often it runs, how its last run went
 * and since when it has failed where it keeps failing, and when it runs next.
 */
export function formatPluginJobLine(job: RestPluginJob): string {
  const schedule = `every ${job.every}${job.at === null ? "" : ` at ${job.at}`}`;
  const last =
    job.lastRunAt === null || job.lastOutcome === null
      ? "has not run yet"
      : `last run ${moment(job.lastRunAt)}: ${job.lastOutcome}${
          job.lastOutcome === "failed" && job.failedSince !== null
            ? `, failing since ${moment(job.failedSince)}`
            : ""
        }`;
  return `  ${job.name}  ${schedule}  ${last}  next: ${job.nextAt === null ? "not scheduled" : moment(job.nextAt)}`;
}

/** What an event of a plugin says, after its kind: what failed, which command and how it ended, else what it carries. */
function pluginEventSays(event: RestEvent): string {
  const data = event.data;
  if (event.kind === "plugin.failed") {
    return data.problem ?? "";
  }
  if (event.kind === "plugin.command") {
    return `${data.command ?? "?"} ${data.outcome ?? "?"}${data.code === undefined ? "" : ` (${data.code})`}${
      data.durationMs === undefined ? "" : `, ${data.durationMs} ms`
    }`;
  }
  const carried = JSON.stringify(data);
  return carried === "{}" ? "" : carried.length > 300 ? `${carried.slice(0, 300)}...` : carried;
}

/** Who did what an event says, as a line names them: the member, with the agent they acted as, or the console. */
const eventBy = (event: RestEvent): string =>
  event.actor === null
    ? "the console"
    : `${calledOf(event.actor)}${event.agent === null ? "" : ` as ${event.agent}`}`;

/** One event of a plugin in a line: its number, when, its kind, who did it and through what, and what it says. */
export function formatPluginEventLine(event: RestEvent): string {
  const says = pluginEventSays(event);
  return `#${event.id}  ${moment(event.createdAt)}  ${event.kind}  ${eventBy(event)}${says === "" ? "" : `  ${says}`}`;
}

/**
 * A page of a plugin's events, newest first (ADR-0128), of one kind where one was asked for:
 * what `console plugin <key> events` prints, with how to read on. The console answers what the
 * caller may read and says nothing of the rest, so an empty page is said as that, and never as
 * a plugin that has no events.
 */
export function formatPluginEvents(
  key: string,
  page: RestEvents,
  asked: { readonly kind: string | undefined; readonly limit: number; readonly offset: number },
): string {
  if (page.items.length === 0) {
    const none = `No ${asked.kind === undefined ? "" : `${asked.kind} `}event of ${key} that you may read${
      asked.offset > 0 ? ", that far back" : ""
    }.`;
    return `${none}${formatMore(page.more, asked.limit, asked.offset)}`;
  }
  return `${page.items.map(formatPluginEventLine).join("\n")}${formatMore(page.more, asked.limit, asked.offset)}`;
}

/**
 * One notification in a line (ADR-0157): its id, which `--read` takes; whether the member read
 * it; when; why they are told, the kind and that they turned the task on where that is why; the
 * project's key where it happened in one; and what happened, who did it and then the feed's own
 * sentence for the event. What an event carries is what someone wrote, so the line is kept one.
 * A task is named in the sentence by its number; a decision is not, so its id follows, which
 * the commands that read and answer it take.
 */
export function formatNotificationLine(notification: RestNotification): string {
  const { event, project } = notification;
  const why = `${notification.kind}${notification.followed ? " (followed)" : ""}`;
  const happened = `${eventBy(event)} ${describeEvent(event)}`.replaceAll(/\s+/g, " ");
  const decision = event.decisionId === null ? "" : `  (decision ${event.decisionId})`;
  return `${notification.id}  ${notification.readAt === null ? "unread" : "read"}  ${moment(notification.createdAt)}  ${why}  ${project === null ? "" : `${project.key}  `}${happened}${decision}`;
}

/**
 * A page of one's notifications, the newest first: a line each, then how many are not read
 * yet, with what marks them read where some are, and how the next page is asked for.
 */
export function formatNotifications(
  page: RestNotifications,
  asked: { readonly unread: boolean; readonly limit: number; readonly offset: number },
): string {
  const more = formatMore(page.more, asked.limit, asked.offset);
  if (page.items.length === 0) {
    return `${asked.unread ? "No unread notifications" : "No notifications"}${asked.offset > 0 ? " that far back" : ""}.${more}`;
  }
  const unread =
    page.unread === 0
      ? "None unread."
      : `${page.unread} unread. Mark read: console notifications --read <id> [<id>...], or --read-all.`;
  return `${page.items.map(formatNotificationLine).join("\n")}\n${unread}${more}`;
}

/** What each kind of notification is of (`NOTIFICATION_KINDS`), in a few words said to the member. */
const NOTIFICATION_KIND_WORDS: Readonly<Record<NotificationKind, string>> = {
  assigned: "a task was given to you, as its owner or to work on",
  ready: "a task you work on is ready to begin",
  moved: "a task you own went from one state to another",
  changed: "the title, the body or the days of a task of yours changed",
  commented: "someone wrote on a task of yours",
  archived: "a task of yours was put away",
  decision: "a decision waits for you",
  answered: "a decision you raised was answered",
  agent:
    "an agent account that reports to you stopped, was refused, failed or is not heard from, or runs again, or raised a decision for you",
};

const onOrOff = (value: boolean): string => (value ? "on" : "off");

/**
 * What a member is told of (ADR-0157): a line per kind, on or off, with what it is of and, where
 * they chose otherwise, what it is for a member who chose nothing; then the projects they are
 * told nothing of, and whether what an agent of their own did as them counts. The kinds stand
 * in the vocabulary's order, and one a newer console answers after them, by its name alone.
 */
export function formatNotificationSettings(settings: RestNotificationSettings): string {
  const known: readonly string[] = NOTIFICATION_KINDS;
  const kinds = [
    ...NOTIFICATION_KINDS.filter((kind) => Object.hasOwn(settings.kinds, kind)),
    ...Object.keys(settings.kinds).filter((kind) => !known.includes(kind)),
  ];
  const words: Readonly<Record<string, string | undefined>> = NOTIFICATION_KIND_WORDS;
  return [
    ...kinds.map((kind) => {
      const told = settings.kinds[kind] === true;
      const usual = settings.defaults[kind];
      const what = words[kind];
      return `${kind}  ${onOrOff(told)}${what === undefined ? "" : `  ${what}`}${usual === undefined || usual === told ? "" : `  (default: ${onOrOff(usual)})`}`;
    }),
    `projects off: ${settings.projectsOff.length === 0 ? "none" : settings.projectsOff.map((project) => `${project.key} (${project.name})`).join(", ")}`,
    `own agents: ${onOrOff(settings.ownAgents)}  (${settings.ownAgents ? "what an agent of your own did as you is told to you too" : "what an agent of your own did as you is not told to you"})`,
  ].join("\n");
}

/** What holds of a task's notifications for a member (ADR-0157), in the words that follow on or off. */
const toldOfTask = (follow: RestTaskFollow): string =>
  follow.on
    ? follow.all
      ? "turned on by you: you are told of everything that happens on it"
      : "as your settings have it"
    : follow.usual
      ? "turned off by you: you are told of nothing of it"
      : "as your settings have it";

/**
 * Whether a task tells a member anything, once they turned its notifications on or off
 * (ADR-0157), in a line, with what turns them the other way.
 */
export function formatTaskFollow(
  task: Pick<RestTask, "number" | "title">,
  follow: RestTaskFollow,
): string {
  const named = `Notifications of #${task.number} ${task.title} are ${follow.on ? "on" : "off"}`;
  const other = follow.on
    ? `Turn them off: console task mute ${task.number}`
    : `Turn them on: console task follow ${task.number}`;
  if (follow.on ? !follow.all : !follow.usual) {
    return `${named}, as your settings have it${follow.on ? ": you are told of it by the kinds you have on (console notify)" : ""}. ${other}`;
  }
  return `${named}: ${follow.on ? "you are told of everything that happens on it" : "you are told of nothing of it"}. ${other}`;
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
  if (detail.console !== null && detail.console !== undefined) {
    lines.push(`Runs on consoles ${detail.console}.`);
  }
  lines.push(
    detail.roles.length === 0
      ? "You hold no role in it."
      : `Your roles in it: ${detail.roles.join(", ")}.`,
  );
  if (detail.board !== null) {
    lines.push(`Board project: ${detail.board.key} (${detail.board.name}).`);
  } else if (detail.boardNeeds !== "none") {
    // What `enable --board new` would make, where the plugin proposes one: its key and name,
    // and the mark it names for it (ADR-0155).
    const proposed = detail.boardDefaults;
    const mark =
      proposed === null
        ? ""
        : [
            proposed.glyph == null ? undefined : `the icon ${proposed.glyph}`,
            proposed.color == null ? undefined : `on ${proposed.color}`,
          ]
            .filter((word) => word !== undefined)
            .join(" ");
    lines.push(
      proposed === null
        ? "Board project: none yet."
        : `Board project: none yet. enable --board new makes ${proposed.key} (${localized(proposed.name, language)})${mark === "" ? "" : `, marked with ${mark}`}.`,
    );
  }
  lines.push("");
  if (detail.operations.length === 0) {
    lines.push("No command or query you may run.");
  } else {
    lines.push("Commands and queries:");
    for (const operation of detail.operations) {
      lines.push(
        `  ${formatOperationUsage(detail.key, operation, { brief: true })}`,
        `      ${operation.kind === "query" ? "[query] " : ""}${operation.about}`,
      );
    }
    lines.push(`One in full, with every option: console plugin ${detail.key} help <command>.`);
  }
  if (detail.skills !== null) {
    lines.push(
      "",
      `Skills: console plugin ${detail.key} skills lists them; console plugin ${detail.key} skill <path> reads one. Read the one that fits before the first command.`,
    );
  }
  // A plugin without jobs has nothing printed of them, not an empty block.
  if (detail.jobs !== undefined && detail.jobs.length > 0) {
    lines.push(
      "",
      `Jobs (what went wrong in one: console plugin ${detail.key} events --kind plugin.failed):`,
      ...detail.jobs.map(formatPluginJobLine),
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
  lines.push(...formatPluginAsks(detail, language));
  return lines.join("\n");
}

/**
 * The roles the plugin asks of other plugins (ADR-0072), each with how it stands and, where not
 * granted, the command that grants it; nothing where it asks none.
 */
export function formatPluginAsks(
  detail: RestPluginDetail,
  language: string | null | undefined,
): string[] {
  const asks = detail.asks ?? [];
  if (asks.length === 0) {
    return [];
  }
  return [
    "",
    "Asks of other plugins:",
    ...asks.map((ask) => {
      const standing =
        ask.state === "granted"
          ? "granted"
          : ask.state === "unavailable"
            ? `${ask.plugin} is not enabled`
            : `not granted; console plugin ${ask.plugin} grant ${ask.role} --plugin ${detail.key}`;
      return `  ${ask.role} of ${ask.plugin}: ${standing}  ${localized(ask.why, language)}`;
    }),
  ];
}

/** What a command or a query answered, as the command prints it. */
export function formatInvocation(result: RestPluginInvocation): string {
  if (result.kind === "query") {
    return result.data === undefined ? "null" : JSON.stringify(result.data, null, 2);
  }
  const text = result.text.length === 0 ? "Done." : result.text;
  if (result.waiting === null) {
    return text;
  }
  const where =
    result.project === null || result.project === undefined
      ? ""
      : ` in the project ${result.project}`;
  return `${text}\ndecision id: ${result.waiting}\nThe decision waits for a person${where}: console decision ${result.waiting} --wait 100`;
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
