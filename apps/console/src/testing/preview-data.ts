import type { PictureColour } from "./preview-pictures.js";

// The invented work the console a person looks at the pages on starts with (`preview-board.ts`):
// one organization, Acme, relaunching its website, keeping its handbook and running its
// operations, with the people and the agent accounts at it. Everything here is made up: no
// organization, person, product or address of the world. Days are counted from the day the work
// is made, so that some of it is late, some due today and the rest ahead. Not compiled.

/** The people who sign in: the fixture's three, and three more let in for the preview. */
export type Member = "alice" | "bob" | "carol" | "dana" | "eli" | "gus";
/** The agent accounts, by handle. */
export type Agent = "mira" | "juno" | "otis" | "wren" | "pax" | "remy";
export type Who = Member | Agent;

export const MEMBERS: readonly {
  readonly login: Member;
  readonly title: string;
  readonly manager?: Member;
  readonly email: string;
}[] = [
  { login: "alice", title: "Head of operations", email: "alice@acme.example" },
  // Reports to nobody, so that the agent account he manages is not one of the administrator's.
  { login: "bob", title: "Finance lead", email: "bob@acme.example" },
  { login: "carol", title: "Product designer", manager: "alice", email: "carol@acme.example" },
  { login: "dana", title: "Engineering lead", manager: "alice", email: "dana@acme.example" },
  {
    login: "eli",
    title: "Support specialist for onboarding, the help centre and the status page",
    manager: "dana",
    email: "eli@acme.example",
  },
  { login: "gus", title: "Contractor, brand", manager: "carol", email: "gus@acme.example" },
];

/** The people let in for the preview beyond the fixture's three, in the order they join. */
export const JOINING: readonly Member[] = ["dana", "eli", "gus"];
/** A login let in that nobody signed in with. */
export const LISTED_ONLY = "hana";
/** Who is taken out again, after having said something. */
export const LEAVING: Member = "gus";

export const AGENTS: readonly {
  readonly handle: Agent;
  readonly name: string;
  readonly title: string;
  readonly manager: Member;
  /** The project it starts in, where its first task is made. */
  readonly project: string;
  /** How it stands; `invited` was never set up, `unheard` is the console's own word. */
  readonly state: "running" | "stopped" | "refused" | "failed" | "unheard" | "invited";
  readonly product: "claude" | "codex";
  readonly machine: string;
  /** How long ago it came to stand so, and was last heard from, in minutes. */
  readonly since: number;
  readonly heard: number;
}[] = [
  {
    handle: "mira",
    name: "Mira",
    title: "Release engineer",
    manager: "alice",
    project: "website",
    state: "running",
    product: "claude",
    machine: "studio-2",
    since: 95,
    heard: 0,
  },
  {
    handle: "juno",
    name: "Juno",
    title: "Bookkeeping assistant",
    manager: "bob",
    project: "ops",
    state: "stopped",
    product: "claude",
    machine: "studio-2",
    since: 180,
    heard: 1,
  },
  {
    handle: "otis",
    name: "Otis",
    title: "Support triage, first answers and the weekly digest of what people asked",
    manager: "alice",
    project: "handbook",
    state: "refused",
    product: "claude",
    machine: "studio-3",
    since: 47,
    heard: 1,
  },
  {
    handle: "wren",
    name: "Wren",
    title: "Documentation writer",
    manager: "dana",
    project: "handbook",
    state: "failed",
    product: "codex",
    machine: "build-1",
    since: 2 * 24 * 60,
    heard: 1,
  },
  {
    handle: "pax",
    name: "Pax",
    title: "Night watch for the build",
    manager: "alice",
    project: "website",
    state: "unheard",
    product: "codex",
    machine: "build-1",
    since: 26 * 60,
    heard: 26 * 60,
  },
  {
    handle: "remy",
    name: "Remy",
    title: "Research assistant",
    manager: "carol",
    project: "ops",
    state: "invited",
    product: "claude",
    machine: "studio-3",
    since: 0,
    heard: 0,
  },
];

export const TEAMS: readonly {
  readonly key: string;
  readonly name: string;
  readonly members: readonly Who[];
}[] = [
  { key: "design", name: "Design", members: ["carol", "eli", "gus"] },
  { key: "platform", name: "Platform", members: ["dana", "alice", "mira", "pax"] },
  { key: "finance", name: "Finance and operations", members: ["bob", "alice", "carol", "juno"] },
  { key: "night-shift", name: "Night shift", members: [] },
];

/** The categories beside the five every workspace starts with. */
export const CATEGORIES: readonly {
  readonly key: string;
  readonly name: string;
  readonly color: "green" | "yellow" | "gray";
}[] = [
  { key: "finance", name: "Finance", color: "green" },
  { key: "support", name: "Support", color: "yellow" },
  { key: "research", name: "Research", color: "gray" },
];

export interface ProjectData {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: "workspace" | "private";
  readonly color: "blue" | "purple" | "orange" | "green";
  /** Its own image for a mark, drawn in this colour. */
  readonly icon?: PictureColour;
  /** Those listed in it beside whoever makes it, for a private project. */
  readonly members?: readonly Who[];
}

export const WEBSITE = "website";
export const HANDBOOK = "handbook";
export const OPS = "ops";
export const LAB = "lab";

export const PROJECTS: readonly ProjectData[] = [
  {
    key: WEBSITE,
    name: "Website relaunch",
    description:
      "The new site: sign-up, the docs and the brand, built and shipped in four releases.",
    visibility: "workspace",
    color: "blue",
    icon: "blue",
  },
  {
    key: HANDBOOK,
    name: "People handbook, onboarding guides and the policies everyone signs",
    description:
      "How Acme works, written down: what a first week holds, where the accounts come from, how time off and expenses are asked for, and how a meeting and a review are run. Kept by whoever does the thing the page is about, read by everyone, and changed in the open.",
    visibility: "workspace",
    color: "purple",
  },
  {
    key: OPS,
    name: "Operations",
    description: "The office, the machines, the vendors and the month's routines.",
    visibility: "private",
    color: "orange",
    members: ["bob", "dana", "juno", "remy"],
  },
  {
    key: LAB,
    name: "Lab",
    description: "",
    visibility: "workspace",
    color: "green",
  },
];

