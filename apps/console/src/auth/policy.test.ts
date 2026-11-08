import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { PersonRecord } from "../db/queries/people.js";
import {
  type AccessSettings,
  administers,
  configuresWorkspace,
  decisionAddressedTo,
  decisionAnswerableBy,
  decisionReachableBy,
  mayWorkIn,
  memberOfProject,
  peopleNarrowedFor,
  personFindableBy,
  personVisibleTo,
  projectVisibleTo,
  readsListings,
  readsWorkspaceEvents,
} from "./policy.js";

const person = (role: "admin" | "member", id = `id-${role}`): PersonRecord => ({
  id,
  workspaceId: "ws",
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
    expect(narrowed.params).toEqual([member.id, member.id]);
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
    expect(reach.params).toEqual([member.id, member.id, member.id, member.id]);
    // Answering from outside the project is for those addressed and those above them, never for the raiser alone.
    const answer = render(decisionAnswerableBy(member));
    expect(answer.sql).not.toContain("raised_by_id");
    expect(answer.sql).toContain("with recursive above(id) as");
    expect(answer.params).toEqual([member.id, member.id, member.id]);
  });

  it("lets an active administrator or member of the project work in it, and nobody else", () => {
    const rendered = render(mayWorkIn("project-1", "person-1"));
    expect(rendered.sql).toContain(`"people"."status" = 'active'`);
    expect(rendered.sql).toContain(`"people"."role" = 'admin'`);
    expect(rendered.sql).toContain(render(memberOfProject("person-1")).sql.replace("$1", "$3"));
    expect(rendered.params).toEqual(["person-1", "project-1", "person-1", "person-1"]);
  });
});
