import { projectPath, REST_ROUTES, type RestHome } from "@skillcdn/console/api";
import type { Harness } from "./harness.js";

// A board for the front page's glance (ADR-0105) on the console a person looks at the pages
// with (`pnpm dev:plugins`): one invented project, with tasks in progress, in review, ready and
// done, goals ahead and a decision waiting, made once; and the front page of a member arranged
// with it at a glance, the administrator's left composed, as a page nobody arranged is, for the
// plugins' widgets. Its days are counted from the day it is made, so that some are near and one
// is past. Not compiled.

/** The project the board is made in, by key. */
export const PREVIEW_BOARD_KEY = "ledger";

type Person = "alice" | "bob" | "carol";

interface Goal {
  readonly title: string;
  readonly state: "planned" | "active";
  /** Days from the day it is made. */
  readonly due: number;
}

interface Task {
  readonly title: string;
  readonly state: "ready" | "in_progress" | "in_review" | "done";
  readonly due?: number;
  readonly workers: readonly Person[];
  /** The title of its goal. */
  readonly goal?: string;
}

const CLOSE = "Close November";
const INVOICES = "Send the invoices on their own";
const YEAR_END = "Year-end close";

const GOALS: readonly Goal[] = [
  { title: CLOSE, state: "active", due: 6 },
  { title: INVOICES, state: "planned", due: 21 },
  { title: YEAR_END, state: "planned", due: 35 },
];

const TASKS: readonly Task[] = [
  {
    title: "Reconcile the three differences of the November close",
    state: "in_progress",
    due: 3,
    workers: ["carol"],
    goal: CLOSE,
  },
  {
    title: "Move the invoice form to the new tax rate",
    state: "in_progress",
    due: 4,
    workers: ["alice", "carol"],
    goal: INVOICES,
  },
  {
    title: "Draw the tables of the quarterly report again",
    state: "in_progress",
    workers: ["bob"],
  },
  {
    title: "Write the refund procedure down as a page",
    state: "in_progress",
    due: 12,
    workers: ["alice"],
  },
  {
    title: "Fix the bank statement import that fails",
    state: "in_progress",
    due: -1,
    workers: ["bob"],
    goal: CLOSE,
  },
  {
    title: "Bring the closing checklist up to date",
    state: "in_progress",
    workers: ["bob", "alice", "carol"],
    goal: YEAR_END,
  },
  {
    title: "Match the card payments to their accounts",
    state: "in_review",
    due: 2,
    workers: ["carol"],
    goal: CLOSE,
  },
  { title: "Group the receivables by vendor", state: "in_review", workers: ["bob"], goal: CLOSE },
  {
    title: "Settle how invoices are numbered",
    state: "in_review",
    workers: ["alice"],
    goal: INVOICES,
  },
  { title: "Report on the October close", state: "done", workers: ["alice"], goal: CLOSE },
  { title: "Set the budget against the actuals", state: "done", workers: ["bob"], goal: CLOSE },
  { title: "Clean up the vendors' contacts", state: "done", workers: ["carol"], goal: INVOICES },
  { title: "Plan the depreciation", state: "ready", workers: [], goal: YEAR_END },
  { title: "Plan the stock count", state: "ready", workers: [], goal: YEAR_END },
  { title: "Check the November payroll", state: "ready", due: 8, workers: [], goal: CLOSE },
];

/** A day so many days from `now`, as the API takes one. */
function dayFrom(now: Date, days: number): string {
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Makes the board, unless the project is there already, as on a database kept from an earlier
 * run, and arranges the member's front page with it, at every width: answers whether it made it.
 * `admin` and `member` are the Cookie headers of the two sessions.
 */
export async function seedPreviewBoard(options: {
  readonly harness: Harness;
  readonly origin: string;
  readonly admin: string;
  readonly member: string;
  readonly now: Date;
}): Promise<boolean> {
  const { harness, origin, admin, member, now } = options;
  const call = async (path: string, method: string, body?: unknown, cookie = admin) => {
    const answer = await harness.request(path, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!answer.ok) {
      throw new Error(`${method} ${path} answered ${answer.status}: ${await answer.text()}`);
    }
    return (await answer.json()) as Record<string, unknown>;
  };
  const listed = await call(REST_ROUTES.projects, "GET");
  const projects = listed.items as readonly { readonly key: string }[];
  if (projects.some((project) => project.key === PREVIEW_BOARD_KEY)) {
    return false;
  }
  const people = (await call(REST_ROUTES.people, "GET")).items as readonly {
    readonly id: string;
    readonly login: string;
  }[];
  const idOf = (person: Person): string => {
    const found = people.find((candidate) => candidate.login.toLowerCase() === person);
    if (found === undefined) {
      throw new Error(`${person} has not signed in on this console`);
    }
    return found.id;
  };
  const project = await call(REST_ROUTES.projects, "POST", {
    key: PREVIEW_BOARD_KEY,
    name: "Ledger",
    description: "The month's close, the reconciliations and the vendors' invoices.",
    visibility: "workspace",
    color: "teal",
  });
  const goals = new Map<string, string>();
  for (const goal of GOALS) {
    const made = await call(projectPath(PREVIEW_BOARD_KEY, "goals"), "POST", {
      title: goal.title,
      state: goal.state,
      dueOn: dayFrom(now, goal.due),
    });
    goals.set(goal.title, String(made.id));
  }
  let waitingOn: string | undefined;
  for (const task of TASKS) {
    const made = await call(projectPath(PREVIEW_BOARD_KEY, "tasks"), "POST", {
      title: task.title,
      state: task.state,
      dueOn: task.due === undefined ? null : dayFrom(now, task.due),
      workerIds: task.workers.map(idOf),
      goalId: task.goal === undefined ? null : (goals.get(task.goal) ?? null),
    });
    waitingOn ??= String(made.id);
  }
  await call(projectPath(PREVIEW_BOARD_KEY, "decisions"), "POST", {
    question: "Which day does the November close end on?",
    options: [
      { label: "The last day of November" },
      { label: "The first working day of December" },
    ],
    taskId: waitingOn,
  });
  // The member's page: the project large where four columns of cells are room enough to read it,
  // and wide on the laptop's eight; the widgets they have not seen take the first room after it.
  const tile = `project:${String(project.id)}`;
  const home: RestHome = {
    hidden: [],
    layouts: {
      12: [{ tile, x: 0, y: 0, size: "large" }],
      8: [{ tile, x: 0, y: 0, size: "wide" }],
      6: [{ tile, x: 0, y: 0, size: "large" }],
      4: [{ tile, x: 0, y: 0, size: "large" }],
    },
  };
  await call(REST_ROUTES.me, "PATCH", { home }, member);
  return true;
}
