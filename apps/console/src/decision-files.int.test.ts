import process from "node:process";
import {
  decisionFilePath,
  decisionPath,
  projectPath,
  REST_ROUTES,
  type RestDecision,
  restDecisionSchema,
  restErrorSchema,
  restPeopleSchema,
  restReachedDecisionSchema,
  restTokenCreatedSchema,
} from "@skillcdn/console/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleOf } from "./db/client.js";
import { markPluginItem } from "./db/queries/plugin-board.js";
import { ensureWorkspace } from "./db/queries/workspaces.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./db/testing.js";
import { createFixtureProvider } from "./testing/fixture-provider.js";
import { createHarness, type Harness, SIGN_IN_URL } from "./testing/harness.js";

// A file put on a decision (ADR-0055), read at the decision's own address (ADR-0068): by whoever
// the decision reaches wherever it is, for a plugin's the person it is addressed to outside its
// project and whoever manages them up the reporting line; with a session as with a token; served
// as the project serves its files; and never a file of the project that is not the decision's,
// nor to whom the decision does not reach, both refused with the same answer. A person's own
// decision is the project's (ADR-0077): it reaches nobody who is out of the project.

let testDatabase: TestDatabase;
let h: Harness;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  h = createHarness(testDatabase, {
    providers: [createFixtureProvider(), createFixtureProvider("google")],
    listed: ["alice", "bob", "carol", "dave@acme.test"],
    admins: ["alice"],
  });
});

