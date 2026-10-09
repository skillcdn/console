import process from "node:process";
import { ROLES, selectRole } from "./roles.js";

// The one entry point of the image: the first argument selects the role (ADR-0002). No role does
// anything yet; each arrives with its milestone (docs/roadmap.md). Until then the process says so
// and exits with the codes the image will keep: 64 for a usage error, 70 for something it cannot do.
const EXIT_USAGE = 64;
const EXIT_NOT_IMPLEMENTED = 70;

const selection = selectRole(process.argv.slice(2));
if (selection.ok) {
  process.stderr.write(`console: the ${selection.role} role is not implemented yet\n`);
  process.exitCode = EXIT_NOT_IMPLEMENTED;
} else {
  process.stderr.write(`usage: console <${ROLES.join("|")}>\n`);
  process.exitCode = EXIT_USAGE;
}
