import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { PersonRecord } from "../db/queries/people.js";
import {
  type AccessSettings,
  aboveInLine,
  administers,
  asActedFor,
  configuresWorkspace,
  decisionAddressedTo,
  decisionAnswerableBy,
  decisionOnPlateOf,
  decisionRaisedBy,
  decisionReachableBy,
  decisionWaitsFor,
  mayAdminister,
  mayWorkIn,
  memberOfProject,
  peopleNarrowedFor,
  personFindableBy,
  personVisibleTo,
  projectVisibleTo,
  readsListings,
  readsWorkspaceEvents,
  supervises,
} from "./policy.js";

const person = (role: "admin" | "member", id = `id-${role}`): PersonRecord => ({
  id,
  workspaceId: "ws",
  kind: "person",
  host: "gh",
  hostAccountId: id,
  login: role,
  name: undefined,
  avatarUrl: undefined,
  role,
  status: "active",
  source: "listed",
  deactivatedAt: undefined,
  managerId: undefined,
  language: undefined,
  email: undefined,
  handle: undefined,
  title: undefined,
  avatarParts: undefined,
});

const admin = person("admin");
const member = person("member");
const everyone: AccessSettings = { peopleVisibility: "everyone" };
const shared: AccessSettings = { peopleVisibility: "shared_projects" };

/** The SQL a predicate renders, with its parameters, as the database would be asked: in the schema's snake case. */
const render = (predicate: ReturnType<typeof projectVisibleTo>) =>
  new PgDialect({ casing: "snake_case" }).sqlToQuery(predicate);

