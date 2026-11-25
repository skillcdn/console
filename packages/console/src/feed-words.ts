import { en, type Messages } from "./i18n/en.js";
import type { RestEvent } from "./schemas.js";

// What an event of the feed says, as a sentence a person reads at a glance, in a language's
// words (ADR-0012). Apart from the component that shows the feed, which is a page's, so that
// the command says an event in the same sentence and loads nothing of a page for it.

/** What an event says, without its actor: the words after the name, in the words given; a board's event a plugin caused says so (ADR-0052). */
export function describeEvent(event: RestEvent, words: Messages = en): string {
  const sentence = sentenceOf(event, words);
  return event.plugin !== null && !event.kind.startsWith("plugin.")
    ? `${sentence} ${words.feed.throughPlugin(event.plugin)}`
    : sentence;
}

function sentenceOf(event: RestEvent, words: Messages): string {
  const { data } = event;
  const { feed, vocabulary } = words;
  const task =
    data.number === undefined
      ? feed.aTask
      : `#${data.number}${data.title === undefined ? "" : ` ${data.title}`}`;
  const project = data.name ?? data.key ?? feed.aProject;
  const changed = (data.fields ?? []).map((field) => feed.field[field] ?? field);
  // A keyed secret's value is named with the key it is kept under (ADR-0111).
  const fields =
    changed.length === 0
      ? feed.something
      : `${changed.join(", ")}${data.under === undefined ? "" : ` (${data.under})`}`;
  const page = feed.thePage(data.title ?? data.path ?? "");
  const role = (value: string | undefined): string =>
    value === "admin"
      ? feed.role.admin
      : value === "owner"
        ? feed.role.owner
        : value === "member"
          ? feed.role.member
          : feed.role.other;
  const login = data.login ?? feed.someone;
  const question = data.question ?? feed.aQuestion;
  const goal = data.title ?? feed.aGoal;
  const category = data.name ?? data.key ?? feed.aCategory;
  const plugin = event.plugin ?? feed.aPlugin;
  const grantee =
    data.everyone === true
      ? feed.everyone
      : data.grantee !== undefined
        ? feed.thePlugin(data.grantee)
        : data.team !== undefined
          ? feed.theTeam(data.team)
          : data.login !== undefined
            ? data.login
            : data.key !== undefined
              ? feed.membersOf(data.name ?? data.key)
              : feed.someone;
  switch (event.kind) {
    case "person.joined":
      return feed.event.personJoined();
    case "person.role_changed":
      return feed.event.roleChanged(login, role(data.role));
    case "person.listed":
      return feed.event.personListed(login);
    case "person.unlisted":
      return feed.event.personUnlisted(login);
    case "person.deactivated":
      return feed.event.personDeactivated(login);
    case "person.reactivated":
      return feed.event.personReactivated(login);
    case "person.manager_changed":
      return data.manager === null || data.manager === undefined
        ? feed.event.managerCleared(login)
        : feed.event.managerChanged(login, data.manager);
    case "person.email_changed":
      return data.set === true ? feed.event.emailChanged(login) : feed.event.emailCleared(login);
    case "person.updated": {
      // An account at a messenger said to be the member's, or theirs no longer (ADR-0164).
      if (data.account !== undefined && data.messenger !== undefined) {
        return data.set === true
          ? feed.event.accountLinked(login, data.messenger, data.account)
          : feed.event.accountUnlinked(login, data.messenger, data.account);
      }
      const of = (data.fields ?? []).map(
        (field) => feed.personField[field] ?? feed.field[field] ?? field,
      );
      return feed.event.personUpdated(of.length === 0 ? feed.something : of.join(", "), login);
    }
    case "agent.state_changed": {
      // The account says how it stands itself, through its runner; the console says it of an
      // account it has not heard from, and names it.
      const own = event.actor !== null && event.actor.login === data.login;
      const agent = own ? undefined : data.handle === undefined ? login : `@${data.handle}`;
      const said =
        data.state === "stopped"
          ? feed.event.agentStopped(agent)
          : data.state === "refused"
            ? feed.event.agentRefused(agent)
            : data.state === "failed"
              ? feed.event.agentFailed(agent)
              : data.state === "unheard"
                ? feed.event.agentUnheard(agent)
                : feed.event.agentRunning(agent);
      return data.detail === undefined ? said : `${said}: ${data.detail}`;
    }
    case "team.created":
      return feed.event.teamCreated(data.team ?? feed.aTeam);
    case "team.renamed":
      return feed.event.teamRenamed(data.name ?? feed.aTeam, data.team ?? feed.aTeam);
    case "team.removed":
      return feed.event.teamRemoved(data.team ?? feed.aTeam);
    case "team.member_added":
      return feed.event.teamMemberAdded(login, data.team ?? feed.aTeam);
    case "team.member_removed":
      return feed.event.teamMemberRemoved(login, data.team ?? feed.aTeam);
    case "workspace.updated":
      return feed.event.workspaceUpdated(fields);
    case "project.created":
      return feed.event.projectCreated(project);
    case "project.updated":
      return feed.event.projectUpdated(fields, project);
    case "project.member_added":
      return feed.event.memberAdded(login, project, role(data.role));
    case "project.member_changed":
      return feed.event.memberChanged(login, role(data.role), project);
    case "project.member_removed":
      return feed.event.memberRemoved(login, project);
    case "category.created":
      return feed.event.categoryCreated(category);
    case "category.updated":
      return feed.event.categoryUpdated(fields, category);
    case "category.removed":
      return feed.event.categoryRemoved(category);
    case "goal.created":
      return feed.event.goalCreated(goal);
    case "goal.updated":
      return feed.event.goalUpdated(fields, goal);
    case "task.created":
      return feed.event.taskCreated(task);
    case "task.moved":
      return feed.event.taskMoved(
        task,
        vocabulary.state[data.from ?? "idea"],
        vocabulary.state[data.to ?? "idea"],
      );
    case "task.updated":
      return feed.event.taskUpdated(fields, task);
    case "task.commented":
      return feed.event.taskCommented(task, data.excerpt);
    case "task.archived":
      return feed.event.taskArchived(task);
    case "task.restored":
      return feed.event.taskRestored(task);
    case "decision.raised":
      return feed.event.decisionRaised(question);
    case "decision.answered":
      return feed.event.decisionAnswered(question, data.option ?? "");
    case "decision.addressed":
      return feed.event.decisionAddressed(question, (data.deciders ?? []).join(", "));
    case "decision.updated":
      return feed.event.decisionUpdated(fields, data.question ?? "");
    case "run.started":
      return feed.event.runStarted(task);
    case "run.reported":
      return feed.event.runReported(task, data.excerpt);
    case "run.handed_in":
      return feed.event.runHandedIn(data.label ?? feed.something, task);
    case "run.taken_over":
      return feed.event.runTakenOver(task, data.agent ?? feed.someone);
    case "run.ended":
      return data.status === "finished"
        ? feed.event.runFinished(task)
        : data.status === "failed"
          ? feed.event.runFailed(task)
          : data.reason === "unheard"
            ? feed.event.runUnheard(task, data.agent ?? feed.someone)
            : feed.event.runAbandoned(task);
    case "document.written":
      return feed.event.documentWritten(page, data.version);
    case "document.archived":
      return feed.event.documentArchived(page);
    case "document.restored":
      return feed.event.documentRestored(page);
    case "document.file_attached":
      return feed.event.fileAttached(data.label ?? feed.aFile, page);
    case "plugin.enabled":
      return feed.event.pluginEnabled(plugin);
    case "plugin.disabled":
      return feed.event.pluginDisabled(plugin);
    case "plugin.configured":
      return data.capabilities !== undefined
        ? feed.event.pluginConsented(plugin)
        : data.source !== undefined && data.source !== "administrator"
          ? feed.event.pluginSealed(fields, plugin, data.source)
          : feed.event.pluginConfigured(fields, plugin);
    case "plugin.granted":
      return feed.event.pluginGranted(data.role ?? feed.role.other, grantee, plugin);
    case "plugin.revoked":
      return feed.event.pluginRevoked(data.role ?? feed.role.other, grantee, plugin);
    case "plugin.upgraded":
      return feed.event.pluginUpgraded(
        plugin,
        data.version === undefined ? feed.something : String(data.version),
      );
    case "plugin.command":
      return feed.event.pluginCommand(
        data.command ?? feed.something,
        plugin,
        feed.outcome[data.outcome ?? ""] ?? data.outcome ?? feed.something,
      );
    case "plugin.purged":
      return feed.event.pluginPurged(plugin);
    case "plugin.failed":
      return feed.event.pluginFailed(plugin, data.problem ?? feed.something);
  }
}
