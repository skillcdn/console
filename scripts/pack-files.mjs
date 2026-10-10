// What the published package carries beside its code, while every file has one source in the
// repository: the license (ADR-0003, ADR-0007), and the console's skills with their manifest and
// the specifications they point to (ADR-0015). `prepack` copies them next to what is packed,
// and `postpack` takes the copies out again; .gitignore keeps them out of git meanwhile.
// Package scripts run in the package's directory, two levels below the root.
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/** What is copied from the repository's root, and where it lands in the package. */
const COPIES = [
  ["LICENSE.md", "LICENSE.md"],
  ["SKILLCDN.md", "SKILLCDN.md"],
  ["skills", "skills"],
  ["docs/specs", "docs/specs"],
];
/** What `remove` takes out: the copies, and the directory made for the specifications. */
const REMOVALS = ["LICENSE.md", "SKILLCDN.md", "skills", "docs"];

const action = process.argv[2];
if (action === "copy") {
  for (const [from, to] of COPIES) {
    cpSync(resolve("..", "..", from), to, { recursive: true });
  }
} else if (action === "remove") {
  for (const made of REMOVALS) {
    rmSync(made, { recursive: true, force: true });
  }
} else {
  process.stderr.write("usage: node ../../scripts/pack-files.mjs copy|remove\n");
  process.exit(64);
}
