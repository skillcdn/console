// The secrets file of a run (the shape of assets/secrets.example.json), kept outside any
// repository, and the parameter store: values go in from standard input or from a command's
// answer, and out into parameters, without ever passing through a command line or the output.
//
//   node store-secrets.mjs set <file> <NAME>                  the value is standard input
//   node store-secrets.mjs derive <file> <NAME> <template>    {{OTHER}} in the template is replaced
//   node store-secrets.mjs render <file> <in> <out>           a JSON file with {{NAME}} placeholders filled
//   node store-secrets.mjs key <file> <iam user>              creates an access key for the user and stores both halves
//   node store-secrets.mjs store <file> <prefix>              every value as a SecureString parameter <prefix>/<NAME>
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const [mode, file, ...rest] = process.argv.slice(2);
const usage = () => {
  process.stderr.write("usage: node store-secrets.mjs set|derive|render|key|store <file> ...\n");
  process.exit(2);
};
if (mode === undefined || file === undefined) {
  usage();
}

const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const write = (data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
const fill = (data, text) =>
  text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
    if (typeof data[name] !== "string") {
      throw new Error(`${name} is not in the secrets file`);
    }
    return data[name];
  });
/** Runs the AWS CLI with a request body in a temporary file, so that nothing is on the command line. */
const aws = (args, body) => {
  const directory = mkdtempSync(join(tmpdir(), "console-"));
  try {
    const request = join(directory, "request.json");
    writeFileSync(request, JSON.stringify(body), { mode: 0o600 });
    return execFileSync("aws", [...args, "--cli-input-json", `file://${request}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

switch (mode) {
  case "set": {
    const [name] = rest;
    if (name === undefined) {
      usage();
    }
    const value = readFileSync(0, "utf8").replace(/\r?\n$/, "");
    write({ ...read(), [name]: value });
    break;
  }
  case "derive": {
    const [name, template] = rest;
    if (name === undefined || template === undefined) {
      usage();
    }
    const data = read();
    write({ ...data, [name]: fill(data, template) });
    break;
  }
  case "render": {
    const [input, output] = rest;
    if (input === undefined || output === undefined) {
      usage();
    }
    writeFileSync(output, fill(read(), readFileSync(input, "utf8")), { mode: 0o600 });
    break;
  }
  case "key": {
    const [user] = rest;
    if (user === undefined) {
      usage();
    }
    const answer = JSON.parse(aws(["iam", "create-access-key"], { UserName: user }));
    write({
      ...read(),
      S3_ACCESS_KEY_ID: answer.AccessKey.AccessKeyId,
      S3_SECRET_ACCESS_KEY: answer.AccessKey.SecretAccessKey,
    });
    break;
  }
  case "store": {
    const [prefix] = rest;
    if (prefix === undefined) {
      usage();
    }
    const data = read();
    for (const [name, value] of Object.entries(data)) {
      // The password lives inside the URL; a value the person deferred is not a parameter.
      if (name === "_" || name === "DATABASE_PASSWORD" || value === "later") {
        continue;
      }
      const tier = Buffer.byteLength(value, "utf8") > 4000 ? "Advanced" : "Standard";
      aws(["ssm", "put-parameter"], {
        Name: `${prefix}/${name}`,
        Type: "SecureString",
        Value: value,
        Tier: tier,
        Overwrite: true,
      });
      process.stdout.write(`${prefix}/${name} stored (${tier})\n`);
    }
    break;
  }
  default:
    usage();
}
