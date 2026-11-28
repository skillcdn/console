// Holds listing/plugin, what the console is listed with in the directories of AI apps (ADR-0175),
// to what those directories take: the two manifests say the same, the words are within the
// directories' limits, the review cases are as many as a review asks for and name tools the pack's
// address has, and every file a manifest names is there. A directory's own validation, at its
// portal, is the last word; this keeps an edit from breaking what is known of it.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = "listing/plugin";
const ADDRESS = "https://skillcdn.ai/gh/skillcdn/console";
const TOOLS = ["browse_repo", "search_repo", "load_skill", "read_repo_file"];

const json = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const length = (text) => [...text].length;

const portable = json("plugin.json");
const claude = json(".claude-plugin/plugin.json");
const openai = portable.extensions["com.openai"];
const face = openai.interface;

test("the portable manifest holds the keys its schema allows and names itself as the schema asks", () => {
  const allowed = [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ];
  assert.deepEqual(
    Object.keys(portable).filter((key) => !allowed.includes(key)),
    [],
  );
  assert.equal(portable.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.match(portable.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(portable.name.length <= 64);
  assert.match(portable.version, /^\d+\.\d+\.\d+$/);
  assert.ok(length(portable.description) <= 1024);
  assert.ok(portable.keywords.length <= 25);
  assert.deepEqual(
    Object.keys(portable.author).filter((key) => !["name", "email", "url"].includes(key)),
    [],
  );
});

test("the two manifests say the same of the plugin", () => {
  for (const key of [
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
  ]) {
    assert.deepEqual(claude[key], portable[key], key);
  }
  assert.equal(claude.displayName, face.displayName);
  assert.equal(claude.supportUrl, face.supportURL);
  assert.equal(claude.privacyPolicyUrl, face.privacyPolicyURL);
  assert.equal(claude.termsOfServiceUrl, face.termsOfServiceURL);
});

test("the words are within what the directories take", () => {
  assert.ok(length(face.displayName) <= 30, "the name, at most 30");
  assert.ok(length(face.shortDescription) <= 30, "the subtitle, at most 30");
  // 4,000 at one directory; 2,000 at the other, whose form is given the same text.
  assert.ok(length(face.longDescription) <= 2000, "the description, at most 2,000");
  assert.ok(length(face.developerName) <= 80);
  assert.ok(face.capabilities.length <= 20);
  for (const capability of face.capabilities) assert.ok(length(capability) <= 120, capability);
  assert.ok(face.defaultPrompt.length <= 3);
  assert.equal(new Set(face.defaultPrompt).size, face.defaultPrompt.length);
  for (const prompt of face.defaultPrompt) {
    assert.ok(length(prompt) <= 128, prompt);
    assert.ok(!prompt.includes("\n") && !prompt.includes("@"), prompt);
  }
  for (const [locale, words] of Object.entries(openai.publication.translations)) {
    assert.ok(length(words.subtitle) <= 30, `${locale}: the subtitle, at most 30`);
    assert.ok(length(words.description) <= 4000, `${locale}: the description`);
  }
  for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    assert.match(face[key], /^https:\/\/[^\s@]+$/, key);
  }
  for (const key of ["documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"]) {
    assert.match(claude[key], /^https:\/\/[^\s@]+$/, key);
  }
});

test("the words name no price and say that the plugin only reads", () => {
  const said = [
    face.displayName,
    face.shortDescription,
    face.longDescription,
    portable.description,
    ...face.capabilities,
    ...face.defaultPrompt,
  ].join("\n");
  assert.doesNotMatch(said, /\b(free|pricing|discount|trial|subscription plan)\b/i);
  assert.doesNotMatch(face.displayName, /\b(MCP|plugin|server|official)\b/i);
  assert.match(face.longDescription, /Read-only/);
  assert.match(face.longDescription, /does not connect to your board/);
});

test("a review is given five cases that pass and three that do not, each naming the pack's own tools", () => {
  const { positive, negative } = openai.review.test_cases;
  assert.equal(positive.length, 5);
  assert.equal(negative.length, 3);
  for (const one of positive) {
    assert.ok(one.description && one.prompt && one.expected_behavior, one.description);
    assert.ok(length(one.description) <= 4000);
    for (const tool of one.tools_triggered.split(",")) {
      assert.ok(TOOLS.includes(tool.trim()), `${one.description}: ${tool}`);
    }
  }
  for (const one of negative) assert.ok(one.description && one.prompt, one.description);
  assert.equal(openai.review.commerce, false);
});

test("both connections name the pack's address alone, each in its format's words", () => {
  const agentPlugins = json("mcp.json");
  assert.equal(agentPlugins.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(agentPlugins.mcpServers, {
    "skillcdn-console": { type: "streamable-http", url: ADDRESS },
  });
  assert.deepEqual(json(".mcp.json").mcpServers, {
    "skillcdn-console": { type: "http", url: ADDRESS },
  });
});

test("every file a manifest names is in the plugin, a picture as a PNG that is square", () => {
  const pictures = [face.composerIcon, face.logo, face.logoDark, claude.icon];
  for (const path of [...pictures, openai.onboardingSkill]) {
    assert.match(path, /^\.\//, path);
    assert.ok(existsSync(join(ROOT, path)), path);
  }
  for (const path of pictures) {
    const bytes = readFileSync(join(ROOT, path));
    assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", path);
    const width = bytes.readUInt32BE(16);
    assert.equal(width, bytes.readUInt32BE(20), `${path} is square`);
    assert.ok(width >= 48 && width <= 4096, path);
  }
});

test("each skill is named as its folder, and described within the format's bound", () => {
  const folders = readdirSync(join(ROOT, "skills"));
  assert.deepEqual(folders, ["get-started"]);
  for (const folder of folders) {
    const text = readFileSync(join(ROOT, "skills", folder, "SKILL.md"), "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
    assert.ok(front, `${folder}: front matter`);
    const keys = [...front[1].matchAll(/^([a-z-]+):/gm)].map((match) => match[1]);
    assert.deepEqual(
      keys.filter((key) => !["name", "description", "license"].includes(key)),
      [],
    );
    assert.equal(/^name: (.+)$/m.exec(front[1])?.[1], folder);
    const description = JSON.parse(/^description: (".*")$/m.exec(front[1])?.[1] ?? '""');
    assert.ok(description.length > 0 && length(description) <= 1024, `${folder}: description`);
    assert.ok(`${portable.name}:${folder}`.length <= 64);
    for (const tool of text.matchAll(/`([a-z]+_[a-z_]+)`/g)) {
      assert.ok(TOOLS.includes(tool[1]), `${folder} names the tool ${tool[1]}`);
    }
  }
});

test("the plugin's own page has the words a directory asks of it", () => {
  const page = readFileSync(join(ROOT, "README.md"), "utf8").replace(/```[\s\S]*?```/g, "");
  assert.ok(page.split(/\s+/).filter((word) => /\w/.test(word)).length >= 40);
  assert.ok(page.includes(ADDRESS));
});

test("the plugin is no part of the pack", () => {
  const manifest = readFileSync("SKILLCDN.md", "utf8").replace(/\r\n/g, "\n");
  assert.match(manifest, /^exclude:\n(?: {2}- .+\n)*? {2}- listing\n/m);
});