export interface GoalData {
  readonly title: string;
  readonly state: "planned" | "active" | "done" | "dropped";
  readonly category?: string;
  readonly body?: string;
  /** Days from the day it is made. */
  readonly starts?: number;
  readonly due?: number;
}

export const SIGN_UP = "Sign-up in under a minute";
export const BRAND = "Every page in the new brand";
export const PHONE_DOCS = "Docs that read on a phone";
export const SEARCH = "Search across the site";
export const ACCESSIBLE = "Accessibility audit passed";
export const PORTAL = "Partner portal open";

export const WEBSITE_GOALS: readonly GoalData[] = [
  {
    title: SIGN_UP,
    state: "active",
    category: "product",
    starts: -18,
    due: 12,
    body: "Someone who has never seen Acme has a workspace of their own within a minute of opening the site.\n\n- The form asks for four things.\n- The first page after it is the workspace, not a tour.\n- Measured on a phone, on a slow connection.",
  },
  { title: BRAND, state: "active", category: "design", starts: -40, due: 55 },
  { title: PHONE_DOCS, state: "active", category: "engineering", starts: 4, due: 78 },
  { title: SEARCH, state: "planned", category: "engineering" },
  { title: PORTAL, state: "planned", category: "product", starts: 85, due: 160 },
  { title: ACCESSIBLE, state: "done", category: "design", starts: -95, due: -28 },
  { title: "Old blog archived", state: "done", category: "marketing" },
  { title: "Comments under every post", state: "dropped", category: "marketing", due: -10 },
];

export const HANDBOOK_GOALS: readonly GoalData[] = [
  { title: "A first week nobody has to ask about", state: "active", starts: -10, due: 20 },
  { title: "Every policy read and signed", state: "planned", due: 45 },
];

export const OPS_GOALS: readonly GoalData[] = [
  { title: "The office move", state: "active", category: "operations", starts: -7, due: 30 },
  { title: "Vendors reviewed for the year", state: "planned", category: "finance", due: 60 },
];

/** The task Mira is at while her question waits. */
export const CONFIRMATION_LINK = "Fix the confirmation link that opens the old site";
/** The part of the full task Mira's session is about. */
export const FIELD_ERRORS = "Say what went wrong beside the field it went wrong in";

export interface TaskData {
  readonly title: string;
  readonly state: "idea" | "ready" | "in_progress" | "in_review" | "done" | "dropped";
  readonly priority?: "low" | "normal" | "high" | "urgent";
  readonly category?: string;
  /** The title of its goal. */
  readonly goal?: string;
  readonly workers?: readonly Who[];
  readonly starts?: number;
  readonly due?: number;
  /** The title of the task it is a part of. */
  readonly parent?: string;
  readonly body?: string;
  /** Who wrote it; the administrator where left out. */
  readonly by?: Member;
}

/** The task whose page shows everything a task's page can. */
export const FULL_TASK = "Rebuild the sign-up form around the four things it needs";

const FULL_BODY = `## Why

People leave the sign-up form at its second step. It asks for eleven things before it lets anyone in; four of them are needed, and the rest can wait for the first week.

## What is done when this is done

- The form asks for an email address, a name, a workspace's name and a password, and nothing else.
- It is one step, on one page, with no account to confirm before the workspace opens.
- Everything it used to ask is asked later, where it is used.

1. Take the seven questions out, and move each to the page that needs it.
2. Rebuild the form as one step.
3. Measure it for a week against the old one.

## Where the people leave

| Step | Asked today | Leave here |
|---|---|---|
| 1. Account | Email, name, password | 8% |
| 2. Company | Size, industry, role, phone | 41% |
| 3. Workspace | Name, address, time zone, colour | 12% |

## The rule the button follows

\`\`\`ts
export function canContinue(form: SignUp): boolean {
  return isEmail(form.email) && form.name.trim() !== "" && form.workspace.trim() !== "";
}
\`\`\`

> Nobody has ever told us they wished the form had asked them more.

The measurements are in [The sign-up flow, as measured](guides/sign-up-flow), and what the brand asks of a form is in [Voice and tone](guides/writing/voice).`;

