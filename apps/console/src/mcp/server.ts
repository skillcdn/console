import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  hasForbiddenCodePoint,
  LIST_LIMIT,
  MAX_AGENT_LENGTH,
  MAX_ARTIFACTS_PER_RUN,
  MAX_BODY_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_REPORTS_PER_RUN,
  MAX_SUMMARY_LENGTH,
  MAX_URL_LENGTH,
  MIN_OPTIONS,
  RUN_ENDINGS,
  TASK_STATES,
} from "@skillcdn/console/api";
import * as z from "zod";
import type { Database } from "../db/client.js";
import {
  type DecisionRecord,
  getDecision,
  listDecisions,
  raiseDecision,
} from "../db/queries/decisions.js";
import { latestEventId } from "../db/queries/events.js";
import type { PersonRecord } from "../db/queries/people.js";
import {
  addArtifact,
  addReport,
  endRun,
  listRuns,
  type RunRecord,
  startRun,
} from "../db/queries/runs.js";
import { findTaskByNumber, getTask, listTasks, type TaskRecord } from "../db/queries/tasks.js";
import { DomainError } from "../errors.js";
import type { LiveFeed } from "../http/live-feed.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { APP_NAME, APP_VERSION } from "../version.js";

// The console as an MCP server to an agent (docs/specs/mcp.md): the tools an agent works the
// board with, as the person whose token it holds. One server per request: nothing is kept
// between calls but what the database holds. Everything an agent sends is parsed and bounded
// here and stored as data; everything it is told is text.

export interface AgentServerDependencies {
  readonly database: Database;
  readonly workspaceId: string;
  /** Who the token names, and which token: the agent is this person. */
  readonly caller: { readonly person: PersonRecord; readonly tokenId: string | undefined };
  /** Woken when the board changes: how a run learns that its decision was answered. */
  readonly feed: LiveFeed;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long `ask` and `await_decision` wait before saying that the decision still waits. */
  readonly waitMs: number;
}

const INSTRUCTIONS = [
  "This console is the board of an organization's work with AI agents. You act for the person whose token you hold, and everything you send is shown to people as text.",
  "Take a task with take_task (one agent per task), report as you go with report, hand in what you made with hand_in (a link to a branch, a pull request, a page), ask when a person must decide with ask, and finish with finish when the work is done, has failed, or you leave it. get_task shows a task with the decisions and runs about it.",
].join(" ");

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !hasForbiddenCodePoint(value), "must not contain control characters");
const body = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !hasForbiddenCodePoint(value, true), "must not contain control characters");
const uuid = z.uuid();
/** A task, as an agent names it: its id, or its number with or without the `#`. */
const taskRef = z.string().trim().min(1).max(40);

/** What a tool answers: JSON for the agent to read. */
const ok = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** What a tool answers when it cannot do what was asked: the code and the words, as text. */
const refused = (code: string, message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: `${code}: ${message}` }],
});

const taskSummary = (task: TaskRecord) => ({
  id: task.id,
  number: task.number,
  title: task.title,
  state: task.state,
  priority: task.priority,
  owner: task.owner.login,
  assignee: task.assignee?.login ?? null,
  openDecisions: task.openDecisions,
  openRuns: task.openRuns,
  updatedAt: task.updatedAt.toISOString(),
});

const runSummary = (run: RunRecord) => ({
  id: run.id,
  taskId: run.taskId,
  agent: run.agent,
  for: run.person.login,
  status: run.status,
  reports: run.reports.length,
  artifacts: run.artifacts.length,
  waitingFor: run.waitingFor ?? null,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt?.toISOString() ?? null,
});

const decisionSummary = (decision: DecisionRecord) => ({
  id: decision.id,
  question: decision.question,
  body: decision.body,
  options: decision.options,
  taskId: decision.taskId ?? null,
  status: decision.answer === undefined ? "waiting" : "answered",
  answer:
    decision.answer === undefined
      ? null
      : {
          option: decision.answer.option,
          label:
            decision.options.find((option) => option.id === decision.answer?.option)?.label ??
            decision.answer.option,
          note: decision.answer.note ?? null,
          by: decision.answer.by.login,
          at: decision.answer.at.toISOString(),
        },
});

