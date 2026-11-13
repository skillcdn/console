import { describe, expect, it } from "vitest";
import { parseRunnerConfig } from "./config.js";
import { formsOf, redactorOf, WITHHELD } from "./redact.js";
import { createRegistry } from "./registry.js";

// Invented values, shaped like nothing real: a token, a password with characters that encode.
const TOKEN = "not-a-real-token-4f9a2c71";
const PASSWORD = "p@ss word/with+signs&more";

describe("taking the secrets out of an event", () => {
  it("takes a value out as it is, and as JSON, a URL and a form spell it", () => {
    const redact = redactorOf([PASSWORD, TOKEN]);
    expect(redact(`export TOKEN=${TOKEN}`)).toBe(`export TOKEN=${WITHHELD}`);
    expect(redact(JSON.stringify({ password: PASSWORD }))).toBe(`{"password":"${WITHHELD}"}`);
    expect(redact(`https://git.example/?p=${encodeURIComponent(PASSWORD)}`)).toBe(
      `https://git.example/?p=${WITHHELD}`,
    );
    expect(redact(`p=${new URLSearchParams([["", PASSWORD]]).toString().slice(1)}`)).toBe(
      `p=${WITHHELD}`,
    );
    expect(redact(encodeURIComponent(PASSWORD).toLowerCase())).not.toContain("word");
    // Every time it turns up, and nothing else of the text.
    expect(redact(`${TOKEN} then ${TOKEN}.`)).toBe(`${WITHHELD} then ${WITHHELD}.`);
    expect(redact("Nothing of it here.")).toBe("Nothing of it here.");
  });

  it("takes a value out of base64, whole and inside a longer run of it, in either alphabet", () => {
    const redact = redactorOf([TOKEN]);
    const whole = Buffer.from(TOKEN).toString("base64");
    expect(redact(`Authorization: Basic ${whole}`)).toBe(`Authorization: Basic ${WITHHELD}`);
    for (const before of ["x", "xy", "xyz", "mira:"]) {
      const carried = Buffer.from(`${before}${TOKEN}:after`).toString("base64");
      const out = redact(`curl -H "Authorization: Basic ${carried}"`);
      expect(out, before).toContain(WITHHELD);
      // What is left around it does not decode to the value.
      expect(Buffer.from(out.replace(WITHHELD, ""), "base64").toString()).not.toContain(
        TOKEN.slice(4, -4),
      );
      expect(redact(Buffer.from(`${before}${TOKEN}`).toString("base64url")), before).toContain(
        WITHHELD,
      );
    }
  });

  it("takes a key of several lines out a line at a time, as a tool prints one", () => {
    // Built from parts, so that nothing here is shaped like a key in the repository's history.
    const body = ["aGVsbG8gd29ybGQgdGhpcyBpcyBub3Q", "YSByZWFsIGtleSBhdCBhbGwganVzdCBh"];
    const key = [`-----BEGIN ${"TEST"} KEY-----`, ...body, `-----END ${"TEST"} KEY-----`].join(
      "\n",
    );
    const redact = redactorOf([key]);
    const printed = `1  ${body[0]}\n2  ${body[1]}\n`;
    expect(redact(printed)).toBe(`1  ${WITHHELD}\n2  ${WITHHELD}\n`);
    expect(redact(key)).toBe(WITHHELD);
    // The lines that say nothing of it are left where they are found alone.
    expect(redact("-----BEGIN TEST KEY-----")).toBe("-----BEGIN TEST KEY-----");
  });

  it("looks for nothing too short to tell from chance, and leaves a text as it is with nothing to look for", () => {
    expect(formsOf("abc")).toEqual([]);
    expect(redactorOf(["abc", "", "  "])("abc and more")).toBe("abc and more");
    expect(redactorOf([])("anything")).toBe("anything");
    // A short value is looked for as it is, and not in base64, where its letters are anyone's.
    const forms = formsOf("pin9");
    expect(forms).toContain("pin9");
    expect(forms).not.toContain(Buffer.from("pin9").toString("base64"));
  });

  it("takes out the beginning of a value at the end of a text a driver cut, and nothing of a text that ends in none", () => {
    const value = "not-a-real-token-4f9a2c71";
    const redact = redactorOf([value]);
    const cut = "\u2026";
    // A tool's input shown to a length, which ended inside the value.
    expect(redact(`{"header":"Authorization: Bearer not-a-real-tok${cut}`)).toBe(
      `{"header":"Authorization: Bearer ${WITHHELD}${cut}`,
    );
    // Inside base64 too: the beginning of the value as a longer run of it spells it.
    const run = Buffer.from(`mira:${value}`).toString("base64");
    expect(redact(`Basic ${run.slice(0, 24)}${cut}`)).not.toContain(run.slice(8, 24));
    // Four characters at the least, as a whole value is looked for by.
    expect(redact(`it does not${cut}`)).toBe(`it does not${cut}`);
    expect(redact(`it does not-${cut}`)).toBe(`it does ${WITHHELD}${cut}`);
    // A text that was not cut ends as it ends.
    expect(redact("it ends in not-a-real-tok")).toBe("it ends in not-a-real-tok");
    expect(redact(`nothing of it here${cut}`)).toBe(`nothing of it here${cut}`);
  });

  it("takes the longest form first, so that one value inside another leaves nothing of either", () => {
    const redact = redactorOf(["secret-part", "a-secret-part-and-more"]);
    expect(redact("x a-secret-part-and-more y secret-part z")).toBe(
      `x ${WITHHELD} y ${WITHHELD} z`,
    );
  });
});

