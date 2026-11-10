import type { RestWorkspace } from "./schemas.js";
import { guideServicesOf } from "./setup-guide.js";

// The onboarding of an agent account (ADR-0088, points 4 to 6): its first task, which the
// console makes when the account is made, with the agent as its worker. The agent works it as
// any task, with a run, reports and decisions; what only a person can do it asks for as a
// decision, of whoever can do it. The task's words are made here, for one account and the
// services of its workspace, in the words of their modules: English, as a skill is, for the
// agent to read as they are.

export interface OnboardingInput {
  /** The account's handle: what the task and its commands name it by. */
  readonly handle: string;
  /** The workspace's names and services (ADR-0089). */
  readonly workspace: Pick<RestWorkspace, "handle" | "domain" | "services">;
}

/** What the onboarding task of an account is called. */
export function onboardingTitle(handle: string): string {
  return `Set up @${handle}`;
}

/** What the runner's first wake says: where the first task is. */
export function onboardingWake(handle: string, project: string, number: number): string {
  return `Your first task is #${number} in ${project}, "${onboardingTitle(handle)}": making your account ready to work. Read it (console task ${number} --project ${project}), then take it.`;
}

const item = (title: string, body: string): string => `- **${title}.** ${body}`;

/** The onboarding task of one account: its title, and its body as Markdown. */
export function onboardingOf(input: OnboardingInput): {
  readonly title: string;
  readonly body: string;
} {
  const { handle } = input;
  const services = guideServicesOf(input.workspace, handle);
  const own = [
    ...services.flatMap((one) => one.onboarding.map((step) => item(step.title, step.body))),
    item(
      "Put your picture on your profiles",
      `\`console agent ${handle} --avatar avatar.png\` writes it as a file. Put it on your profile at each service where you have one, with that service's own tool or in a browser.`,
    ),
    item(
      "Record the accounts you hold elsewhere",
      `For each service you now have an account at, say what you are called there, and never a secret: \`console agent ${handle} --account <service>=<name>\`, as in \`--account github=acme-mira\`. Whoever takes an account out reads there what to close.`,
    ),
    item(
      "Introduce yourself to your manager",
      "`console manager` says who it is. Say who you are, what you do and how to reach you: on the messenger where you have one, else as a comment on this task.",
    ),
  ];
  const asked = services.flatMap((one) => one.asks.map((ask) => item(ask.title, ask.body)));
  const body = [
    `This is your first task, @${handle}: making your account ready to work. Work it as any task: take it, report as you go, and finish it with what is done and what still waits on a person. \`console help\` and the skill \`working-the-board\` say how.`,
    "",
    "## What you do yourself",
    "",
    ...own,
    ...(asked.length === 0
      ? []
      : [
          "",
          "## What only a person can do",
          "",
          `Ask for each as a decision, of whoever can do it, and of your manager where you do not know who. Say the exact values, what to hand back and how, and offer "Done" and "Not now": \`console ask "<question>" --option "Done" --option "Not now"\`. A secret that is handed back is seeded where only you read it, by whoever has it: \`console agent secret ${handle} <name>\`. Go on with the rest meanwhile: the answer wakes you.`,
          "",
          ...asked,
        ]),
    "",
    "## When you are done",
    "",
    "Report what is set up and what still waits on a person, and finish the task.",
    "",
  ].join("\n");
  return { title: onboardingTitle(handle), body };
}