export const WEBSITE_TASKS: readonly TaskData[] = [
  {
    title: FULL_TASK,
    state: "in_progress",
    priority: "urgent",
    category: "product",
    goal: SIGN_UP,
    workers: ["carol", "dana", "mira"],
    starts: -6,
    due: 3,
    body: FULL_BODY,
    by: "carol",
  },
  {
    title: "Move the company questions to the first week",
    state: "in_review",
    category: "product",
    goal: SIGN_UP,
    workers: ["dana"],
    parent: FULL_TASK,
    due: 1,
  },
  {
    title: "Draw the form as one step, wide and on a phone",
    state: "done",
    category: "design",
    goal: SIGN_UP,
    workers: ["carol"],
    parent: FULL_TASK,
  },
  {
    title: FIELD_ERRORS,
    state: "in_progress",
    category: "engineering",
    goal: SIGN_UP,
    workers: ["mira"],
    parent: FULL_TASK,
    due: 2,
  },
  {
    title: "Measure the new form against the old one for a week",
    state: "ready",
    category: "product",
    goal: SIGN_UP,
    workers: [],
    parent: FULL_TASK,
    starts: 4,
    due: 11,
  },
  {
    title: "Open the workspace straight after sign-up, without the tour",
    state: "in_progress",
    priority: "high",
    category: "engineering",
    goal: SIGN_UP,
    workers: ["dana", "alice"],
    starts: -2,
    due: 0,
    by: "dana",
  },
  {
    title: "Write the welcome email in the new voice",
    state: "in_review",
    priority: "normal",
    category: "marketing",
    goal: SIGN_UP,
    workers: ["eli", "alice"],
    due: 0,
    by: "eli",
  },
  {
    title: CONFIRMATION_LINK,
    state: "in_progress",
    priority: "urgent",
    category: "engineering",
    goal: SIGN_UP,
    workers: ["mira"],
    due: -2,
    by: "eli",
  },
  {
    title: "Redraw the front page in the new colours",
    state: "in_progress",
    priority: "high",
    category: "design",
    goal: BRAND,
    workers: ["carol", "gus"],
    starts: -9,
    due: 6,
    by: "carol",
  },
  {
    title: "Replace the wordmark in every header, footer, email and invoice the site sends",
    state: "in_progress",
    category: "design",
    goal: BRAND,
    workers: ["gus", "carol", "eli", "dana", "alice", "bob", "mira"],
    starts: -3,
    due: 9,
  },
  {
    title: "Choose the two typefaces and say where each is used",
    state: "in_review",
    category: "design",
    goal: BRAND,
    workers: ["carol"],
    due: 5,
    by: "carol",
  },
  {
    title: "Photograph the team for the About page",
    state: "ready",
    priority: "low",
    category: "marketing",
    goal: BRAND,
    workers: ["gus"],
    starts: 12,
    due: 13,
  },
  {
    title: "Bring the illustrations of the docs into the new style",
    state: "ready",
    category: "design",
    goal: BRAND,
    workers: [],
    starts: 15,
    due: 34,
  },
  {
    title: "Colour contrast of the new palette, checked against the audit",
    state: "done",
    category: "design",
    goal: BRAND,
    workers: ["carol", "dana"],
  },
  {
    title: "Make the docs' tables scroll on a narrow screen",
    state: "ready",
    priority: "high",
    category: "engineering",
    goal: PHONE_DOCS,
    workers: ["dana"],
    starts: 5,
    due: 9,
    by: "dana",
  },
  {
    title: "Fold the docs' menu away on a phone",
    state: "ready",
    category: "engineering",
    goal: PHONE_DOCS,
    workers: ["mira"],
    starts: 9,
    due: 16,
  },
  {
    title: "Shorten the code samples that run off the page",
    state: "idea",
    category: "engineering",
    goal: PHONE_DOCS,
    by: "eli",
  },
  {
    title: "Read every page of the docs on a phone and list what breaks",
    state: "in_progress",
    category: "support",
    goal: PHONE_DOCS,
    workers: ["eli", "pax"],
    starts: 1,
    due: 9,
    by: "eli",
  },
  {
    title: "Search the docs by what people type, not by the page's title",
    state: "idea",
    priority: "normal",
    category: "engineering",
    goal: SEARCH,
    by: "dana",
  },
  {
    title: "List what people searched for last quarter and did not find",
    state: "idea",
    category: "research",
    goal: SEARCH,
    workers: ["eli"],
  },
  {
    title: "Status page that says what is down in a person's words",
    state: "ready",
    priority: "normal",
    category: "support",
    workers: ["eli"],
    due: 9,
    by: "eli",
  },
  {
    title: "Halve the weight of the front page",
    state: "in_review",
    priority: "high",
    category: "engineering",
    workers: ["dana", "mira"],
    due: 9,
    by: "dana",
  },
  {
    title: "Redirect every address of the old site to its new page",
    state: "in_progress",
    category: "engineering",
    workers: ["mira", "dana"],
    starts: 7,
    due: 9,
  },
  {
    title: "Plan the day of the launch, hour by hour",
    state: "ready",
    priority: "high",
    category: "operations",
    workers: ["alice"],
    starts: 9,
    due: 12,
    by: "alice",
  },
  {
    title: "Tell the customers a week ahead, and again on the day",
    state: "idea",
    category: "marketing",
    workers: ["alice"],
    due: 20,
    by: "alice",
  },
  {
    title: "Alt text for every picture of the site",
    state: "done",
    category: "design",
    goal: ACCESSIBLE,
    workers: ["carol", "eli"],
  },
  {
    title: "Every form usable with the keyboard alone",
    state: "done",
    priority: "high",
    category: "engineering",
    goal: ACCESSIBLE,
    workers: ["dana"],
  },
  {
    title: "Have the audit done by someone outside",
    state: "done",
    category: "operations",
    goal: ACCESSIBLE,
    workers: ["alice"],
  },
  {
    title: "Move the old blog's posts to an archive",
    state: "done",
    category: "marketing",
    goal: "Old blog archived",
    workers: ["gus"],
  },
  {
    title: "Comments under every post, moderated",
    state: "dropped",
    category: "marketing",
    goal: "Comments under every post",
    workers: [],
  },
  {
    title: "A chat window on every page",
    state: "dropped",
    priority: "low",
    category: "support",
    workers: [],
    by: "eli",
  },
  {
    title: "Write down what the partner portal is for, in a page",
    state: "idea",
    category: "product",
    goal: PORTAL,
    workers: ["alice"],
    starts: 30,
    due: 40,
    by: "alice",
  },
];

export const HANDBOOK_TASKS: readonly TaskData[] = [
  {
    title: "Write the first week down, day by day",
    state: "in_progress",
    priority: "high",
    goal: "A first week nobody has to ask about",
    workers: ["alice", "eli"],
    starts: -4,
    due: 2,
  },
  {
    title: "Say where each account comes from, and who to ask",
    state: "in_review",
    goal: "A first week nobody has to ask about",
    workers: ["dana"],
    due: 1,
    by: "dana",
  },
  {
    title: "Bring the time off page up to date with this year's days",
    state: "ready",
    category: "operations",
    goal: "Every policy read and signed",
    workers: ["alice", "bob"],
    due: 6,
  },
  {
    title: "Turn the expenses policy into a page somebody can follow",
    state: "in_progress",
    category: "finance",
    goal: "Every policy read and signed",
    workers: ["bob"],
    due: 4,
    by: "bob",
  },
  {
    title: "Answer the ten questions new people ask most",
    state: "ready",
    category: "support",
    workers: ["otis", "eli"],
    due: 14,
    by: "eli",
  },
  {
    title: "Check every link of the handbook once a month",
    state: "idea",
    workers: ["wren"],
    by: "dana",
  },
  {
    title: "How a review is asked for, and how one is given",
    state: "done",
    workers: ["dana", "carol"],
    by: "dana",
  },
];

