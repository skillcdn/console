import { KEEPER_VARIABLE, type Service, type ServiceCommand, type ServiceInput } from "./types.js";

// The service that keeps a runner running on Windows (ADR-0085): a scheduled task of the agent's
// own OS account, registered by that account and started when it logs on. It needs no
// administrator's rights, and so it runs while the account is logged on at the machine: a task
// that runs with nobody logged on is refused to an account that registers it for itself, and
// that the account is logged on when the machine starts is for whoever prepares the machine.
// The system starts a task once and in a window, gives it the account's environment and not the
// one the machine was set up in, keeps none of its words, and ends it by ending the one process
// it started: so what the task starts is a few lines of the system's own shell, in no window,
// which start the runner with the setup's `PATH`, keep its lines, start it again when it ends
// and tell it which process keeps it. Written from the system's own documentation, the Task
// Scheduler's schema and schtasks, and run on Windows 11; the module says what to write and what
// to run, and whoever sets the machine up does it.

/** What the task is called before the name of its OS account: tasks are the machine's, one list for every account. */
export const TASK_NAME = "SkillCDN Console Runner";

/** How long the runner stays ended before it is started again, in seconds. */
const RESTART_SECONDS = 10;

/** The most a task's command line carries, with room left for the shell's own path. */
const MAX_COMMAND = 30_000;

