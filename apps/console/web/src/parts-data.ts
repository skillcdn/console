import type {
  RestCategory,
  RestGoal,
  RestPerson,
  RestTask,
  RestTaskCounts,
  RestTeam,
} from "@skillcdn/console";

// The invented organization the parts are shown with (parts.tsx): Acme, its people, its
// categories, its goals and its tasks, dated around one day that never moves, so that the page
// reads the same whenever it is opened. Nothing here is fetched, and nobody here is real.

/** The day the page counts from, and its month: a due day is late or near by this, not by the clock. */
export const TODAY = "2026-03-12";
export const MONTH = "2026-03";

/** A moment of that day, for what is dated to the minute. */
export const NOW = "2026-03-12T09:30:00.000Z";
const WRITTEN = "2026-03-02T08:15:00.000Z";

const id = (place: number): string => `00000000-0000-4000-8000-${String(place).padStart(12, "0")}`;

function member(
  place: number,
  login: string,
  name: string | null,
  more: Partial<RestPerson> = {},
): RestPerson {
  return {
    id: id(place),
    login,
    name,
    avatar: null,
    role: "member",
    status: "active",
    source: "organization",
    deactivatedAt: null,
    kind: "person",
    ...more,
  };
}

export const alice = member(1, "alice", "Alice Lindqvist", {
  role: "admin",
  title: "Head of finance",
  email: "alice@acme.test",
});
export const bob = member(2, "bob", "Bob Arroyo", { title: "Accountant", managerId: alice.id });
/** A member the host gives no name for: the login stands in its place. */
export const carol = member(3, "carol", null, { managerId: alice.id });
export const erin = member(4, "erin", "Erin Sato", { source: "domain", managerId: alice.id });
export const dave = member(5, "dave", "Dave Petrov", {
  status: "deactivated",
  deactivatedAt: "2026-02-20T09:00:00.000Z",
});
/** An agent account: a member of its own, its picture drawn from its parts. */
export const mira = member(6, "mira", "Mira", {
  kind: "agent",
  handle: "mira",
  title: "Release engineer",
  managerId: alice.id,
  avatarParts: { set: 1, palette: 2, ground: 1, form: 3, material: 2, accent: 1, vein: 7 },
});
export const juno = member(7, "juno", "Juno", {
  kind: "agent",
  handle: "juno",
  title: "Bookkeeper",
  managerId: bob.id,
  avatarParts: { set: 1, palette: 5, ground: 3, form: 1, material: 4, accent: 0, vein: 21 },
});

export const people: readonly RestPerson[] = [alice, bob, carol, erin, mira, juno];

export const teams: readonly RestTeam[] = [
  {
    id: id(20),
    key: "finance",
    name: "Finance",
    memberIds: [alice.id, bob.id],
    createdAt: WRITTEN,
  },
  { id: id(21), key: "payroll", name: "Payroll", memberIds: [erin.id], createdAt: WRITTEN },
  { id: id(22), key: "audit", name: "Audit", memberIds: [], createdAt: WRITTEN },
];

/** One category in each of the colours a category may be shown in. */
export const categories: readonly RestCategory[] = (
  [
    ["bookkeeping", "Bookkeeping", "blue"],
    ["reporting", "Reporting", "green"],
    ["payroll", "Payroll", "orange"],
    ["tax", "Tax", "purple"],
    ["vendors", "Vendors", "teal"],
    ["audit", "Audit", "pink"],
    ["planning", "Planning", "yellow"],
    ["other", "Other", "gray"],
  ] as const
).map(([key, name, color]) => ({ key, name, color, createdAt: WRITTEN, updatedAt: WRITTEN }));

const categoryOf = (key: string): RestTask["category"] => {
  const found = categories.find((category) => category.key === key);
  return found === undefined ? null : { key: found.key, name: found.name, color: found.color };
};

export const counts = (more: Partial<RestTaskCounts> = {}): RestTaskCounts => ({
  idea: 0,
  ready: 0,
  in_progress: 0,
  in_review: 0,
  done: 0,
  dropped: 0,
  ...more,
});

function goal(place: number, title: string, more: Partial<RestGoal> = {}): RestGoal {
  return {
    id: id(40 + place),
    title,
    body: "",
    state: "planned",
    category: null,
    startsOn: null,
    dueOn: null,
    createdBy: alice,
    agent: null,
    taskCounts: counts(),
    createdAt: WRITTEN,
    updatedAt: WRITTEN,
    ...more,
  };
}

export const closeGoal = goal(1, "The February close", {
  state: "active",
  category: categoryOf("bookkeeping"),
  startsOn: "2026-03-02",
  dueOn: "2026-03-13",
  taskCounts: counts({ ready: 2, in_progress: 2, in_review: 1, done: 5 }),
});
export const invoicesGoal = goal(2, "Invoices on the new tax rate", {
  category: categoryOf("tax"),
  dueOn: "2026-03-27",
  taskCounts: counts({ idea: 1, ready: 3 }),
});
export const goals: readonly RestGoal[] = [closeGoal, invoicesGoal];

function task(number: number, title: string, more: Partial<RestTask> = {}): RestTask {
  return {
    id: id(100 + number),
    number,
    title,
    body: "",
    state: "ready",
    priority: "normal",
    owner: alice,
    plugin: null,
    agent: null,
    workers: [],
    parentId: null,
    category: null,
    goalId: null,
    startsOn: null,
    dueOn: null,
    startedAt: null,
    doneAt: null,
    archivedAt: null,
    links: [],
    openDecisions: 0,
    openRuns: 0,
    createdAt: WRITTEN,
    updatedAt: WRITTEN,
    ...more,
  };
}

