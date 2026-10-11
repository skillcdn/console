// Writes the access key of a downloaded IAM key file into a profile of the AWS CLI's own
// credentials file, and deletes the key file. Neither value touches a command line, a message
// or the standard output. Usage: node import-aws-key.mjs <key file> <profile>
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const [file, profile = "console"] = process.argv.slice(2);
if (file === undefined) {
  process.stderr.write("usage: node import-aws-key.mjs <key file> <profile>\n");
  process.exit(2);
}
const [header, row] = readFileSync(file, "utf8").trim().split(/\r?\n/);
const names = (header ?? "").split(",").map((name) => name.trim().toLowerCase());
const values = (row ?? "").split(",").map((value) => value.trim());
const id = values[names.findIndex((name) => name.includes("access key id"))];
const secret = values[names.findIndex((name) => name.includes("secret access key"))];
if (id === undefined || secret === undefined || id.length === 0 || secret.length === 0) {
  process.stderr.write("the file does not look like a downloaded access key (.csv)\n");
  process.exit(1);
}
const directory = join(homedir(), ".aws");
mkdirSync(directory, { recursive: true });
const credentials = join(directory, "credentials");
const before = existsSync(credentials)
  ? readFileSync(credentials, "utf8").replace(new RegExp(`\\[${profile}\\][^[]*`), "")
  : "";
writeFileSync(
  credentials,
  `${before.trimEnd()}\n\n[${profile}]\naws_access_key_id = ${id}\naws_secret_access_key = ${secret}\n`.trimStart(),
  { mode: 0o600 },
);
unlinkSync(file);
process.stdout.write(`profile ${profile} written; ${file} deleted\n`);