export function createAgentServer(dependencies: AgentServerDependencies): McpServer {
  const { database, workspaceId, caller, feed, clock, logger, waitMs } = dependencies;
  const actorId = caller.person.id;
  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  /** Runs `work` and turns what the board refuses into a refusal the agent can read. */
  const attempt = async (work: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof DomainError) {
        return refused(error.code, error.message);
      }
      logger.error({ err: error, person: actorId }, "an agent's call failed");
      return refused("internal", "The console could not do that. Try again in a moment.");
    }
  };

  const findTask = async (ref: string): Promise<TaskRecord | undefined> => {
    if (uuid.safeParse(ref).success) {
      return getTask(database, workspaceId, ref);
    }
    const number = Number(ref.replace(/^#/, ""));
    return Number.isInteger(number) && number > 0
      ? findTaskByNumber(database, workspaceId, number)
      : undefined;
  };

  /**
   * Waits for the decision to be answered, until `waitMs` has passed: woken by the board's
   * own nudge, so that an answer given on a page reaches the agent at once.
   */
  const waitForAnswer = async (decisionId: string): Promise<DecisionRecord | undefined> => {
    const deadline = Date.now() + waitMs;
    const after = await latestEventId(database, workspaceId);
    let decision = await getDecision(database, workspaceId, decisionId);
    if (decision === undefined || decision.answer !== undefined) {
      return decision;
    }
    const subscription = feed.subscribe(after);
    const timer = setTimeout(() => subscription.end(), Math.max(0, deadline - Date.now()));
    try {
      for await (const message of subscription) {
        if (
          message.kind === "events" &&
          message.items.some(
            (event) => event.kind === "decision.answered" && event.decisionId === decisionId,
          )
        ) {
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      subscription.end();
    }
    decision = await getDecision(database, workspaceId, decisionId);
    return decision;
  };

  const decisionOutcome = (decision: DecisionRecord) =>
    decision.answer === undefined
      ? {
          ...decisionSummary(decision),
          hint: "A person answers on the board. Call await_decision with this id to keep waiting, or go on with other work and come back.",
        }
      : decisionSummary(decision);

  server.registerTool(
    "list_tasks",
    {
      title: "List the tasks",
      description:
        "The tasks on the board, newest first, with their state, priority, owner, assignee, and how many decisions and runs are open on each. Filter by state to see what is ready to take.",
      inputSchema: {
        state: z.enum(TASK_STATES).optional().describe("Only tasks in this state."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ state }) =>
      attempt(async () => {
        const tasks = await listTasks(database, workspaceId, { state, limit: LIST_LIMIT });
        return ok({ tasks: tasks.map(taskSummary) });
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Read a task",
      description:
        "One task in full: its body in Markdown, its links, the decisions about it with their options and answers, and the runs on it.",
      inputSchema: {
        task: taskRef.describe("The task's id, or its number such as 7 or #7."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ task: ref }) =>
      attempt(async () => {
        const task = await findTask(ref);
        if (task === undefined) {
          return refused("task.not_found", "The task was not found.");
        }
        const [decisions, runs] = await Promise.all([
          listDecisions(database, workspaceId, { taskId: task.id, limit: LIST_LIMIT }),
          listRuns(database, workspaceId, { taskId: task.id, limit: LIST_LIMIT }),
        ]);
        return ok({
          ...taskSummary(task),
          body: task.body,
          links: task.links,
          parentId: task.parentId ?? null,
          decisions: decisions.map(decisionSummary),
          runs: runs.map(runSummary),
        });
      }),
  );

  server.registerTool(
    "take_task",
    {
      title: "Take a task",
      description:
        "Start working on a task as the person you act for: the task becomes theirs and in progress, and a run begins. One agent at a time per task. Answer with the run's id, which report, hand_in, ask and finish take.",
      inputSchema: {
        task: taskRef.describe("The task's id, or its number such as 7 or #7."),
        agent: line(MAX_AGENT_LENGTH).describe(
          "What you are, as people will see it: for example 'Claude Code on Alice's laptop'.",
        ),
      },
    },
    ({ task: ref, agent }) =>
      attempt(async () => {
        const task = await findTask(ref);
        if (task === undefined) {
          return refused("task.not_found", "The task was not found.");
        }
        const run = await startRun(database, {
          workspaceId,
          actorId,
          tokenId: caller.tokenId,
          taskId: task.id,
          agent,
          now: clock.now(),
        });
        logger.info({ person: actorId, run: run.id, task: task.id }, "an agent took a task");
        return ok({ run: runSummary(run) });
      }),
  );

  server.registerTool(
    "report",
    {
      title: "Report progress",
      description:
        "Tell the people on the board how the work goes: what you found, what you did, what is next. Markdown. Report at the milestones of your work, not every step.",
      inputSchema: {
        run: uuid.describe("The run's id, from take_task."),
        body: body(MAX_BODY_LENGTH).describe("The report, in Markdown."),
      },
    },
    ({ run: runId, body: text }) =>
      attempt(async () => {
        const run = await addReport(database, {
          workspaceId,
          actorId,
          runId,
          body: text,
          limit: MAX_REPORTS_PER_RUN,
          now: clock.now(),
        });
        return ok({ run: runSummary(run) });
      }),
  );

  server.registerTool(
    "hand_in",
    {
      title: "Hand in a result",
      description:
        "Hand in what you made, as a link: a branch, a pull request, a document, a page. Only https links.",
      inputSchema: {
        run: uuid.describe("The run's id, from take_task."),
        url: z
          .string()
          .trim()
          .max(MAX_URL_LENGTH)
          .url()
          .refine((value) => value.startsWith("https://"), "must be an https URL")
          .describe("Where it is."),
        label: line(MAX_LINK_LABEL_LENGTH).optional().describe("What it is, in a few words."),
      },
    },
    ({ run: runId, url, label }) =>
      attempt(async () => {
        const run = await addArtifact(database, {
          workspaceId,
          actorId,
          runId,
          url,
          label,
          limit: MAX_ARTIFACTS_PER_RUN,
          now: clock.now(),
        });
        return ok({ run: runSummary(run) });
      }),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask for a decision",
      description:
        "Raise a question that a person must answer before you go on: the question, what they need to know, and the options to choose from. The run waits. The call waits a while for the answer; if none comes, go on with other work or call await_decision later.",
      inputSchema: {
        run: uuid.describe("The run's id, from take_task."),
        question: line(MAX_QUESTION_LENGTH).describe("The question, in one line."),
        body: body(MAX_BODY_LENGTH)
          .optional()
          .describe("What a person needs to know to answer, in Markdown."),
        options: z
          .array(line(MAX_OPTION_LABEL_LENGTH))
          .min(MIN_OPTIONS)
          .max(MAX_OPTIONS)
          .describe("The options, each in a few words. The answer names one by its number."),
      },
    },
    ({ run: runId, question, body: context, options }) =>
      attempt(async () => {
        const decision = await raiseDecision(database, {
          workspaceId,
          actorId,
          decision: { question, body: context, options, runId },
          now: clock.now(),
        });
        logger.info(
          { person: actorId, run: runId, decision: decision.id },
          "an agent asked for a decision",
        );
        const outcome = (await waitForAnswer(decision.id)) ?? decision;
        return ok({ decision: decisionOutcome(outcome) });
      }),
  );

  server.registerTool(
    "await_decision",
    {
      title: "Wait for a decision",
      description:
        "Wait a while for a decision to be answered, and read the answer. Call it again if the decision still waits.",
      inputSchema: {
        decision: uuid.describe("The decision's id, from ask."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ decision: decisionId }) =>
      attempt(async () => {
        const decision = await waitForAnswer(decisionId);
        if (decision === undefined) {
          return refused("decision.not_found", "The decision was not found.");
        }
        return ok({ decision: decisionOutcome(decision) });
      }),
  );

  server.registerTool(
    "finish",
    {
      title: "Finish the run",
      description:
        "End the run: finished when the work is done and handed in (the task goes up for review), failed when it could not be done, abandoned when you leave it. Say in the summary what was done and what is left.",
      inputSchema: {
        run: uuid.describe("The run's id, from take_task."),
        status: z.enum(RUN_ENDINGS).describe("How it ended."),
        summary: body(MAX_SUMMARY_LENGTH)
          .optional()
          .describe("What was done and what is left, in Markdown."),
      },
    },
    ({ run: runId, status, summary }) =>
      attempt(async () => {
        const run = await endRun(database, {
          workspaceId,
          actorId,
          runId,
          status,
          summary,
          now: clock.now(),
        });
        logger.info({ person: actorId, run: run.id, status }, "an agent ended a run");
        return ok({ run: runSummary(run) });
      }),
  );

  return server;
}