/** The task the detail layout is shown with: planned across days, at work, with its links. */
export const reconcile = task(12, "Reconcile the three differences of the February close", {
  state: "in_progress",
  priority: "high",
  workers: [bob, mira],
  category: categoryOf("bookkeeping"),
  goalId: closeGoal.id,
  startsOn: "2026-03-09",
  dueOn: "2026-03-13",
  startedAt: "2026-03-09T08:40:00.000Z",
  links: [
    { url: "https://ledger.acme.test/close/2026-02", label: "The close in the ledger" },
    { url: "https://ledger.acme.test/differences", label: null },
  ],
  openRuns: 1,
});

/**
 * A month of Acme's work: bars across days and across a week's end, tasks on one day each, one
 * late, one done, one dropped, a day with more than a cell shows, and the days a badge reads as
 * today, tomorrow, within the week and further off.
 */
export const tasks: readonly RestTask[] = [
  reconcile,
  task(9, "Fix the bank statement import that fails", {
    state: "in_progress",
    priority: "urgent",
    workers: [bob],
    category: categoryOf("bookkeeping"),
    goalId: closeGoal.id,
    dueOn: "2026-03-06",
    openDecisions: 1,
  }),
  task(14, "Move the invoice form to the new tax rate", {
    priority: "high",
    workers: [carol],
    category: categoryOf("tax"),
    goalId: invoicesGoal.id,
    dueOn: TODAY,
  }),
  task(18, "Check the March payroll", {
    workers: [erin],
    category: categoryOf("payroll"),
    dueOn: "2026-03-13",
  }),
  task(15, "Draw the tables of the quarterly report again", {
    state: "in_review",
    workers: [erin, bob, alice, mira],
    category: categoryOf("reporting"),
    startsOn: "2026-03-16",
    dueOn: "2026-03-24",
  }),
  task(19, "Plan the stock count", { state: "idea", priority: "low", dueOn: "2026-03-18" }),
  task(20, "Match the card payments to their accounts", {
    workers: [juno],
    category: categoryOf("vendors"),
    dueOn: "2026-03-27",
  }),
  task(7, "Report on the January close", {
    state: "done",
    workers: [alice],
    category: categoryOf("reporting"),
    dueOn: "2026-03-04",
    doneAt: "2026-03-04T16:20:00.000Z",
  }),
  task(21, "Number the invoices by vendor", {
    state: "dropped",
    category: categoryOf("vendors"),
    dueOn: "2026-03-10",
  }),
  ...[
    "Send the reminders to the vendors",
    "File the receipts of the week",
    "Close the petty cash",
    "Answer the auditor's questions",
    "Archive the paid invoices",
  ].map((title, at) =>
    task(22 + at, title, {
      workers: at % 2 === 0 ? [bob] : [],
      category: categoryOf(at % 2 === 0 ? "vendors" : "audit"),
      dueOn: "2026-03-20",
    }),
  ),
];

/** The project the marks are drawn for, and one with a symbol and a colour of its own. */
export const ledger = { key: "LEDGER", name: "Ledger", color: null, symbol: null };
export const payrollProject = {
  key: "PAY",
  name: "Payroll",
  color: "purple",
  symbol: "$",
} as const;

const picture = (width: number, height: number, drawn: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${drawn}</svg>`,
  )}`;

/**
 * A picture where one is shown as an image, held in the page itself: a member's picture as a
 * host serves it and a project's own image would be fetched, and this page fetches nothing.
 */
export const PORTRAIT = picture(
  64,
  64,
  '<rect width="64" height="64" fill="#c9d6f2"/><circle cx="32" cy="25" r="12" fill="#5b7fd1"/><path d="M8 64c2-15 12-23 24-23s22 8 24 23z" fill="#5b7fd1"/>',
);

/** A project's own image, a square one: a mark has room for nothing wider. */
export const SEAL = picture(
  64,
  64,
  '<rect width="64" height="64" fill="#c9d6f2"/><path d="M0 64 64 0v64z" fill="#5b7fd1"/><circle cx="22" cy="22" r="10" fill="#5b7fd1"/>',
);

/** A picture that came with a text: a figure of three bars. */
export const FIGURE = picture(
  320,
  140,
  '<rect width="320" height="140" fill="#eef1f9"/><rect x="40" y="70" width="50" height="50" fill="#5b7fd1"/><rect x="135" y="40" width="50" height="80" fill="#5b7fd1"/><rect x="230" y="20" width="50" height="100" fill="#5b7fd1"/><rect x="24" y="120" width="272" height="2" fill="#7d899e"/>',
);

/** What a person wrote, with everything the prose draws: headings, lists, a quote, code, a table, pictures. */
export const WRITTEN_TEXT = `# Closing February

The close is **three differences** away. Each is in the ledger under \`close/2026-02\`, and the
[closing checklist](https://ledger.acme.test/checklist) says what a closed month needs.

## What is left

- The bank statement of the 27th, imported twice
- A card payment with no account
- The rounding of the tax on two invoices

1. Take the second import out
2. Match the payment
3. Round as the tax office does

- [x] The January close is reported
- [ ] The February close is reported

> A month is closed when nothing in it can change without a note saying why.

### The figures

| Account | Before | After |
|---|---|---|
| Bank | 12,480.00 | 12,410.50 |
| Cards | 3,120.75 | 3,120.75 |

\`\`\`
console task move 12 in_review
\`\`\`

![The differences by week](figure.svg)

![A scan that was not attached](scan.png)
`;