export const OPS_TASKS: readonly TaskData[] = [
  {
    title: "Sign the lease of the new office",
    state: "in_review",
    priority: "urgent",
    category: "operations",
    goal: "The office move",
    workers: ["alice"],
    due: 1,
  },
  {
    title: "Order the desks and have them delivered before the move",
    state: "in_progress",
    category: "operations",
    goal: "The office move",
    workers: ["alice", "bob"],
    starts: -1,
    due: 8,
  },
  {
    title: "Move the build machines over a weekend",
    state: "ready",
    priority: "high",
    category: "engineering",
    goal: "The office move",
    workers: ["dana", "juno"],
    starts: 20,
    due: 22,
    by: "dana",
  },
  {
    title: "Gather this year's contracts of every vendor",
    state: "in_progress",
    category: "finance",
    goal: "Vendors reviewed for the year",
    workers: ["bob", "juno"],
    due: 10,
    by: "bob",
  },
  {
    title: "Renew the domain names that end this quarter",
    state: "ready",
    category: "operations",
    workers: ["alice"],
    due: 5,
  },
  {
    title: "Count the laptops and who has which",
    state: "done",
    category: "operations",
    workers: ["bob"],
    by: "bob",
  },
];

/** A comment on the full task: who says it, through which agent of theirs, with what. */
export interface CommentData {
  readonly by: Who;
  /** The name of the token it is said through, for a person's agent; themselves where left out. */
  readonly through?: string;
  readonly body: string;
  readonly files?: readonly PreviewFile[];
}

/** A file made for the preview: a picture drawn, or a text. */
export type PreviewFile =
  | {
      readonly name: string;
      readonly picture: "chart" | "form" | "columns" | "hero";
      readonly colour: PictureColour;
    }
  | { readonly name: string; readonly text: string; readonly contentType: string };

export const LAPTOP_AGENT = "Claude Code on the studio laptop";
export const CI_AGENT = "Codex in CI";

const FUNNEL_CSV = `step,asked,opened,left
1 account,3,1840,147
2 company,4,1693,694
3 workspace,4,999,120
done,,879,
`;

export const COMMENTS: readonly CommentData[] = [
  {
    by: "carol",
    body: "The form as one step, wide. The four fields, the button, and nothing above the fold that is not one of them.\n\n![The form as one step](sign-up-one-step.png)",
    files: [{ name: "sign-up-one-step.png", picture: "form", colour: "blue" }],
  },
  { by: "bob", body: "Does the password still have to be twelve characters?" },
  {
    by: "dana",
    body: "It does, and the form says so before anyone types:\n\n- twelve characters or more\n- no other rule\n\n```ts\nconst MIN_PASSWORD_LENGTH = 12;\n```\n\nThe old rules about symbols and capitals go.",
  },
  {
    by: "alice",
    through: LAPTOP_AGENT,
    body: "The numbers the table in the task comes from, a row per step of the old form.",
    files: [{ name: "sign-up-funnel.csv", text: FUNNEL_CSV, contentType: "text/csv" }],
  },
  {
    by: "mira",
    body: "The field errors are in: each says what went wrong beside the field it went wrong in, and the button stays where it is. Two of the old messages were about questions the form no longer asks, so they went with them.",
  },
  {
    by: "gus",
    body: "The button's blue is the new one. The old blue is still in the focus ring, I will take it out with the wordmark.",
  },
  {
    by: "eli",
    body: "What people wrote to support about the old form, last quarter:\n\n| Asked | Times |\n|---|---|\n| Why do you need my phone number? | 31 |\n| Which industry am I? | 18 |\n| I never got the confirmation | 12 |\n\nThe first two go away with this. The third is [the confirmation link](guides/sign-up-flow).",
  },
];

/** A run: who works, through what, on which task, and how far it got. */
export interface RunData {
  readonly by: Who;
  readonly through?: string;
  /** The title of its task; the one that shows everything where left out. */
  readonly task?: string;
  readonly reports: readonly string[];
  readonly links?: readonly { readonly url: string; readonly label: string }[];
  readonly files?: readonly PreviewFile[];
  /** How it ended; left out, it is still open, and `asks` leaves it waiting for an answer. */
  readonly end?: { readonly status: "finished" | "failed" | "abandoned"; readonly summary: string };
  readonly asks?: DecisionData;
}

export interface DecisionData {
  readonly question: string;
  readonly body?: string;
  readonly options: readonly string[];
  readonly by: Who;
  readonly through?: string;
  /** Who is to answer; several where any of them may. */
  readonly to: readonly Member[];
  readonly files?: readonly PreviewFile[];
  /** The title of the task it is about, in the project it is raised in. */
  readonly task?: string;
  /** The answer, by whom: an option by its place, or words of their own; left out, it waits. */
  readonly answer?: {
    readonly by: Member;
    /** The agent of theirs the answer came through; themselves where left out. */
    readonly through?: string;
    readonly option?: number;
    readonly own?: string;
    readonly note?: string;
    readonly outcome?: string;
  };
}

