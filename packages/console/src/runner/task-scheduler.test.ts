import { describe, expect, it } from "vitest";
import { ownRunnerModules } from "./modules.js";
import {
  TASK_NAME,
  taskDefinition,
  taskNameOf,
  taskScheduler,
  taskScript,
} from "./task-scheduler.js";
import type { ServiceInput } from "./types.js";

// The service that keeps a runner running on Windows: what it says to write and to run. Nothing
// is written and nothing is run here, and whether the system takes the task is seen on a machine.

const BACK = String.fromCodePoint(0x5c);
const at = (...parts: readonly string[]): string => parts.join(BACK);

const HOME = at("C:", "Users", "mira");
const DESK = at(HOME, "desk");
const NODE = at("C:", "Program Files", "nodejs", "node.exe");
const MAIN = at(
  HOME,
  "AppData",
  "Roaming",
  "npm",
  "node_modules",
  "@skillcdn",
  "console",
  "dist",
  "cli",
  "main.js",
);
const INPUT: ServiceInput = {
  desk: DESK,
  home: HOME,
  uid: undefined,
  user: "mira",
  program: [
    NODE,
    MAIN,
    "runner",
    "--url",
    "https://console.acme.example",
    "--account",
    "mira@acme.example",
  ],
  path: `${at("C:", "Program Files", "nodejs")};${at("C:", "Windows", "System32")}`,
};
const FOLDER = at(HOME, "AppData", "Local", "skillcdn-console");
const DEFINITION = at(FOLDER, "runner-task.xml");
const LOG = at(FOLDER, "runner.log");
const NAME = "SkillCDN Console Runner (mira)";

