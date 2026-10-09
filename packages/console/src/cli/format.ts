import { restPath } from "../routes.js";
import type { RestArtifact, RestDecision, RestRun, RestSkills, RestTask } from "../schemas.js";

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

export function formatTaskLine(task: RestTask): string {
  const notes = [`owner ${task.owner.login}`];
  if (task.assignee !== null) {
    notes.push(`assigned to ${task.assignee.login}`);
  }
  if (task.openDecisions > 0) {
    notes.push(`${plural(task.openDecisions, "decision")} waiting`);
  }
  if (task.openRuns > 0) {
    notes.push("an agent at work");
  }
  return `#${task.number}  ${task.state}  ${task.priority}  ${task.title}  (${notes.join("; ")})`;
}

/** One task in full; with the decisions about it and the runs on it, when given. */
export function formatTask(
  task: RestTask,
  decisions?: readonly RestDecision[],
  runs?: readonly RestRun[],
): string {
  const lines = [
    `#${task.number} ${task.title}`,
    `state: ${task.state}  priority: ${task.priority}  owner: ${task.owner.login}  assignee: ${task.assignee?.login ?? "nobody"}`,
    `id: ${task.id}${task.parentId === null ? "" : `  part of: ${task.parentId}`}`,
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
  return lines.join("\n");
}

export function formatRunLine(run: RestRun): string {
  const notes = [plural(run.reports.length, "report"), plural(run.artifacts.length, "artifact")];
  if (run.waitingFor !== null) {
    notes.push(`waiting for decision ${run.waitingFor}`);
  }
  return `${run.id}  ${run.status}  ${run.agent} for ${run.person.login}  task #${run.taskNumber}  (${notes.join(", ")})`;
}

export function formatRun(run: RestRun): string {
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
      lines.push(`  ${formatArtifact(artifact)}`);
    }
  }
  return lines.join("\n");
}

/** What was handed in: the link, or the file with its size and where its bytes are read. */
export function formatArtifact(artifact: RestArtifact): string {
  const what =
    artifact.file === null
      ? (artifact.url ?? "")
      : `${artifact.file.name} (${artifact.file.size} bytes, ${artifact.file.contentType}; read at ${restPath("files", artifact.id)})`;
  return artifact.label === null ? what : `${artifact.label}: ${what}`;
}

const SKILLS_WORDS: Readonly<Record<Exclude<RestSkills["status"], "none" | "ready">, string>> = {
  indexing: "SkillCDN is still indexing the repository; ask again in a moment.",
  failed: "SkillCDN could not index the repository.",
  not_found: "SkillCDN does not serve this address to the console.",
  unavailable: "SkillCDN could not be reached; ask again later.",
};

/** The organization's skills: where they are, and each with what an agent loads it by. */
export function formatSkills(skills: RestSkills): string {
  if (skills.status === "none" || skills.address === null) {
    return "No skills address is configured on this console.";
  }
  const head = `skills at ${skills.address}, served by ${skills.source}: ${skills.status}`;
  if (skills.status !== "ready") {
    return `${head}\n${SKILLS_WORDS[skills.status]}`;
  }
  if (skills.items.length === 0) {
    return `${head}\nNo skills at this address.`;
  }
  const lines = [head];
  for (const skill of skills.items) {
    lines.push(`${skill.name}  ${skill.description}`, `    ${skill.uri ?? skill.path}`);
  }
  lines.push(
    "",
    "Load a skill by its URI through your SkillCDN connection. --json adds the page of each, for a person.",
  );
  return lines.join("\n");
}

export function formatDecisionLine(decision: RestDecision): string {
  const state = decision.answer === null ? "waiting" : `answered ${decision.answer.option}`;
  return `${decision.id}  ${state}  ${decision.question}  (asked by ${asker(decision)})`;
}

export function formatOptions(decision: RestDecision): string {
  return decision.options.map((option) => `  ${option.id}) ${option.label}`).join("\n");
}

/** The answer, with who gave it; or that there is none yet. */
export function formatAnswer(decision: RestDecision): string {
  const { answer } = decision;
  if (answer === null) {
    return "waits for a person.";
  }
  const label = decision.options.find((option) => option.id === answer.option)?.label;
  const lines = [
    `Answered: ${answer.option}) ${label ?? answer.option}, by ${answer.by.login} at ${answer.at}`,
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
  return lines.join("\n");
}