export const RUNS: readonly RunData[] = [
  {
    by: "alice",
    through: LAPTOP_AGENT,
    reports: [
      "Read the old form and the three pages after it. Seven of the eleven questions are read by nothing in the first week: the list is in the task.",
      "Rebuilt the form as one step. It is on the preview address, wide and on a phone:\n\n![The new form](new-form.png)\n\nThe old one stays at its address until the measurement is done.",
    ],
    links: [
      { url: "https://preview.acme.example/sign-up", label: "The new form, on the preview" },
      { url: "https://git.acme.example/website/pull/412", label: "The change" },
    ],
    files: [
      { name: "new-form.png", picture: "form", colour: "green" },
      { name: "sign-up-funnel.csv", text: FUNNEL_CSV, contentType: "text/csv" },
    ],
    end: {
      status: "finished",
      summary:
        "The form is one step and asks four things. Left: the seven questions still have to be asked where they are used, which is the first part of this task.",
    },
  },
  {
    by: "bob",
    through: CI_AGENT,
    reports: ["Ran the form's tests against the preview address."],
    end: {
      status: "failed",
      summary:
        "Three tests of the old second step fail, since the step is gone. They are to be removed with it, not fixed.",
    },
  },
  {
    by: "dana",
    through: "Claude Code",
    reports: [
      "Moving the company questions to the settings page. Size and industry are in; role and phone wait for the page they belong on.",
    ],
  },
  {
    by: "mira",
    reports: [
      "The errors beside their fields are done and pushed. One thing is not mine to settle: whether the company size question stays anywhere at all.",
    ],
    asks: {
      question: "Does the form keep the company size question anywhere?",
      body: "Nothing reads the answer in the first week. Sales reads it after a month, for one report.",
      options: [
        "Drop it everywhere",
        "Ask it in the first week, optional",
        "Keep it on the form, optional",
      ],
      by: "mira",
      to: ["alice"],
    },
  },
  {
    by: "mira",
    task: CONFIRMATION_LINK,
    reports: [
      "The link in the confirmation email is built from a setting that still names the old site. Changing the setting fixes new emails; the ones already sent keep the old address.",
      "The old address now answers with a redirect to the new one, so the emails already sent work too. Waiting for the release to go out before I move this to review.",
    ],
  },
  {
    by: "dana",
    through: "Claude Code",
    task: "Halve the weight of the front page",
    reports: [
      "The pictures are a third of their weight in the new format, and the two scripts nothing called are gone. The page is at 46% of what it was.",
    ],
  },
];

/** The decisions that wait, beside the one a run asks. */
export const WAITING: readonly DecisionData[] = [
  {
    question: "Which of the two front pages goes out with the relaunch?",
    body: "Both are drawn in the new colours. The first leads with the product, the second with what people make with it.\n\n![Leading with the product](front-page-product.png)\n\n![Leading with what people make](front-page-people.png)",
    options: ["Leading with the product", "Leading with what people make"],
    by: "carol",
    to: ["alice", "dana"],
    task: "Redraw the front page in the new colours",
    files: [
      { name: "front-page-product.png", picture: "hero", colour: "blue" },
      { name: "front-page-people.png", picture: "columns", colour: "orange" },
    ],
  },
  {
    question: "Who reads the welcome email before it goes out?",
    options: ["Bob", "Carol", "Both, Carol first"],
    by: "alice",
    to: ["bob"],
    task: "Write the welcome email in the new voice",
  },
  {
    question:
      "Is the old help centre redirected page by page, or archived whole behind one address that says where everything went?",
    body: "Page by page is about four hundred redirects. Whole is one, and a search.",
    options: ["Page by page", "Archived whole", "The fifty most read pages, and the rest whole"],
    by: "eli",
    to: ["bob", "dana"],
    task: "Redirect every address of the old site to its new page",
  },
  {
    question: "Does the relaunch ship with a dark theme?",
    options: ["Yes", "No, light only", "After the launch"],
    by: "dana",
    to: ["carol"],
  },
  {
    question: "On which day does the new site go out?",
    body: "The day of the week matters more than the date: someone has to be at a desk the day after.",
    options: ["A Tuesday", "A Wednesday", "The first working day of the month"],
    by: "alice",
    through: LAPTOP_AGENT,
    to: ["alice"],
    task: "Plan the day of the launch, hour by hour",
  },
];

const said = (
  question: string,
  options: readonly string[],
  by: Who,
  answerer: Member,
  answer: Omit<NonNullable<DecisionData["answer"]>, "by">,
  task?: string,
): DecisionData => ({
  question,
  options,
  by,
  to: [answerer],
  ...(task === undefined ? {} : { task }),
  answer: { by: answerer, ...answer },
});