/** What the definition has the system's shell run: the one word after `-Command`. */
function scriptIn(definition: string): string {
  const line = definition.split("\r\n").find((one) => one.includes("<Arguments>")) ?? "";
  const text = line
    .replace(/^\s*<Arguments>/, "")
    .replace(/<\/Arguments>$/, "")
    .replaceAll(/&#x([0-9A-F]+);/g, (_, point: string) =>
      String.fromCodePoint(Number.parseInt(point, 16)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  const opened = text.indexOf('"');
  return text.slice(opened + 1, text.lastIndexOf('"'));
}

describe("the task-scheduler service", () => {
  it("is the package's service for Windows, beside the two others", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.services.names()).toEqual(["launchd", "systemd-user", "task-scheduler"]);
    expect(modules.services.get("task-scheduler")?.platforms).toEqual(["win32"]);
    // A task is the machine's, in one list for every account: it is called by whose it is.
    expect(TASK_NAME).toBe("SkillCDN Console Runner");
    expect(taskNameOf("mira")).toBe(NAME);
  });

  it("plans a task of the OS account's own: its definition in the account's folder, registered, and started now", () => {
    const plan = taskScheduler.plan(INPUT);
    if ("problem" in plan) {
      throw new Error(plan.problem);
    }
    expect(plan.files.map((file) => [file.path, file.mode])).toEqual([[DEFINITION, 0o644]]);
    const register = {
      command: "schtasks",
      args: ["/Create", "/TN", NAME, "/XML", DEFINITION, "/F"],
    };
    expect(plan.commands).toEqual([
      register,
      { command: "schtasks", args: ["/End", "/TN", NAME], mayFail: true },
      { command: "schtasks", args: ["/Run", "/TN", NAME] },
    ]);
    // Nothing of it needs an administrator's rights: every command is the scheduler's own, about
    // the account's own task, and no file is outside the account's home.
    expect(
      plan.commands.every((step) => step.command === "schtasks" && step.args[2] === NAME),
    ).toBe(true);
    expect(plan.files.every((file) => file.path.startsWith(`${HOME}${BACK}`))).toBe(true);
    // A definition written again is the task once it is registered again, which ends nothing.
    expect(plan.reread).toEqual([register]);
    expect(plan.log).toBe(LOG);
    expect(plan.failing).toContain("registered by the OS account it runs as");
    expect(plan.reload).toBe(
      "when the task is next started: when the OS account next logs on, or once the task is ended and run again.",
    );
    // A home said with its last separator is the same home.
    const slashed = taskScheduler.plan({ ...INPUT, home: `${HOME}${BACK}` });
    expect("problem" in slashed ? [] : slashed.files.map((file) => file.path)).toEqual([
      DEFINITION,
    ]);
  });

  it("defines a task that starts when the account logs on, as that account, with none of a task's limits", () => {
    const definition = taskDefinition(INPUT, LOG);
    const lines = definition.split("\r\n");
    // The system reads a definition that names no encoding in the machine's own: it names none,
    // and holds no letter beyond the ones every encoding shares.
    expect(lines[0]).toBe('<?xml version="1.0"?>');
    expect([...definition].every((sign) => (sign.codePointAt(0) ?? 0) < 0x7f)).toBe(true);
    expect(definition.endsWith("</Task>\r\n")).toBe(true);
    // When the account logs on, and as the account that registers it: none is named to run as.
    expect(definition).toContain(
      [
        "    <LogonTrigger>",
        "      <Enabled>true</Enabled>",
        "      <UserId>mira</UserId>",
        "    </LogonTrigger>",
      ].join("\r\n"),
    );
    expect(definition).toContain(
      [
        '    <Principal id="Author">',
        "      <LogonType>InteractiveToken</LogonType>",
        "      <RunLevel>LeastPrivilege</RunLevel>",
        "    </Principal>",
      ].join("\r\n"),
    );
    // A task is ended after three days, kept from a battery and run below everything else
    // unless it says otherwise, and a second start while it runs starts nothing.
    for (const setting of [
      "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
      "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
      "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
      "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
      "<Priority>5</Priority>",
    ]) {
      expect(lines).toContain(`    ${setting}`);
    }
    // What it starts is the system's own shell, in no window, with one word to run.
    expect(lines).toContain(
      `      <Command>%SystemRoot%${at("", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")}</Command>`,
    );
    const action = lines.find((line) => line.includes("<Arguments>")) ?? "";
    expect(action).toContain(
      '<Arguments>-NoProfile -NonInteractive -WindowStyle Hidden -Command "',
    );
    expect(action.endsWith('"</Arguments>')).toBe(true);
    expect(scriptIn(definition)).toBe(taskScript(INPUT, LOG));
  });

  it("has the shell start the runner in the desk, keep its lines, start it again when it ends, and leave no second one", () => {
    const script = taskScript(INPUT, LOG);
    expect(script.split("; ")).toEqual([
      "$ErrorActionPreference = 'Continue'",
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
      `$log = '${LOG}'`,
      `$runner = '${NODE}'`,
      `$words = @('${MAIN}', 'runner', '--url', 'https://console.acme.example', '--account', 'mira@acme.example')`,
      // A runner left by a task that was ended: the same program, started with the same words
      // to their end, and no other account's, whose words end otherwise.
      "$tail = ' ' + (($words | ForEach-Object { if ($_ -match ' ') { [char]34 + $_ + [char]34 } else { $_ } }) -join ' ')",
      "foreach ($left in @(Get-CimInstance Win32_Process)) { if ($left.ExecutablePath -eq $runner -and $left.CommandLine -and $left.CommandLine.EndsWith($tail, [StringComparison]::OrdinalIgnoreCase)) { & taskkill.exe /F /T /PID $left.ProcessId 2>&1 | Out-Null } }",
      // The PATH the machine was set up with, and the process that keeps the runner, by number.
      `$env:PATH = '${INPUT.path}'`,
      "$env:CONSOLE_RUNNER_KEEPER = [string]$PID",
      // In the desk or not at all.
      `try { Set-Location -LiteralPath '${DESK}' -ErrorAction Stop } catch { [IO.File]::AppendAllText($log, [string]$_ + [Environment]::NewLine)`,
      "exit 1 }",
      "while ($true) { & $runner @words 2>&1 | ForEach-Object { [IO.File]::AppendAllText($log, [string]$_ + [Environment]::NewLine) }",
      "Start-Sleep -Seconds 10 }",
    ]);
    // One word of a command line: no quote of that line is in it.
    expect(script).not.toContain('"');
    expect(taskScript({ ...INPUT, path: undefined }, LOG)).not.toContain("$env:PATH");
  });

  it("writes what a path or a login holds as words of the shell and as text of the definition", () => {
    const curled = String.fromCodePoint(0x2019);
    const korean = String.fromCodePoint(0xcc45, 0xc0c1);
    const hostile: ServiceInput = {
      ...INPUT,
      desk: at("D:", `O'Brien${curled}s <desk> & %TEMP% $(x) ${korean}`),
      program: [NODE, "runner", "--account", "a'; Remove-Item x; '\r\nb"],
      path: at("C:", "50%"),
    };
    const script = taskScript(hostile, LOG);
    // A quote the shell reads as the end of a word is said twice, the curled one as the plain
    // one; and a percent sign, which the system would fill a variable in at, is never written.
    expect(script).toContain(
      `Set-Location -LiteralPath ('D:${BACK}O''Brien${curled}${curled}s <desk> & ' + [char]37 + 'TEMP' + [char]37 + ' $(x) ${korean}') -ErrorAction Stop`,
    );
    expect(script).toContain("$words = @('runner', '--account', 'a''; Remove-Item x; '' b')");
    expect(script).toContain(`$env:PATH = ('C:${BACK}50' + [char]37 + '')`);
    expect(script).not.toContain("%");
    expect(script).not.toMatch(/[\r\n]/);
    // In the definition, what the XML would read is said as itself, and a letter beyond the
    // shared ones by its number.
    const definition = taskDefinition(hostile, LOG);
    expect(definition).toContain("&lt;desk&gt; &amp; ");
    expect(definition).toContain("&#x2019;&#x2019;s");
    expect(definition).toContain("&#xCC45;&#xC0C1;");
    expect([...definition].every((sign) => (sign.codePointAt(0) ?? 0) < 0x7f)).toBe(true);
    expect(scriptIn(definition)).toBe(script);
    expect(
      taskDefinition({ ...INPUT, user: `${String.fromCodePoint(0xbbf8, 0xb77c)} & <co>` }, LOG),
    ).toContain("<UserId>&#xBBF8;&#xB77C; &amp; &lt;co&gt;</UserId>");
  });

  it("says why it cannot plan: an account without a name a task can carry, no program, a quote, or too long a line", () => {
    const unnamed = { problem: "the system does not say the name of this OS account" };
    expect(taskScheduler.plan({ ...INPUT, user: undefined })).toEqual(unnamed);
    expect(taskScheduler.plan({ ...INPUT, user: "  " })).toEqual(unnamed);
    expect(taskScheduler.plan({ ...INPUT, user: at("ACME", "mira") })).toEqual(unnamed);
    expect(taskScheduler.plan({ ...INPUT, program: [] })).toEqual({
      problem: "nothing says how the runner is started",
    });
    expect(taskScheduler.plan({ ...INPUT, desk: at("D:", 'a "desk"') })).toEqual({
      problem: "a path or a name holds a quote, which a task's command line does not carry",
    });
    expect(taskScheduler.plan({ ...INPUT, path: "x;".repeat(16_000) })).toEqual({
      problem: "what starts the runner is longer than a task's command line carries",
    });
    // A name with a space in it is a name: the task is called by it, and the trigger names it.
    const spaced = taskScheduler.plan({ ...INPUT, user: " Mira Kim " });
    expect("problem" in spaced ? [] : spaced.commands[0]?.args.slice(0, 3)).toEqual([
      "/Create",
      "/TN",
      "SkillCDN Console Runner (Mira Kim)",
    ]);
    expect("problem" in spaced ? "" : spaced.files[0]?.text).toContain("<UserId>Mira Kim</UserId>");
  });
});