describe("runner.json", () => {
  it("runs with the defaults where it says nothing", () => {
    expect(parseRunnerConfig("{}")).toEqual({
      ok: true,
      config: {
        driver: "claude",
        wake: ["console"],
        conversation: "continuous",
        secrets: { env: {}, files: {} },
        autosave: true,
      },
    });
  });

  it("names the driver, the wake sources, the conversation and the secrets a session is handed", () => {
    const read = parseRunnerConfig(
      JSON.stringify({
        driver: "claude",
        wake: ["console", "slack"],
        conversation: "daily",
        secrets: {
          env: { GIT_TOKEN: "git.token" },
          files: { ".netrc": "netrc", "ssh/id": "ssh.key" },
        },
        autosave: false,
      }),
    );
    // The permission mode is a word of the product's, for the driver to know or not.
    expect(parseRunnerConfig(JSON.stringify({ permissions: "dontAsk" }))).toMatchObject({
      ok: true,
      config: { permissions: "dontAsk" },
    });
    expect(read).toMatchObject({
      ok: true,
      config: {
        wake: ["console", "slack"],
        conversation: "daily",
        secrets: {
          env: { GIT_TOKEN: "git.token" },
          files: { ".netrc": "netrc", "ssh/id": "ssh.key" },
        },
        autosave: false,
      },
    });
  });

  it("is refused whole when it does not read: a path out of work/, a name that is none, too much", () => {
    for (const [config, word] of [
      ["{", "not readable JSON"],
      ['"claude"', "runner.json"],
      [JSON.stringify({ driver: "../claude" }), "driver"],
      [JSON.stringify({ driver: "Claude" }), "driver"],
      [JSON.stringify({ conversation: "hourly" }), "conversation"],
      [JSON.stringify({ secrets: { files: { "../.ssh/id": "ssh.key" } } }), "secrets.files"],
      [JSON.stringify({ secrets: { files: { "/etc/passwd": "ssh.key" } } }), "secrets.files"],
      [JSON.stringify({ secrets: { files: { "a/../../b": "ssh.key" } } }), "secrets.files"],
      [JSON.stringify({ secrets: { files: { "C:\\\\x": "ssh.key" } } }), "secrets.files"],
      [JSON.stringify({ secrets: { env: { "PATH=x; rm": "git.token" } } }), "secrets.env"],
      [JSON.stringify({ secrets: { env: { GIT_TOKEN: "Not A Name" } } }), "secrets.env"],
      [
        JSON.stringify({
          secrets: {
            env: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`V${index}`, "a.b"])),
          },
        }),
        "secrets.env",
      ],
      [JSON.stringify({ wake: Array.from({ length: 11 }, () => "console") }), "wake"],
      [JSON.stringify({ permissions: "--dangerously-skip-permissions" }), "permissions"],
      [JSON.stringify({ permissions: "auto --settings x.json" }), "permissions"],
      [JSON.stringify({ permissions: ["auto"] }), "permissions"],
      [`{"driver":"claude","pad":"${"x".repeat(70_000)}"}`, "larger"],
    ] as const) {
      const read = parseRunnerConfig(config);
      expect(read.ok, config.slice(0, 60)).toBe(false);
      expect(read.ok ? "" : read.problem, config.slice(0, 60)).toContain(word);
    }
  });
});

describe("a registry of the runner's modules", () => {
  it("keeps modules by name, and refuses a name taken or one that is no name", () => {
    const registry = createRegistry<{ readonly name: string }>("driver");
    registry.register("claude", { name: "claude" });
    registry.register("another", { name: "another" });
    expect(registry.get("claude")).toEqual({ name: "claude" });
    expect(registry.get("../claude")).toBeUndefined();
    expect(registry.names()).toEqual(["another", "claude"]);
    expect(() => registry.register("claude", { name: "again" })).toThrow("registered already");
    expect(() => registry.register("../x", { name: "x" })).toThrow("small letters");
  });
});