/** The decisions already answered: the record, more than a page of it. */
export const ANSWERED: readonly DecisionData[] = [
  said(
    "Does the form ask for a phone number?",
    ["No", "Yes, optional"],
    "carol",
    "alice",
    {
      option: 0,
      note: "Nobody calls anyone in the first week.",
      outcome:
        "Taken out with the rest of the second step. Support has had no question about it since.",
    },
    FULL_TASK,
  ),
  said(
    "Is the workspace's address chosen at sign-up or made from its name?",
    ["Chosen", "Made from the name"],
    "dana",
    "alice",
    {
      option: 1,
      outcome: "Made from the name, and changed in the settings by whoever wants another.",
    },
  ),
  said("Which blue is the brand's?", ["The deeper one", "The brighter one"], "gus", "carol", {
    option: 0,
    note: "The brighter one fails the contrast check on white.",
  }),
  said("Do the docs keep their own header?", ["Yes", "No, the site's"], "dana", "carol", {
    option: 1,
  }),
  said(
    "Is the launch announced before or on the day?",
    ["A week before", "On the day"],
    "alice",
    "alice",
    {
      own: "A week before to customers, on the day to everyone else",
      through: LAPTOP_AGENT,
      outcome: "The customers were written to on the Tuesday before.",
    },
  ),
  said("Who owns the status page?", ["Support", "Engineering"], "eli", "dana", {
    option: 0,
    outcome: "Eli keeps it; engineering is told when it changes.",
  }),
  said(
    "Are the old addresses kept for a year or for good?",
    ["A year", "For good"],
    "mira",
    "dana",
    {
      option: 1,
      note: "A redirect costs nothing to keep.",
    },
  ),
  said(
    "Does the About page name everyone?",
    ["Everyone", "The founders", "Nobody, a picture of the team"],
    "gus",
    "alice",
    {
      option: 2,
    },
  ),
  said(
    "Is the cookie notice a bar or a page?",
    ["A bar", "A page linked from the footer"],
    "dana",
    "bob",
    {
      option: 1,
      note: "We set no cookie that needs asking.",
      outcome: "The bar is gone. The page says which cookies there are and why.",
    },
  ),
  said("Which typeface do the headings use?", ["The serif", "The sans"], "carol", "carol", {
    option: 1,
  }),
  said("Is the footer the same on every page?", ["Yes", "Shorter on the docs"], "carol", "alice", {
    option: 0,
  }),
  said("Does the search box sit in the header?", ["Yes", "Only on the docs"], "dana", "carol", {
    option: 1,
    outcome: "On the docs for now; the site gets it with the search goal.",
  }),
  said("Are the release notes a page or a feed?", ["A page", "A feed", "Both"], "eli", "dana", {
    option: 2,
  }),
  said(
    "Who answers the address the site names for questions?",
    ["Support", "Whoever is on call"],
    "eli",
    "alice",
    {
      option: 0,
    },
  ),
  said("Do the illustrations keep their outlines?", ["Yes", "No, flat shapes"], "gus", "carol", {
    option: 1,
    note: "Flat shapes, two tones each.",
  }),
  said("Is the careers page part of the relaunch?", ["Yes", "Later"], "alice", "alice", {
    option: 1,
  }),
  said(
    "Is the old logo kept anywhere?",
    ["On the invoices until the year ends", "Nowhere"],
    "bob",
    "alice",
    {
      option: 0,
      outcome: "The invoices change with the first of the new year.",
    },
  ),
  said("Does every page say when it was last changed?", ["Yes", "Only the docs"], "dana", "carol", {
    option: 1,
  }),
  said(
    "Are the customer stories rewritten or carried over?",
    ["Rewritten", "Carried over"],
    "alice",
    "bob",
    {
      own: "Carried over, the three longest rewritten",
    },
  ),
  said(
    "Is the site measured with a tool of our own or one that is bought?",
    ["Our own", "Bought"],
    "dana",
    "alice",
    {
      option: 0,
      note: "Page views and the sign-up funnel, nothing a person could be told apart by.",
    },
  ),
  said("Do the docs show the version they are about?", ["Yes", "No"], "mira", "dana", {
    option: 0,
  }),
  said(
    "Is the front page's picture a photograph or drawn?",
    ["A photograph", "Drawn"],
    "carol",
    "alice",
    {
      option: 1,
    },
  ),
  said(
    "Does the sign-up button say what happens next?",
    ["Create your workspace", "Sign up", "Start"],
    "carol",
    "alice",
    {
      option: 0,
      outcome: "It says Create your workspace everywhere the form is reached from.",
    },
  ),
  said("Are the legal pages redrawn?", ["Yes", "Only their type"], "bob", "alice", {
    option: 1,
  }),
];

/** What is asked in the private project, so that a decision reaches someone from a project of few. */
export const OPS_DECISIONS: readonly DecisionData[] = [
  {
    question: "Do the desks come assembled?",
    body: "Assembled costs a day of delivery more and nobody's weekend.",
    options: ["Assembled", "Flat, and we build them"],
    by: "bob",
    to: ["alice"],
    task: "Order the desks and have them delivered before the move",
  },
  said(
    "Which weekend do the machines move?",
    ["The first of the month", "The second"],
    "dana",
    "alice",
    {
      option: 1,
      note: "The first is the close.",
    },
  ),
];

export interface PageData {
  readonly path: string;
  readonly title: string;
  /** The page as it was written, a version each, the last one standing. */
  readonly versions: readonly string[];
  readonly by?: Member;
  readonly files?: readonly PreviewFile[];
}

const SIGN_UP_FLOW_V1 = `How many of the people who open the sign-up form reach a workspace, a step at a time.

| Step | Opened | Left |
|---|---|---|
| 1. Account | 1,840 | 147 |
| 2. Company | 1,693 | 694 |
| 3. Workspace | 999 | 120 |
`;

const SIGN_UP_FLOW_V3 = `How many of the people who open the sign-up form reach a workspace, a step at a time, over the last quarter. The numbers are in the file below, a row per step.

![Where the people leave](where-people-leave.png)

| Step | Opened | Left | Share |
|---|---|---|---|
| 1. Account | 1,840 | 147 | 8% |
| 2. Company | 1,693 | 694 | 41% |
| 3. Workspace | 999 | 120 | 12% |

## What it says

Four in ten leave at the questions about their company. Nothing reads those answers in the first week.

## What follows

- The form becomes one step: see the [release checklist](guides/release/checklist) for when.
- The words of the form follow [Voice and tone](guides/writing/voice).
- A confirmation that never arrives is in [Rolling back a release](guides/release/rollback), under what went wrong last time.
`;