describe("the policy", () => {
  it("decides who is narrowed, who reads the listings and the workspace's events, and who configures", () => {
    const table: [PersonRecord, AccessSettings, boolean][] = [
      [admin, everyone, false],
      [admin, shared, false],
      [member, everyone, false],
      [member, shared, true],
    ];
    for (const [who, settings, narrowed] of table) {
      expect(peopleNarrowedFor(who, settings)).toBe(narrowed);
      expect(readsListings(who, settings)).toBe(!narrowed);
      expect(readsWorkspaceEvents(who, settings)).toBe(!narrowed);
    }
    expect(administers(admin)).toBe(true);
    expect(administers(member)).toBe(false);
    expect(configuresWorkspace(admin)).toBe(true);
    expect(configuresWorkspace(member)).toBe(false);
  });

  it("sees every project as an administrator, and as a member only where the membership condition holds", () => {
    expect(render(projectVisibleTo(admin)).sql).toBe("true");
    const asMember = render(projectVisibleTo(member));
    expect(asMember.sql).toContain(`"projects"."visibility" = 'workspace'`);
    expect(asMember.sql).toContain(`"project_members"."person_id" = $1`);
    expect(asMember.params).toEqual([member.id]);
    // The one condition of membership is the same text wherever it is asked.
    expect(asMember.sql).toBe(render(memberOfProject(member.id)).sql);
  });

  it("shows everyone unless narrowed, and then only the active people one shares a project with, oneself and the administrators", () => {
    expect(render(personVisibleTo(member, everyone)).sql).toBe("true");
    expect(render(personVisibleTo(admin, shared)).sql).toBe("true");
    const narrowed = render(personVisibleTo(member, shared));
    expect(narrowed.sql).toContain(`"people"."status" = 'active'`);
    expect(narrowed.sql).toContain(`"people"."id" = $1`);
    expect(narrowed.sql).toContain(`"people"."role" = 'admin'`);
    // Both the asker and the person read are held to the membership condition of the same project.
    expect(narrowed.sql.match(/"projects"."visibility" = 'workspace'/g)).toHaveLength(2);
    // Whoever is below the asker in the reporting line, whatever the projects say (ADR-0084).
    expect(narrowed.sql).toContain(render(aboveInLine(member.id)).sql.replace("$1", "$2"));
    expect(narrowed.params).toEqual([member.id, member.id, member.id]);
    // And whom the asker reports to, where they report to someone.
    const reporting = render(personVisibleTo({ ...member, managerId: "id-boss" }, shared));
    expect(reporting.sql).toContain(`"people"."id" = $2`);
    expect(reporting.params).toEqual([member.id, "id-boss", member.id, member.id]);
  });

  it("keeps one thing from an agent account, the administration, and answers every other rule as for a person (ADR-0084)", () => {
    const agent: PersonRecord = { ...member, kind: "agent", handle: "mira" };
    // The one rule that reads the kind.
    expect(mayAdminister(member)).toBe(true);
    expect(mayAdminister(admin)).toBe(true);
    expect(mayAdminister(agent)).toBe(false);
    // Held closed: a row that named an agent account an administrator would administer nothing.
    expect(administers({ ...agent, role: "admin" })).toBe(false);
    expect(configuresWorkspace({ ...agent, role: "admin" })).toBe(false);

    // Every other rule: an agent account in a person's place, and the same answer.
    for (const settings of [everyone, shared]) {
      expect(peopleNarrowedFor(agent, settings)).toBe(peopleNarrowedFor(member, settings));
      expect(readsListings(agent, settings)).toBe(readsListings(member, settings));
      expect(readsWorkspaceEvents(agent, settings)).toBe(readsWorkspaceEvents(member, settings));
      expect(render(personVisibleTo(agent, settings))).toEqual(
        render(personVisibleTo(member, settings)),
      );
      for (const owns of [true, false]) {
        expect(render(personFindableBy(agent, settings, owns))).toEqual(
          render(personFindableBy(member, settings, owns)),
        );
      }
    }
    expect(administers(agent)).toBe(administers(member));
    expect(configuresWorkspace(agent)).toBe(configuresWorkspace(member));
    expect(asActedFor(agent)).toBe(agent);
    const same: [string, (who: PersonRecord) => ReturnType<typeof projectVisibleTo>][] = [
      ["projectVisibleTo", projectVisibleTo],
      ["decisionReachableBy", decisionReachableBy],
      ["decisionAnswerableBy", decisionAnswerableBy],
      ["decisionWaitsFor", decisionWaitsFor],
      ["decisionRaisedBy", decisionRaisedBy],
      ["supervises", supervises],
    ];
    for (const [name, rule] of same) {
      expect(render(rule(agent)), name).toEqual(render(rule(member)));
    }
    // Where a rule takes the member by id or by column, it cannot tell the two apart at all.
    expect(render(mayWorkIn("project-1", agent.id))).toEqual(
      render(mayWorkIn("project-1", member.id)),
    );
    expect(render(decisionOnPlateOf(agent.id))).toEqual(render(decisionOnPlateOf(member.id)));
  });

  it("names the supervisors of an agent account: the administrators, and the line above it (ADR-0084)", () => {
    // An administrator supervises every agent account, and nobody who is not one.
    expect(render(supervises(admin)).sql).toBe(`"people"."kind" = 'agent'`);
    const above = render(supervises(member));
    expect(above.sql).toContain(`"people"."kind" = 'agent'`);
    // Up the reporting line from the account, to its manager and whoever is above them.
    expect(above.sql).toContain("with recursive above(id) as");
    expect(above.sql).toContain(`select "people"."manager_id" union`);
    expect(above.sql).toContain("above.id = $1::uuid");
    expect(above.params).toEqual([member.id]);
  });

  it("lets an owner find anyone active by login when narrowed, and everyone else only whom they see", () => {
    expect(render(personFindableBy(member, everyone, false)).sql).toBe("true");
    expect(render(personFindableBy(member, shared, true)).sql).toBe(`"people"."status" = 'active'`);
    expect(render(personFindableBy(member, shared, false)).sql).toBe(
      render(personVisibleTo(member, shared)).sql,
    );
  });

  it("reaches a decision past its project for whom it is addressed to, who raised it, and, for a plugin's, whoever manages a decider (ADR-0068)", () => {
    expect(render(decisionReachableBy(admin)).sql).toBe("true");
    expect(render(decisionAnswerableBy(admin)).sql).toBe("true");
    const addressed = render(decisionAddressedTo(member.id));
    expect(addressed.sql).toContain(`any("decisions"."decider_ids")`);
    expect(addressed.sql).toContain(`"decisions"."decider_id" = $2::uuid`);
    const reach = render(decisionReachableBy(member));
    expect(reach.sql).toContain(`"decisions"."raised_by_id" = $1::uuid`);
    expect(reach.sql).toContain(
      render(decisionAddressedTo(member.id))
        .sql.replace("$1", "$2")
        .replace("$2::uuid)", "$3::uuid)"),
    );
    // A plugin's decision alone climbs the reporting line, and the climb ends where the line does.
    expect(reach.sql).toContain(`"plugin_links"."target_kind" = 'decision'`);
    expect(reach.sql).toContain("with recursive above(id) as");
    expect(reach.sql).toContain(`"people"."manager_id" is not null`);
    // A person's own decision only while they are a member of its project (ADR-0077).
    expect(reach.sql).toContain(`"projects"."id" = "decisions"."project_id"`);
    expect(reach.sql).toContain(`"projects"."visibility" = 'workspace'`);
    expect(reach.params).toEqual([member.id, member.id, member.id, member.id, member.id]);
    // Answering from outside the project is for those addressed and those above them, never for the raiser alone.
    const answer = render(decisionAnswerableBy(member));
    expect(answer.sql).not.toContain("raised_by_id");
    expect(answer.sql).toContain("with recursive above(id) as");
    expect(answer.sql).toContain(`"projects"."id" = "decisions"."project_id"`);
    expect(answer.params).toEqual([member.id, member.id, member.id, member.id]);
  });

  it("keeps a person's own decision in its project: whom it is addressed to and who raised it find it while they are in it (ADR-0077)", () => {
    const mine = render(decisionWaitsFor(member));
    expect(mine.sql).toContain(render(decisionAddressedTo(member.id)).sql);
    expect(mine.sql).toContain(`"plugin_links"."target_kind" = 'decision'`);
    expect(mine.sql).toContain(`"projects"."visibility" = 'workspace'`);
    expect(mine.params).toEqual([member.id, member.id, member.id]);
    const raised = render(decisionRaisedBy(member));
    expect(raised.sql).toContain(`"decisions"."raised_by_id" = $1::uuid`);
    expect(raised.sql).toContain(`"projects"."visibility" = 'workspace'`);
    // An administrator may work in every project: theirs wherever it is.
    expect(render(decisionWaitsFor(admin)).sql).toBe(render(decisionAddressedTo(admin.id)).sql);
    expect(render(decisionRaisedBy(admin)).sql).toBe(`"decisions"."raised_by_id" = $1::uuid`);
  });

  it("holds whom a plugin acts for to a member's standing, and what it answers for them to their plate (ADR-0072)", () => {
    const acted = asActedFor(admin);
    expect(administers(acted)).toBe(false);
    expect(acted.id).toBe(admin.id);
    expect(render(projectVisibleTo(acted)).sql).toBe(render(projectVisibleTo(member)).sql);
    expect(peopleNarrowedFor(acted, shared)).toBe(true);
    expect(asActedFor(member)).toBe(member);
    // The plate is the same for an administrator as for anyone: addressed to them, or a plugin's
    // addressed to someone they manage; never `true`.
    const plate = render(decisionOnPlateOf(admin.id));
    expect(plate.sql).toBe(render(decisionAnswerableBy(member)).sql);
    expect(plate.params).toEqual([admin.id, admin.id, admin.id, admin.id]);
  });

  it("lets an active administrator or member of the project work in it, and nobody else", () => {
    const rendered = render(mayWorkIn("project-1", "person-1"));
    expect(rendered.sql).toContain(`"people"."status" = 'active'`);
    expect(rendered.sql).toContain(`"people"."role" = 'admin'`);
    expect(rendered.sql).toContain(render(memberOfProject("person-1")).sql.replace("$1", "$3"));
    expect(rendered.params).toEqual(["person-1", "project-1", "person-1", "person-1"]);
  });
});