afterAll(async () => {
  await testDatabase?.drop();
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

/** A request from the console's own pages, as the browser of a signed-in person sends one. */
const send = (cookie: string, method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  h.request(path, {
    method,
    headers: {
      cookie,
      origin: SIGN_IN_URL,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (cookie: string, path: string) => h.request(path, { headers: { cookie } });
/** A request an agent makes with its token, from wherever it runs. */
const bearer = (secret: string, path: string) =>
  h.request(path, { headers: { authorization: `Bearer ${secret}` } });

/** A decision raised in a project with files put on it, as one form (ADR-0055). */
async function raise(
  cookie: string,
  project: string,
  decision: unknown,
  files: readonly { name: string; type: string; bytes: Uint8Array | string }[],
): Promise<RestDecision> {
  const form = new FormData();
  form.set("decision", JSON.stringify(decision));
  for (const file of files) {
    form.append("file", new File([file.bytes], file.name, { type: file.type }), file.name);
  }
  const response = await h.request(projectPath(project, "decisions"), {
    method: "POST",
    headers: { cookie, origin: SIGN_IN_URL },
    body: form,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return restDecisionSchema.parse(await response.json());
}

/** The secret of a token a person makes on the console's own pages, for an agent of theirs. */
async function tokenOf(cookie: string, name: string): Promise<string> {
  const response = await send(cookie, "POST", REST_ROUTES.tokens, { name });
  expect(response.status, await response.clone().text()).toBe(201);
  return restTokenCreatedSchema.parse(await response.json()).secret;
}

describe("a file put on a decision, at the decision's own address (ADR-0068)", () => {
  it("is read by whoever the decision reaches outside its project, served as the project's files are, and refused alike to anyone else and for a file not the decision's", async () => {
    const alice = await h.signIn("alice");
    const bob = await h.signIn("bob");
    const carol = await h.signIn("carol");
    const dave = await h.signIn("dave");
    const people = restPeopleSchema.parse(await (await get(alice, REST_ROUTES.people)).json());
    const idOf = (login: string) => people.items.find((person) => person.login === login)?.id ?? "";
    const [bobId, carolId, daveId] = [idOf("bob"), idOf("carol"), idOf("dave@acme.test")];
    expect([bobId, carolId, daveId]).not.toContain("");

    // A private project Bob is listed in when decisions with files are raised for him, and taken
    // out of afterwards: a plugin's decision is still his, a person's own is not, and the project
    // is closed to him.
    await h.project(alice, { key: "vault", name: "The vault", visibility: "private" });
    const listed = await send(alice, "POST", projectPath("vault", "members"), { personId: bobId });
    expect(listed.status).toBe(201);
    const forBob = await raise(
      alice,
      "vault",
      {
        question: "Which look?",
        body: "The first: ![the first](first.png)",
        options: [{ label: "The first" }, { label: "The second" }],
        deciderId: bobId,
      },
      [
        { name: "first.png", type: "image/png", bytes: PNG },
        { name: "notes.txt", type: "text/plain", bytes: "a\n" },
        { name: "plans.zip", type: "application/zip", bytes: "PK" },
      ],
    );
    // Another decision of the project, Alice's own, with a file of its own.
    const own = await raise(
      alice,
      "vault",
      { question: "Mine alone?", options: [{ label: "Yes" }, { label: "No" }] },
      [{ name: "secret.txt", type: "text/plain", bytes: "s\n" }],
    );
    // A person's own decision for Bob, which stays the project's.
    const ours = await raise(
      alice,
      "vault",
      { question: "Ours?", options: [{ label: "Yes" }, { label: "No" }], deciderId: bobId },
      [{ name: "kept.txt", type: "text/plain", bytes: "k\n" }],
    );
    // The mark a plugin leaves on a decision it raised (ADR-0052), here on one that carries files.
    const workspace = await ensureWorkspace(testDatabase.database, {
      name: "Acme",
      now: new Date(),
    });
    await markPluginItem(drizzleOf(testDatabase.database), {
      workspaceId: workspace.id,
      key: "leave",
      kind: "decision",
      id: forBob.id,
    });
    // Listed, Bob reaches both at their address.
    expect((await get(bob, decisionPath(ours.id))).status).toBe(200);
    expect((await get(bob, decisionPath(forBob.id))).status).toBe(200);
    expect((await send(alice, "DELETE", projectPath("vault", "members", bobId))).status).toBe(204);
    const [picture, notes, plans] = forBob.files ?? [];
    const [secret] = own.files ?? [];
    const [ourFile] = ours.files ?? [];
    if (
      picture === undefined ||
      notes === undefined ||
      plans === undefined ||
      secret === undefined ||
      ourFile === undefined
    ) {
      throw new Error("the decisions came back without their files");
    }

    // Bob reaches the decision, and its files at its address; the project's address is closed to him.
    expect((await get(bob, projectPath("vault"))).status).toBe(404);
    expect((await get(bob, projectPath("vault", "files", picture.id))).status).toBe(404);
    expect((await get(bob, decisionPath(forBob.id))).status).toBe(200);
    const read = await get(bob, decisionFilePath(forBob.id, picture.id));
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
    // Served as the project serves the same file to whoever may see the project.
    const atProject = await get(alice, projectPath("vault", "files", picture.id));
    expect(atProject.status).toBe(200);
    for (const header of [
      "content-type",
      "content-length",
      "content-disposition",
      "x-content-type-options",
      "content-security-policy",
      "cross-origin-resource-policy",
    ]) {
      expect(read.headers.get(header), header).toBe(atProject.headers.get(header));
    }
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(read.headers.get("content-disposition")).toContain("inline");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const text = await get(bob, decisionFilePath(forBob.id, notes.id));
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toBe("a\n");
    const kept = await get(bob, decisionFilePath(forBob.id, plans.id));
    expect(kept.headers.get("content-type")).toBe("application/octet-stream");
    expect(kept.headers.get("content-disposition")).toContain("attachment");
    expect(await kept.text()).toBe("PK");
    // Whoever may see the project reads it here too.
    expect((await get(alice, decisionFilePath(forBob.id, picture.id))).status).toBe(200);

    // Refused alike, as a file not found: a file of the project that is not the decision's, a
    // decision out of the asker's reach, one that is not there, and what is no id at all.
    const refused = async (response: Response) => {
      expect(response.status).toBe(404);
      return restErrorSchema.parse(await response.json()).error;
    };
    const notFound = await refused(await get(bob, decisionFilePath(forBob.id, secret.id)));
    expect(notFound.code).toBe("file.not_found");
    for (const path of [
      decisionFilePath(own.id, secret.id),
      decisionFilePath(own.id, picture.id),
      decisionFilePath("0199c4d8-0000-7000-8000-000000000099", picture.id),
      decisionFilePath("not-an-id", picture.id),
      decisionFilePath(forBob.id, "not-an-id"),
      decisionFilePath(forBob.id, "0199c4d8-0000-7000-8000-000000000099"),
    ]) {
      expect(await refused(await get(bob, path)), path).toEqual(notFound);
    }
    // Carol, whom the decision does not reach, learns nothing of it or its files.
    expect((await get(carol, decisionPath(forBob.id))).status).toBe(404);
    expect(await refused(await get(carol, decisionFilePath(forBob.id, picture.id)))).toEqual(
      notFound,
    );

    // Out of the project, the person's own decision addressed to Bob is not his (ADR-0077): not
    // at its address, not its files, not to answer, and not among his decisions or on his plate.
    expect((await get(bob, decisionPath(ours.id))).status).toBe(404);
    expect(await refused(await get(bob, decisionFilePath(ours.id, ourFile.id)))).toEqual(notFound);
    const answered = await send(bob, "POST", `${decisionPath(ours.id)}/answer`, { option: "1" });
    expect(answered.status).toBe(404);
    const mine = (await (await get(bob, REST_ROUTES.decisions)).json()) as {
      items: { decision: { id: string } }[];
    };
    expect(mine.items.map((item) => item.decision.id)).toEqual([forBob.id]);
    const plate = (await (await get(bob, REST_ROUTES.work)).json()) as {
      decisions: { decision: { id: string } }[];
    };
    expect(plate.decisions.map((item) => item.decision.id)).toEqual([forBob.id]);
    const me = (await (await get(bob, REST_ROUTES.me)).json()) as {
      decisions: { waiting: number };
    };
    expect(me.decisions.waiting).toBe(1);
    // Alice, who raised it and administers the workspace, reads it as before.
    expect((await get(alice, decisionPath(ours.id))).status).toBe(200);

    // An agent's token reads what its person reads, and no more.
    const bobsAgent = await tokenOf(bob, "Bob's agent");
    const throughAgent = await bearer(bobsAgent, decisionFilePath(forBob.id, picture.id));
    expect(throughAgent.status).toBe(200);
    expect(new Uint8Array(await throughAgent.arrayBuffer())).toEqual(PNG);
    expect(await refused(await bearer(bobsAgent, decisionFilePath(forBob.id, secret.id)))).toEqual(
      notFound,
    );
    expect(await refused(await bearer(bobsAgent, decisionFilePath(own.id, secret.id)))).toEqual(
      notFound,
    );
    const carolsAgent = await tokenOf(carol, "Carol's agent");
    expect(
      await refused(await bearer(carolsAgent, decisionFilePath(forBob.id, picture.id))),
    ).toEqual(notFound);

    // A plugin's decision reaches whoever manages a decider, up the reporting line (ADR-0068):
    // Bob reports to Carol, and Carol to Dave. A person's own decision climbs no line.
    const managed = await send(alice, "PATCH", `${REST_ROUTES.people}/${bobId}`, {
      managerId: carolId,
    });
    expect(managed.status, await managed.clone().text()).toBe(200);
    const above = await send(alice, "PATCH", `${REST_ROUTES.people}/${carolId}`, {
      managerId: daveId,
    });
    expect(above.status, await above.clone().text()).toBe(200);
    // Listed again, Bob has the person's own decision back; it climbs no line to Carol.
    const relisted = await send(alice, "POST", projectPath("vault", "members"), {
      personId: bobId,
    });
    expect(relisted.status).toBe(201);
    expect((await get(bob, decisionPath(ours.id))).status).toBe(200);
    expect((await get(carol, decisionPath(ours.id))).status).toBe(404);
    expect(await refused(await get(carol, decisionFilePath(ours.id, ourFile.id)))).toEqual(
      notFound,
    );
    const reached = restReachedDecisionSchema.parse(
      await (await get(carol, decisionPath(forBob.id))).json(),
    );
    expect(reached.decision.plugin).toBe("leave");
    const byManager = await get(carol, decisionFilePath(forBob.id, picture.id));
    expect(byManager.status).toBe(200);
    expect(new Uint8Array(await byManager.arrayBuffer())).toEqual(PNG);
    expect((await bearer(carolsAgent, decisionFilePath(forBob.id, notes.id))).status).toBe(200);
    const davesAgent = await tokenOf(dave, "Dave's agent");
    const upTheLine = await bearer(davesAgent, decisionFilePath(forBob.id, notes.id));
    expect(upTheLine.status).toBe(200);
    expect(await upTheLine.text()).toBe("a\n");
    expect((await get(dave, decisionFilePath(forBob.id, picture.id))).status).toBe(200);
    // Still the decision's own files alone, and nothing of the project.
    expect(await refused(await bearer(davesAgent, decisionFilePath(forBob.id, secret.id)))).toEqual(
      notFound,
    );
    expect(await refused(await get(carol, decisionFilePath(own.id, secret.id)))).toEqual(notFound);
    expect((await bearer(davesAgent, projectPath("vault", "files", picture.id))).status).toBe(404);
  });
});