export const WEBSITE_PAGES: readonly PageData[] = [
  {
    path: "start-here",
    title: "Start here",
    versions: [
      "What the relaunch is, and where each part of it is written down.\n\n- How people sign up today, and where they leave: [The sign-up flow, as measured](guides/sign-up-flow)\n- How the site speaks: [Voice and tone](guides/writing/voice) and [Words we use](guides/writing/words-we-use)\n- How a release goes out and comes back: [Release checklist](guides/release/checklist), [Rolling back a release](guides/release/rollback)\n- What was decided and why: [Why the brand colours changed](decisions/brand-colours)\n",
    ],
  },
  {
    path: "guides/sign-up-flow",
    title: "The sign-up flow, as measured",
    versions: [
      SIGN_UP_FLOW_V1,
      `${SIGN_UP_FLOW_V1}\nFour in ten leave at the questions about their company.\n`,
      SIGN_UP_FLOW_V3,
    ],
    by: "eli",
    files: [
      { name: "where-people-leave.png", picture: "chart", colour: "blue" },
      { name: "sign-up-funnel.csv", text: FUNNEL_CSV, contentType: "text/csv" },
    ],
  },
  {
    path: "guides/writing/voice",
    title: "Voice and tone",
    versions: [
      "The site speaks as a person at Acme would to someone they have just met: plainly, and without selling.\n\n## Say what it does\n\n> Make a workspace, and your team is in it.\n\nnot\n\n> Unlock seamless collaboration for your whole organization.\n\n## Three rules\n\n1. One idea a sentence.\n2. The reader is *you*; Acme is *we*.\n3. A button says what happens when it is pressed.\n\nThe words themselves are in [Words we use](guides/writing/words-we-use).\n",
    ],
    by: "carol",
  },
  {
    path: "guides/writing/words-we-use",
    title: "Words we use",
    versions: [
      "| We say | Not |\n|---|---|\n| workspace | account, tenant, instance |\n| sign up | register, onboard |\n| person, people | user, users |\n| page | screen, view |\n\nA word that is not here is looked up in [Voice and tone](guides/writing/voice) first.\n",
    ],
    by: "carol",
  },
  {
    path: "guides/release/checklist",
    title: "Release checklist",
    versions: [
      "Before, on the day and after.\n\n## Before\n\n- [x] Every old address has somewhere to go\n- [x] The audit's findings are closed\n- [ ] Support has read the new pages\n- [ ] The status page says a release is coming\n\n## On the day\n\n1. Put the new site at its address.\n2. Open ten pages by hand, three on a phone.\n3. Sign up once, from nothing.\n\n## After\n\nWatch the sign-up numbers for a week. If they fall, [roll back](guides/release/rollback).\n",
    ],
    by: "dana",
  },
  {
    path: "guides/release/rollback",
    title: "Rolling back a release",
    versions: [
      "A release is rolled back by whoever sees it is wrong, without asking first.\n\n```sh\nacme-site release list\nacme-site release back --to <release>\n```\n\nThe site is at its last release within a minute. Then say so, on the status page and to the team.\n\n## What went wrong last time\n\nThe confirmation emails pointed at the old site for an hour. The fix is a setting, `SITE_ADDRESS`, which the release now checks before it goes out.\n",
    ],
    by: "dana",
  },
  {
    path: "decisions/brand-colours",
    title: "Why the brand colours changed",
    versions: [
      "The old blue failed the contrast check on white, and the old orange on everything.\n\n- The blue is deeper, and passes at every size.\n- The orange stays for one thing: what should be looked at first.\n\nWhat was asked, and what was answered, is on the board, under the decisions of this project.\n",
    ],
    by: "carol",
  },
  {
    path: "meetings/kickoff",
    title: "Kickoff notes",
    versions: [
      "Present: Alice, Carol, Dana, Eli.\n\n- The relaunch is four releases, not one.\n- Sign-up goes first, since it is where people leave.\n- The docs follow, then the brand, then the rest.\n\nNext: the measurements, by Eli, in [The sign-up flow, as measured](guides/sign-up-flow).\n",
    ],
  },
];

export const HANDBOOK_PAGES: readonly PageData[] = [
  {
    path: "welcome",
    title: "Welcome to Acme",
    versions: [
      "This is the handbook: how Acme works, written by the people who do the work.\n\n- Your [first week](onboarding/first-week)\n- Where your [laptop](onboarding/accounts/laptop) and your [mail](onboarding/accounts/mail) come from\n- [Time off](policies/time-off) and [expenses](policies/expenses)\n- How [meetings](how-we-work/meetings) and [reviews](how-we-work/reviews) are run\n",
    ],
  },
  {
    path: "onboarding/first-week",
    title: "Your first week",
    versions: [
      "| Day | What happens |\n|---|---|\n| Monday | Your laptop, your accounts, lunch with your team |\n| Tuesday | You read the handbook, and change a page of it |\n| Wednesday | Your first task, with someone beside you |\n| Thursday | You show what you did |\n| Friday | You say what was unclear, and it is written down here |\n\nNothing is expected of you in the first week but questions.\n",
    ],
  },
  {
    path: "onboarding/accounts/laptop",
    title: "Your laptop",
    versions: [
      "It is on your desk on your first morning, set up. If it is not, ask whoever is named on the [first week](onboarding/first-week) page.\n",
    ],
    by: "dana",
  },
  {
    path: "onboarding/accounts/mail",
    title: "Your mail",
    versions: [
      "Your address is your first name at the company's domain. It signs you in everywhere else.\n",
    ],
    by: "dana",
  },
  {
    path: "policies/time-off",
    title: "Time off",
    versions: [
      "Ask as early as you know. A day off needs no reason.\n\n1. Say which days, to your manager.\n2. Put them in the calendar.\n3. Say who answers for you while you are out.\n",
    ],
  },
  {
    path: "policies/expenses",
    title: "Expenses",
    versions: [
      "What you spend for work is paid back within the month it is handed in.\n\n- A picture of the receipt is enough.\n- Anything above what a team lunch costs is asked for first.\n",
    ],
    by: "bob",
  },
  {
    path: "how-we-work/meetings",
    title: "Meetings",
    versions: [
      "A meeting has someone who called it, something to decide, and notes anyone can read after.\n",
    ],
  },
  {
    path: "how-we-work/reviews",
    title: "Reviews",
    versions: [
      "Ask for a review when the work can be looked at, not when it is finished. Give one the day it is asked for.\n",
    ],
    by: "dana",
  },
];

/**
 * What Mira's session holds: a turn the board woke her for, one a supervisor began, and one
 * under way. `{errors}` and `{link}` stand for the numbers of the two tasks it is about.
 */
