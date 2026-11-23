import { describe, expect, it } from "vitest";
import { parseRunnerConfig } from "./config.js";
import { cutShown, cutShownEnd, formsOf, MAX_CUT_WINDOW, redactorOf, WITHHELD } from "./redact.js";
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

  it("cuts a text after its values are out, so that no part of one stands at the cut, however short or however shaped", () => {
    const mark = String.fromCodePoint(0x2026);
    const value = "not-a-real-token-4f9a2c71";
    const hex = "9f2c41d07ab35e68c1d2e3f405162738";
    // Built from parts, so that nothing here is shaped like a key in the repository's history.
    const lines = ["aGVsbG8gd29ybGQgdGhpcyBpcyBub3Q", "YSByZWFsIGtleSBhdCBhbGwganVzdCBh"];
    const key = [`-----BEGIN ${"TEST"} KEY-----`, ...lines, `-----END ${"TEST"} KEY-----`].join(
      "\n",
    );
    const redact = redactorOf([value, hex, key]);
    // The cut falls inside the value at every place: one, two or three characters in, which
    // the look at a cut text's end leaves, and deeper. Nothing of the value is shown.
    for (const [name, secret] of [
      ["a token", value],
      ["a hexadecimal value", hex],
      ["a line of a key", lines[1] ?? ""],
    ] as const) {
      for (let into = 1; into < secret.length; into += 1) {
        const before = "x".repeat(40 - into);
        const out = cutShown(redact, `${before}${secret} and what follows it`, 40);
        // What the text is with the value out, to the length; whole where that is within it.
        const without = `${before}${WITHHELD} and what follows it`;
        expect(out, `${name}, ${into} in`).toBe(
          without.length > 40 ? `${without.slice(0, 40)}${mark}` : without,
        );
        for (let length = 1; length <= into; length += 1) {
          expect(out.includes(`x${secret.slice(0, length)}`), `${name}, ${into} in`).toBe(false);
        }
      }
    }
    // Base64 printed a line at a time, cut in its second line: neither line is shown.
    const printed = `key:\n${lines[0]}\n${lines[1]}\nend`;
    const shown = cutShown(redact, printed, 5 + (lines[0] ?? "").length + 1 + 3);
    // Within the length once the lines are out: shown whole, with no mark of a cut.
    expect(shown).toBe(`key:\n${WITHHELD}\n${WITHHELD}\nend`);
    expect(shown).not.toContain("YSB");
    // What is shown is what the whole text would show to that length: the cut is after the taking out.
    const text = `a ${value} b ${hex} c ${"z".repeat(100)}`;
    expect(cutShown(redact, text, 30)).toBe(`${redact(text).slice(0, 30)}${mark}`);
    // A text within the length comes through as it is, and one with nothing to look for is cut as it is.
    expect(cutShown(redact, "short", 40)).toBe("short");
    expect(cutShown(redactorOf([]), "0123456789", 4)).toBe(`0123${mark}`);
  });

  it("looks through the beginning of a long text alone, and shows nothing of an end it did not read", () => {
    const mark = String.fromCodePoint(0x2026);
    const value = "not-a-real-token-4f9a2c71";
    const inner = redactorOf([value]);
    let read = 0;
    const counting = Object.assign(
      (text: string) => {
        read += text.length;
        return inner(text);
      },
      { longest: inner.longest },
    );
    // A megabyte of a tool's input for a line of four thousand: the cut and one form beyond it are read.
    const long = `${"y".repeat(3990)}${value}${"z".repeat(1024 * 1024)}`;
    expect(cutShown(counting, long, 4000)).toBe(`${"y".repeat(3990)}${WITHHELD}${mark}`);
    expect(read).toBeLessThan(16 * 1024);
    // Values from end to end leave little to show: more is read, to a bound, and what is shown is short.
    read = 0;
    const all = value.repeat(100_000);
    const out = cutShown(counting, all, 4000);
    expect(out.endsWith(mark)).toBe(true);
    expect(out.replaceAll(WITHHELD, "").replace(mark, "")).toBe("");
    expect(read).toBeLessThanOrEqual(2 * MAX_CUT_WINDOW);
    // A text handed over cut already may end inside a value: its last characters are not shown.
    const handed = `${"y".repeat(60)}${value.slice(0, 12)}`;
    expect(cutShown(inner, handed, 64)).toBe(`${handed.slice(0, 64)}${mark}`);
    expect(cutShown(inner, handed, 64, true)).not.toContain(value.slice(0, 4));
    expect(cutShown(inner, handed, 200, true)).not.toContain(value.slice(0, 4));
    expect(cutShown(inner, handed, 200)).toBe(handed);
  });

  it("keeps the end of a text after its values are out, so that no part of one stands where its beginning was cut", () => {
    const mark = String.fromCodePoint(0x2026);
    const value = "not-a-real-token-4f9a2c71";
    const hex = "9f2c41d07ab35e68c1d2e3f405162738";
    const redact = redactorOf([value, hex]);
    // The cut falls inside the value at every place, from its first character to its last:
    // nothing of the value is shown, not even its last character before the rest.
    for (const [name, secret] of [
      ["a token", value],
      ["a hexadecimal value", hex],
    ] as const) {
      for (let into = 1; into < secret.length; into += 1) {
        const after = "x".repeat(40 - (secret.length - into));
        const out = cutShownEnd(redact, `what came before it ${secret}${after}`, 40);
        const without = `what came before it ${WITHHELD}${after}`;
        expect(out, `${name}, ${into} in`).toBe(
          without.length > 40 ? `${mark}${without.slice(without.length - 40)}` : without,
        );
        for (let length = 1; length <= secret.length - into; length += 1) {
          expect(out.includes(`${secret.slice(-length)}x`), `${name}, ${into} in`).toBe(false);
        }
      }
    }
    // What is shown is what the whole text would show of its end: the cut is after the taking out.
    const text = `${"z".repeat(100)} a ${value} b ${hex} c`;
    expect(cutShownEnd(redact, text, 30)).toBe(`${mark}${redact(text).slice(-30)}`);
    // A text within the length comes through as it is, and one with nothing to look for is cut as it is.
    expect(cutShownEnd(redact, "short", 40)).toBe("short");
    expect(cutShownEnd(redactorOf([]), "0123456789", 4)).toBe(`${mark}6789`);
    // A text handed over as the end of a longer one may begin inside a value: its first
    // characters are not shown, however short the text, and nothing of a value's end is.
    const handed = `${value.slice(-12)}${"y".repeat(60)}`;
    expect(cutShownEnd(redact, handed, 200, true)).not.toContain(value.slice(-4));
    expect(cutShownEnd(redact, handed, 64, true)).not.toContain(value.slice(-4));
    expect(cutShownEnd(redact, handed, 200, true).startsWith(mark)).toBe(true);
    expect(cutShownEnd(redactorOf([]), "6789", 10, true)).toBe(`${mark}6789`);
    expect(cutShownEnd(redact, handed, 200)).toBe(handed);
  });

  it("looks through the end of a long text alone when it keeps its end", () => {
    const mark = String.fromCodePoint(0x2026);
    const value = "not-a-real-token-4f9a2c71";
    const inner = redactorOf([value]);
    let read = 0;
    const counting = Object.assign(
      (text: string) => {
        read += text.length;
        return inner(text);
      },
      { longest: inner.longest },
    );
    const long = `${"z".repeat(1024 * 1024)}${value}${"y".repeat(3990)}`;
    expect(cutShownEnd(counting, long, 4000)).toBe(`${mark}${WITHHELD}${"y".repeat(3990)}`);
    expect(read).toBeLessThan(16 * 1024);
    read = 0;
    const out = cutShownEnd(counting, value.repeat(100_000), 4000);
    expect(out.startsWith(mark)).toBe(true);
    expect(out.replace(mark, "").replaceAll(WITHHELD, "")).toBe("");
    expect(read).toBeLessThanOrEqual(2 * MAX_CUT_WINDOW);
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
    // The channels the agent listens to are named by the messenger's ids for them.
    expect(parseRunnerConfig(JSON.stringify({ channels: ["C0OPS", "G0PLAN"] }))).toMatchObject({
      ok: true,
      config: { channels: ["C0OPS", "G0PLAN"] },
    });
    // The browser is a name of a short list (ADR-0149): a Chrome with no window, or the
    // product's own tool in one with a window, as a desk of before names it. Anything else is
    // no browser, and never words for a product's command line.
    for (const browser of ["headless", "chrome"]) {
      expect(parseRunnerConfig(JSON.stringify({ browser }))).toMatchObject({
        ok: true,
        config: { browser },
      });
    }
    expect(parseRunnerConfig(JSON.stringify({ browser: "--chrome" })).ok).toBe(false);
    expect(parseRunnerConfig(JSON.stringify({ browser: "firefox" })).ok).toBe(false);
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
      [JSON.stringify({ channels: "C0OPS" }), "channels"],
      [JSON.stringify({ channels: ["#ops"] }), "channels"],
      [JSON.stringify({ channels: ["C0OPS\nC0ELSE"] }), "channels"],
      [JSON.stringify({ channels: Array.from({ length: 51 }, () => "C0OPS") }), "channels"],
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