/** What a task's name, and so the name of an OS account in it, cannot hold. */
const UNNAMEABLE = /[\\/:*?"<>|]/;

/** The name of the task of one OS account. */
export const taskNameOf = (user: string): string => `${TASK_NAME} (${user})`;

/** A text on one line, without what no line of the system's holds. */
const plain = (text: string): string =>
  [...text.replaceAll(/[\r\n]+/g, " ")]
    .filter((sign) => (sign.codePointAt(0) ?? 0) >= 0x20)
    .join("");

/**
 * A text inside the definition's XML, in the letters every encoding shares: the system reads a
 * definition that names no encoding in the machine's own, so a letter beyond them is written by
 * its number.
 */
const escaped = (text: string): string =>
  [...text]
    .map((sign) => {
      const point = sign.codePointAt(0) ?? 0;
      if (sign === "&") {
        return "&amp;";
      }
      if (sign === "<") {
        return "&lt;";
      }
      if (sign === ">") {
        return "&gt;";
      }
      return point > 0x7e ? `&#x${point.toString(16).toUpperCase()};` : sign;
    })
    .join("");

/** The signs the shell reads as the quote of a word said as it is: the plain one, and the four curled ones. */
const QUOTES: ReadonlySet<string> = new Set([
  "'",
  ...[0x2018, 0x2019, 0x201a, 0x201b].map((point) => String.fromCodePoint(point)),
]);

/** A stretch of a word as it is: quoted whole, and every sign the shell reads as that quote said twice. */
const quoted = (text: string): string =>
  `'${[...text].map((sign) => (QUOTES.has(sign) ? `${sign}${sign}` : sign)).join("")}'`;

/**
 * A word of the shell's as it is, whatever it holds. The system fills in a variable named
 * between two percent signs before the shell reads the line, so a percent sign is never
 * written: the shell puts it there, by its number.
 */
const word = (text: string): string => {
  const parts = plain(text).split("%").map(quoted);
  return parts.length === 1 ? (parts[0] ?? "''") : `(${parts.join(" + [char]37 + ")})`;
};

/**
 * What the task starts, in the system's own shell and on one line: the runner in the desk with
 * the `PATH` the machine was set up with, its lines added to the log as they come, and the
 * runner again ten seconds after it ends, for as long as the task runs. The system ends a task
 * by ending this shell and nothing the shell started, so the runner is told which process keeps
 * it and ends when that one does, and a runner that was left all the same is ended before
 * another is started: one runner for the account.
 */
export function taskScript(input: ServiceInput, log: string): string {
  const [runner = "", ...words] = input.program;
  // A line is added to the log and the log is let go of, so that it is read while the runner runs.
  const kept = "[IO.File]::AppendAllText($log, [string]$_ + [Environment]::NewLine)";
  return [
    // A line the runner writes of an error is a line, and what it writes is read as it wrote it.
    "$ErrorActionPreference = 'Continue'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `$log = ${word(log)}`,
    `$runner = ${word(runner)}`,
    `$words = @(${words.map(word).join(", ")})`,
    // A runner left behind is the same program, started with the same words to their end as
    // this shell hands them on, a word with a space in it between quotes: it goes, with what
    // it started.
    "$tail = ' ' + (($words | ForEach-Object { if ($_ -match ' ') { [char]34 + $_ + [char]34 } else { $_ } }) -join ' ')",
    "foreach ($left in @(Get-CimInstance Win32_Process)) { if ($left.ExecutablePath -eq $runner -and $left.CommandLine -and $left.CommandLine.EndsWith($tail, [StringComparison]::OrdinalIgnoreCase)) { & taskkill.exe /F /T /PID $left.ProcessId 2>&1 | Out-Null } }",
    // The product, and what the agent runs, are found where they were when the machine was set up.
    ...(input.path === undefined ? [] : [`$env:PATH = ${word(input.path)}`]),
    `$env:${KEEPER_VARIABLE} = [string]$PID`,
    // The runner is started in the desk or not at all: a desk that is gone is a line of the log.
    `try { Set-Location -LiteralPath ${word(input.desk)} -ErrorAction Stop } catch { ${kept}; exit 1 }`,
    `while ($true) { & $runner @words 2>&1 | ForEach-Object { ${kept} }; Start-Sleep -Seconds ${RESTART_SECONDS} }`,
  ].join("; ");
}

/** The definition of the task: started when the account logs on, in no window, for as long as it runs. */
export function taskDefinition(input: ServiceInput, log: string): string {
  return [
    '<?xml version="1.0"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    "    <Description>The runner of an agent account of the SkillCDN Console</Description>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${escaped(plain(input.user ?? ""))}</UserId>`,
    "    </LogonTrigger>",
    "  </Triggers>",
    // The account that registers the task is the one it runs as: none is named, and none other can be.
    "  <Principals>",
    '    <Principal id="Author">',
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    // One runner for the account: a second start, while it runs, starts nothing.
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    // A task is ended after three days, and on a battery, unless it says otherwise.
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    // A task runs below everything else unless it says otherwise: the agent's work is no background work.
    "    <Priority>5</Priority>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    "      <Command>%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe</Command>",
    `      <Arguments>${escaped(`-NoProfile -NonInteractive -WindowStyle Hidden -Command "${taskScript(input, log)}"`)}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

export const taskScheduler: Service = {
  name: "task-scheduler",
  platforms: ["win32"],
  plan(input) {
    const user = input.user === undefined ? "" : plain(input.user).trim();
    if (user.length === 0 || UNNAMEABLE.test(user)) {
      return { problem: "the system does not say the name of this OS account" };
    }
    if (input.program.length === 0) {
      return { problem: "nothing says how the runner is started" };
    }
    const folder = `${input.home.replace(/[\\/]+$/, "")}\\AppData\\Local\\skillcdn-console`;
    const definition = `${folder}\\runner-task.xml`;
    const log = `${folder}\\runner.log`;
    const named: ServiceInput = { ...input, user };
    const script = taskScript(named, log);
    // The line is one word of a command line, between the one quote that ends it.
    if (script.includes('"')) {
      return {
        problem: "a path or a name holds a quote, which a task's command line does not carry",
      };
    }
    if (script.length > MAX_COMMAND) {
      return { problem: "what starts the runner is longer than a task's command line carries" };
    }
    const name = taskNameOf(user);
    const own = (...args: readonly string[]): ServiceCommand => ({ command: "schtasks", args });
    const register = own("/Create", "/TN", name, "/XML", definition, "/F");
    return {
      files: [{ path: definition, text: taskDefinition(named, log), mode: 0o644 }],
      commands: [
        // The task is registered, in place of the one that was there; the one that runs is
        // ended, and its runner with it; and it is started now, with what was written.
        register,
        { ...own("/End", "/TN", name), mayFail: true },
        own("/Run", "/TN", name),
      ],
      // A definition written again is not the task until it is registered again: registering it
      // ends nothing that runs.
      reread: [register],
      log,
      failing:
        "A scheduled task is registered by the OS account it runs as, and starts when that account logs on: run this as the agent's own OS account, logged on at the machine, and see that the machine lets an account register a task of its own.",
      reload:
        "when the task is next started: when the OS account next logs on, or once the task is ended and run again.",
    };
  },
};