export const SESSION_SCRIPT: readonly {
  readonly kind:
    | "wake"
    | "person"
    | "assistant"
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "permission"
    | "status"
    | "error";
  readonly text: string;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
  /** Seconds after the event before it. */
  readonly after: number;
  /** A picture the block carries, as a tool's answer does. */
  readonly picture?: {
    readonly name: string;
    readonly picture: "form";
    readonly colour: PictureColour;
  };
}[] = [
  {
    kind: "status",
    text: "The product started.",
    data: { model: "opus", effort: "high", version: "2.1.321", mode: "auto" },
    after: 0,
  },
  {
    kind: "wake",
    text: `A comment on #{errors} "${FIELD_ERRORS}" in website. Read it: console task {errors} --project website`,
    data: { kind: "wake", source: "board", key: "website#{errors}" },
    after: 2,
  },
  {
    kind: "thinking",
    text: "The task is a part of the sign-up form's rebuild. The form is one step now, so the errors that named the second step are stale. I should read the form first, then the messages.",
    after: 3,
  },
  {
    kind: "assistant",
    text: "I am on the field errors of the sign-up form. Reading the form as it is first.",
    after: 4,
  },
  {
    kind: "tool_call",
    text: '{"file_path":"src/sign-up/form.tsx"}',
    data: { tool: "Read", id: "call-1" },
    after: 2,
  },
  {
    kind: "tool_result",
    text: "export function SignUpForm() {\n  const [form, setForm] = useState(EMPTY);\n  const problems = problemsOf(form);\n  ...\n}",
    data: { id: "call-1", error: false },
    after: 1,
  },
  {
    kind: "tool_call",
    text: '{"pattern":"step === 2","path":"src/sign-up"}',
    data: { tool: "Grep", id: "call-2" },
    after: 3,
  },
  {
    kind: "tool_result",
    text: 'src/sign-up/messages.ts:14:  if (step === 2 && form.size === undefined) {\nsrc/sign-up/messages.ts:19:  if (step === 2 && form.industry === "") {',
    data: { id: "call-2", error: false },
    after: 1,
  },
  {
    kind: "assistant",
    text: "Two messages are about questions the form no longer asks. I will take them out and put the other four beside their fields.",
    after: 5,
  },
  {
    kind: "tool_call",
    text: '{"file_path":"src/sign-up/messages.ts","old_string":"if (step === 2 && form.size === undefined) {","new_string":""}',
    data: { tool: "Edit", id: "call-3" },
    after: 6,
  },
  {
    kind: "tool_result",
    text: "The file src/sign-up/messages.ts has been updated.",
    data: { id: "call-3", error: false },
    after: 1,
  },
  {
    kind: "permission",
    text: "pnpm test --filter sign-up",
    data: { tool: "Bash", id: "call-4", answer: "allowed" },
    after: 4,
  },
  {
    kind: "tool_call",
    text: '{"command":"pnpm test --filter sign-up"}',
    data: { tool: "Bash", id: "call-4" },
    after: 1,
  },
  {
    kind: "tool_result",
    text: "FAIL  src/sign-up/form.test.tsx > says what is wrong with the email beside it\n  expected the message under the field, found it above the form\n\n 1 failed | 11 passed",
    data: { id: "call-4", error: true },
    after: 21,
  },
  {
    kind: "thinking",
    text: "One test fails: the email's message is still rendered above the form. The field takes a `problem` prop that the form does not pass.",
    after: 3,
  },
  {
    kind: "tool_call",
    text: '{"file_path":"src/sign-up/form.tsx","old_string":"<Field name=\\"email\\" />","new_string":"<Field name=\\"email\\" problem={problems.email} />"}',
    data: { tool: "Edit", id: "call-5" },
    after: 5,
  },
  {
    kind: "tool_result",
    text: "The file src/sign-up/form.tsx has been updated.",
    data: { id: "call-5", error: false },
    after: 1,
  },
  {
    kind: "tool_call",
    text: '{"command":"pnpm test --filter sign-up"}',
    data: { tool: "Bash", id: "call-6" },
    after: 2,
  },
  { kind: "tool_result", text: " 12 passed", data: { id: "call-6", error: false }, after: 19 },
  {
    kind: "tool_call",
    text: '{"url":"https://preview.acme.example/sign-up","width":390}',
    data: { tool: "Screenshot", id: "call-7" },
    after: 3,
  },
  {
    kind: "tool_result",
    text: "A picture of the page, 390 wide.",
    data: { id: "call-7", error: false },
    after: 4,
    picture: { name: "sign-up-390.png", picture: "form", colour: "pink" },
  },
  {
    kind: "assistant",
    text: "The errors are beside their fields, on a phone too, and the tests pass. I wrote it on the task and moved on to what waits.\n\n- Two messages went with the questions they were about.\n- The email's message was above the form; it is under its field now.",
    after: 6,
  },
  { kind: "status", text: "The turn completed.", data: { turn: "completed" }, after: 1 },
  {
    kind: "person",
    text: "Before you go on: does the button move when an error shows? It did on the old form.",
    data: { kind: "tell", source: "person", key: null, by: "Alice", agent: null },
    after: 240,
  },
  {
    kind: "thinking",
    text: "The button is below the last field. An error adds a line under a field, so the button would move down by a line unless the line's room is kept.",
    after: 3,
  },
  {
    kind: "tool_call",
    text: '{"file_path":"src/sign-up/field.css"}',
    data: { tool: "Read", id: "call-8" },
    after: 2,
  },
  {
    kind: "tool_result",
    text: ".field-problem {\n  min-height: 1.25rem;\n}",
    data: { id: "call-8", error: false },
    after: 1,
  },
  {
    kind: "assistant",
    text: "It does not: the line under each field keeps its room whether it says anything or not, so the button stays where it is. I checked it on the preview at both widths.",
    after: 5,
  },
  { kind: "status", text: "The turn completed.", data: { turn: "completed" }, after: 1 },
  {
    kind: "wake",
    text: `A comment on #{link} "${CONFIRMATION_LINK}" in website. Read it: console task {link} --project website`,
    data: { kind: "wake", source: "board", key: "website#{link}" },
    after: 600,
  },
  {
    kind: "assistant",
    text: "Someone wrote on the confirmation link. Reading it before I go on.",
    after: 4,
  },
  {
    kind: "tool_call",
    text: '{"command":"console task {link} --project website"}',
    data: { tool: "Bash", id: "call-9" },
    after: 2,
  },
];
