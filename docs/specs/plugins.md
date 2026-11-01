# Spec: plugins

- Status: **Being built.** The decisions are [ADR-0049](../adr/0049-a-plugin-is-an-npm-package-installed-into-the-image-and-enabled-by-an-administrator.md) to [ADR-0054](../adr/0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md), taken 2026-11-01; milestone 34 of the [roadmap](../roadmap.md) builds them in order, and says what is built: the contract in the package, the authoring command, the example, the host, the installs with their consent, settings, secrets and grants, their routes and the events, the records with their versions, links and files, the record routes, export and purge, `storage:sql` with its migrations, the command's own routes with `invoke`, the endpoints, a plugin's skills as a pack of its own, `console plugins` and `console plugin <key>`, the plugins named after the rules, the board through `ctx.console`, a plugin's own events, hooks, jobs, outbound requests and calls between plugins are; the pages are not yet. This document is the contract between a console and a plugin, and between the console and whoever installs or administers one. Until the milestone is done, where the code and this document differ, the code is behind.
- Where things live: the contract in `@skillcdn/console/plugin` (the manifest's schema, `definePlugin` and its definers, the types of `ctx`, the capabilities, the bounds and the refusals), `@skillcdn/console/plugin/web` (the bridge client) and `@skillcdn/console/plugin/testing` (a context for a plugin's own tests); the host, the record store, the policy and the routes in `apps/console/src/plugins/`; the authoring command `console-plugin` as a second `bin` of the package, with its template in the package's `template/plugin`; an example plugin in `examples/plugin-hello`; the skill `skills/building-a-plugin`. The console's own words, limits and refusals are in [rest.md](rest.md) and [cli.md](cli.md); this document adds the plugins'.

## Words

| Word | Meaning |
|---|---|
| plugin | One npm package that adds a feature to a console: commands and queries for agents, pages and widgets for people, records, jobs, hooks and skills; identified by its `key` |
| manifest | `console-plugin.json` at the package root: what the plugin is and asks, as data read without running anything |
| host | The console's child process that runs plugin code, one per `api` and `worker` role, with a thread per plugin |
| capability | Something a plugin asks of the console in its manifest and an administrator consents to when enabling it; the only way plugin code reaches the console |
| role | A name a plugin gives to what a person may do with it, granted by an administrator |
| board project | The project a plugin's decisions, tasks and documents go to, made or chosen when it is enabled |
| record, collection | A plugin's data, kept by the console: a collection is declared with a schema, a record is one document in it |
| command, query | Plugin code run as a person: a command writes, a query reads |
| endpoint | An inbound HTTP request a plugin accepts, by capability |
| hook, job | Plugin code the console runs itself: on an event, or on a schedule |
| frame, bridge | The sandboxed document a plugin's page runs in, and the messages between it and the console's page |
| widget | A small frame on the front page |

## The package

```
<package>/
  package.json              name, version, license, files (dist, skills, SKILLCDN.md); no install scripts
  console-plugin.json       the manifest
  dist/server/index.js      ESM; the default export is definePlugin({...})
  dist/web/index.js         ESM, self-contained, its assets beside it (index.css, images, fonts)
  migrations/0001-*.sql     with storage:sql only
  skills/<name>/SKILL.md    the skills, in the SkillCDN Format
  SKILLCDN.md               the manifest of the skills, as any pack has one
  README.md, LICENSE
```

- A plugin is installed with its lockfile and no install scripts, so everything it runs is in the package: the server module and the web bundle are built before publishing, or before the tag when it is installed from a git host (`github:<owner>/<repo>#<tag>`).
- `@skillcdn/console` is a `devDependency` of a plugin, for the types and the authoring command. Nothing of it is imported at runtime: the server module receives everything through `ctx`, and the web bundle bundles the bridge client.
- A plugin's name on the registry is its own; the console knows it by `key`.

## The manifest

| Field | Type | Rule |
|---|---|---|
| `key` | string | `^[a-z][a-z0-9-]{1,31}$`; unique in a console; not one of the reserved words below |
| `name`, `description` | `{ [language]: string }` | `en` required; a name up to 40 characters, a description up to 200 |
| `agentNote` | `{ [language]: string }` | one sentence for agents, up to 200 characters: what the plugin is for and when to use it; printed with the rules |
| `pluginApi` | integer | the major of the plugin API the plugin was written against; `1` |
| `server` | path | the server module, relative to the package root |
| `web` | path | the directory of the web bundle, with `index.js`; required where `pages` or `widgets` are declared |
| `skills` | path | the directory of the skills; `SKILLCDN.md` is then at the package root |
| `migrations` | path | the directory of SQL migrations; with `storage:sql` only |
| `capabilities` | string[] | from the catalogue below; `outbound:<host>` and `plugins:<key>` carry their parameter |
| `roles` | `{ [role]: { name, description } }` | role keys as `key`; up to 10; names and descriptions per language |
| `defaultRole` | string | a role every member of the workspace holds without a grant; optional |
| `requires` | `{ [key]: range }` | other plugins this one needs, by a semver range of their version; they are enabled first and cannot be disabled while this one is |
| `board` | `{ needs, defaults? }` | `needs` is `required`, `optional` or `none`; `defaults` the `key`, `name` and `description` per language of the project an administrator may make for it |
| `settings` | Setting[] | up to 50, each `{ key, type, name, description?, required?, default?, min?, max?, options?, of? }`; `key` a lowercase letter followed by letters and digits (`daysPerYear`), as code and `--set` name it; types `text`, `markdown`, `number`, `boolean`, `enum` (with `options`, each `{ value, name }`), `day`, `person`, `project`, `secret`, `list` (with `of`, any type but `secret` and `list`); `min` and `max` bound a number, the length of a text or the items of a list; `default` fits the type, and `person`, `project` and `secret` have none |
| `menu` | `{ group, order?, name? }` | the tab the plugin is under: a group of the console's (`people`, `customers`, `money`, `operations`, `marketing`, `engineering`, `reports`), or one the plugin declares with a `name` per language; `order` within the row, default 100 |
| `pages` | Page[] | up to 12, each `{ key, name, level, roles?, wide? }`; `level` is `workspace` or `project`; page keys as `key`, and not `frame`, `web` or `x` |
| `widgets` | Widget[] | up to 4, each `{ key, name, place, size, roles? }`; `place` is `home:top` or `home:bottom`; `size` is `third`, `half` or `full` |
| `dataVersion` | integer | the version of the plugin's record shapes, from 1; raised with an entry in `upgrades` |
| `store` | object | `homepage`, `repository`, `keywords`, `icon`; the license is `package.json`'s |

Reserved words, which no `key` may be: the console's own paths and commands (`api`, `auth`, `plugins`, `plugin`, `settings`, `people`, `person`, `projects`, `project`, `work`, `decisions`, `decision`, `agents`, `categories`, `category`, `pages`, `connect`, `docs`, `doc`, `tasks`, `task`, `runs`, `run`, `skills`, `skill`, `members`, `member`, `rules`, `goals`, `goal`, `feed`, `files`, `file`, `events`, `frame`, `web`, `console`, `skillcdn`, `runtime`, `new`, `me`, `help`, `records`, `enable`, `disable`, `grant`, `revoke`, `secret`, `export`, `purge`). The list is `RESERVED_PLUGIN_KEYS` in `@skillcdn/console/plugin`.

An example, a plugin for leave:

```json
{
  "key": "leave",
  "name": { "en": "Leave", "ko": "연차" },
  "description": { "en": "Leave requests, approvals and balances.", "ko": "연차 신청, 승인, 잔여 일수." },
  "agentNote": { "en": "Records leave requests and raises their approval as decisions; balances per person.", "ko": "연차 신청을 기록하고 승인을 결정으로 올립니다. 사람별 잔여 일수." },
  "pluginApi": 1,
  "server": "dist/server/index.js",
  "web": "dist/web",
  "skills": "skills",
  "capabilities": ["people:read", "board:decisions", "events:console", "jobs"],
  "roles": {
    "employee": { "name": { "en": "Employee", "ko": "구성원" }, "description": { "en": "Requests leave and sees their own balance.", "ko": "연차를 신청하고 자기 잔여를 봅니다." } },
    "approver": { "name": { "en": "Approver", "ko": "승인자" }, "description": { "en": "Sees every request.", "ko": "모든 신청을 봅니다." } }
  },
  "defaultRole": "employee",
  "board": { "needs": "required", "defaults": { "key": "people-ops", "name": { "en": "People", "ko": "인사" }, "description": { "en": "Leave and the people's matters.", "ko": "연차와 인사 업무." } } },
  "settings": [
    { "key": "daysPerYear", "type": "number", "name": { "en": "Days per year", "ko": "연간 일수" }, "default": 15, "min": 0, "max": 365 },
    { "key": "approver", "type": "person", "name": { "en": "Approver", "ko": "승인자" }, "required": true }
  ],
  "menu": { "group": "people", "order": 10 },
  "pages": [
    { "key": "mine", "name": { "en": "My leave", "ko": "내 연차" }, "level": "workspace", "roles": ["employee"] },
    { "key": "requests", "name": { "en": "Requests", "ko": "신청" }, "level": "workspace", "roles": ["approver"], "wide": true }
  ],
  "widgets": [{ "key": "balance", "name": { "en": "Leave left", "ko": "남은 연차" }, "place": "home:top", "size": "third", "roles": ["employee"] }],
  "dataVersion": 1
}
```

## The server module

The default export of `server` is `definePlugin({...})` from `@skillcdn/console/plugin`. Every definer yields a description the host can serialize (names, arguments, roles, schedules) beside the functions it runs; the console parses command lines, writes help and draws forms from the description, never from the code.

```ts
import { definePlugin, defineCollection, defineCommand, defineQuery, defineEndpoint, arg, z } from "@skillcdn/console/plugin";

const requests = defineCollection("requests", {
  schema: z.object({ personId: z.string(), from: z.string(), to: z.string(), reason: z.string().max(2000), state: z.enum(["requested", "approved", "rejected", "cancelled"]), decisionId: z.string().nullable() }),
  indexes: ["personId", "state", "from"],
  search: ["reason"],
  owner: "personId",
  project: "none",
  read: ["approver"],
  readOwn: ["employee"],
});

export default definePlugin({
  collections: [requests],
  commands: {
    request: defineCommand({
      about: "Requests leave for the person the command acts as; the approval is a decision.",
      args: { from: arg.day({ about: "the first day" }), to: arg.day({ about: "the last day" }), reason: arg.text({ optional: true, max: 2000 }) },
      roles: ["employee"],
      async run(ctx, args) {
        const request = await ctx.records(requests).create({ personId: ctx.caller.kind === "person" ? ctx.caller.person.id : "", from: args.from, to: args.to, reason: args.reason ?? "", state: "requested", decisionId: null });
        /* ... */
        return { text: "Requested; the decision waits for the approver.", data: request, waiting: decision.id };
      },
    }),
  },
  queries: {
    balance: defineQuery({ about: "The days left this year.", args: { person: arg.person({ optional: true }) }, roles: ["employee"], async run(ctx, args) { /* ... */ } }),
  },
  endpoints: {},
  on: {
    "console:decision.answered": async (ctx, event) => { /* the request the decision was about */ },
  },
  jobs: {
    accrue: { about: "Adds the year's days on its first day.", every: "P1D", at: "02:00", async run(ctx) { /* ... */ } },
  },
  upgrades: [],
  api: {},
  async onEnable(ctx) {},
  async onDisable(ctx) {},
});
```

| Part | Shape | Notes |
|---|---|---|
| `collections` | `[defineCollection(name, { schema, indexes?, search?, owner?, project?, read?, readOwn?, history? })]` | a list; `name` as `key`; `schema` is a zod object (any schema that follows Standard Schema), checked in the plugin's thread on every write; `indexes` (up to 8) are the fields `where`, `order` and `aggregate` may name, beside `id`, `owner` and `project`, which always may; `search` the fields searched as words; `owner` an indexed field holding a person's id, for `readOwn`; `project` is `none` (unless said), `optional` or `required`; `read` and `readOwn` name roles; `history` keeps a version per write, `true` unless said otherwise; up to 50 collections. The definition is what `ctx.records(requests)` takes, and types the records from the schema |
| `commands` | `defineCommand({ about, args, roles?, run })` | `about` one line; `args` named definers, positional where `positional: true`, in declaration order; `run(ctx, args)` returns `{ text, data?, waiting? }`: `text` is what the command prints, `data` what `--json` prints, `waiting` the id of a decision the caller waits for; up to 100 commands and queries together, named as `key` and not as a subcommand of the command (`help`, `records`, `skills`, `skill`, `enable`, `disable`, `settings`, `secret`, `grant`, `revoke`) |
| `queries` | `defineQuery({ about, args, roles?, run })` | reads only; `run` returns JSON up to 4 MiB, or `{ file: { name, type, bytes } }` for an export |
| `endpoints` | `defineEndpoint({ auth, roles?, secret?, methods?, run })` | with the `endpoints` capability; `auth` is `person` (a session or a token, with `roles`) or `webhook` (nobody; `secret` names the setting the plugin verifies the signature with); `run(ctx, request)`, the request `{ method, path, query, headers, body }` with the headers `content-type` and those the definition names and the body text up to 1 MiB, returns `{ status, headers?, body? }`, the headers among `content-type`, `location` and `cache-control`, the body a string or JSON up to 4 MiB |
| `on` | `{ "console:<kind>": handler, "plugin:<key>:<name>": handler }` | hooks; `console:` kinds need `events:console`, `plugin:` ones `events:plugins`; `handler(ctx, event)`; idempotent, since delivery is at least once |
| `jobs` | `{ [name]: { about, every, at?, run } }` | `every` an ISO 8601 duration of five minutes or more; `at` a time of day (`HH:MM`) in the workspace's time zone, for a daily or longer `every`; one run of a job at a time |
| `upgrades` | `[{ to, about, run }]` | run in order by the `migrate` role from the installed `dataVersion` to the manifest's |
| `api` | `{ [name]: { about, input, run } }` | what other plugins may call with `plugins:<key>`; `input` a zod schema; `run(ctx, input)` with the caller passed through |
| `onEnable`, `onDisable` | `(ctx) => Promise<void>` | optional; run when an administrator enables or disables |

The argument definers: `arg.text({ max?, optional?, secret? })`, `arg.markdown()`, `arg.day()`, `arg.number({ min?, max?, integer? })`, `arg.boolean()`, `arg.enum([...])`, `arg.person()` (a login or `me`, resolved by the console to a person the caller may see, handed to `run` as `{ id, login, name }`), `arg.project()` (a key the caller may see, handed as `{ id, key, name }`), `arg.record("<collection>")` (an id of that collection), `arg.list(inner, { max? })` (a flag repeated, or commas between), `arg.file()` (what `--file <path>` or `-` carried; the command uploads it first and hands a handle). Every definer takes `about` (one line, shown in help), `optional` and `positional`; a positional argument comes before the flags, in declaration order, and no required one follows an optional one. Each yields a plain description, and `run`'s `args` is typed from them: optional ones may be `undefined`. An argument marked `secret` is hidden in the event the command leaves. An argument is not named `json`, `url`, `account`, `project`, `file` or `run`, the flags the command keeps for itself (`RESERVED_ARG_NAMES`). A plugin refuses in its own words by throwing `PluginError(code, message)`, which the console answers as `plugin.<key>.<code>`; a definition the console cannot hold is refused when the module loads, as a `PluginDefinitionError` naming every problem.

## The context

Everything a plugin does to the console is a call on `ctx`, which is a message to the parent process; arguments and results are JSON, files are handles, nothing else crosses. The parent decides each call by the capabilities consented to and, for a person's call, by the person's roles and the console's own policy, and refuses what is not allowed with `plugin.forbidden`.

| Member | What it is | Needs |
|---|---|---|
| `ctx.plugin` | `{ key, version, dataVersion, settings, board, projects }`: the settings without the secrets; `board` the board project's `{ id, key }` or `null`; `projects` `"all"` or the keys of the projects the plugin is on | nothing |
| `ctx.caller` | `{ kind: "person" \| "console", person?, agent?, roles, run?, project? }`: in a command, a query or a person's endpoint, the person (`id`, `login`, `name`, `language`, `admin`), the agent's name where a token acts, their roles in this plugin, their open run in the board project if any, and the project the call is on; in a job, a hook, an upgrade or a webhook, `console`, with every role | nothing |
| `ctx.records(collection)` | the records of a collection, by its definition (typed from the schema) or by name: `create(data, { project?, owner? })`, `get(id)` (`null` when there is none), `update(id, patch, { baseVersion? })`, `archive(id)`, `restore(id)`, `list({ where?, order?, limit?, after?, project?, archived? })`, `search(words, { where?, limit?, project? })`, `aggregate({ where?, groupBy?, count?, sum?, min?, max? })`, `versions(id)`, `link(id, target)`, `unlink(id, target)`, `links(id)`, and `files(id)` with `attach(handle, { name?, type? })`, `list()` and `remove(fileId)`; `order` is `{ field, descending? }`; a refusal is thrown as a `PluginRefusal` with the console's code | nothing; `files` for the files |
| `ctx.sql` | `query(text, params)` and `transaction(async (tx) => ...)`, on the plugin's own role | `storage:sql` |
| `ctx.console.workspace()` | the workspace's name, languages, time zone and categories | nothing |
| `ctx.console.people` | `list({ q? })` and `get(id)`: the people the caller may see; everyone for a `console` caller, or with `people:read:all` | `people:read` |
| `ctx.console.projects` | `list()`, `get(key)`, `members(key)`: the projects the caller may see; all with `projects:read:all` | `projects:read` |
| `ctx.console.tasks` | `list(project, filters)`, `get(project, number)`, `create(project, task)`, `update(project, number, patch)`, `comment(project, number, body)`: reading in the plugin's projects, creating there, changing and commenting its own | `board:read`; `board:tasks` |
| `ctx.console.decisions` | `list(project)`, `get(id)`, `ask(project, { question, body?, options, deciderId?, taskId?, about })`: `about` names the record the decision is for; there is no `answer` | `board:read`; `board:decisions` |
| `ctx.console.documents` | `list(project, folder)`, `read(project, path)`, `write(project, path, { title, body })` under `plugins/<key>/` | `board:read`; `board:documents` |
| `ctx.console.runs` | `list(project)`, `get(id)` | `board:read` |
| `ctx.events.emit(kind, data)` | an event of the plugin's own, for its frames and for other plugins' hooks; `kind` as `key`, `data` JSON up to 16 KiB | nothing |
| `ctx.fetch(url, init)` | an outbound request; `init` may carry `secret: { name, as }`, `as` one of `header:<name>`, `query:<name>` and `basic`, and the console puts the secret there | `outbound:<host>` for the URL's host |
| `ctx.secrets` | `has(name)`, `sign(name, payload, algorithm)`, `verify(name, payload, signature, algorithm)` with `hmac-sha256`; never the value | nothing |
| `ctx.plugins.get(key)` | `{ version, api: { [name]: (input) => Promise<unknown> } }` of another plugin, the caller passed through | `plugins:<key>` |
| `ctx.log` | `info`, `warn` and `error` lines, written to the console's log with the plugin's key and the caller; up to 100 lines a minute | nothing |
| `ctx.now()`, `ctx.language`, `ctx.signal` | the time; the caller's language, `en` for `console`; the `AbortSignal` that fires at the bound | nothing |

What `ctx` never has, whatever the manifest asks: the environment, a connection of the console's to the database, a session or a token, a secret's value, another plugin's records or secrets, a way to answer a decision, to change a person, a role, a membership or a setting of the workspace, or to make a request a person could not make themselves.

A read of the console in a person's call is the person's: `people.list` is the people they may see, `projects.list` the projects they may see, a task they may not see is not found. A `console` caller (a job, a hook) sees what the plugin's capabilities open: `people:read` alone shows a job nobody, `people:read:all` everyone. A plugin that wants a person to see more than they may must not; the capability for the whole directory is declared and consented to as such.

## Capabilities

Declared in the manifest, consented to by an administrator when enabling, enforced by the parent on every call. Without a capability, the call is `plugin.forbidden`. The last column is the reach of a plugin that turns out malicious and holds the capability; what no capability opens is under "Security model".

| Capability | Opens | Reach, if malicious |
|---|---|---|
| (none) | its own records, versions, links and events; its settings; its log | its own data, spoiled; the versions restore it |
| `files` | files on its records, within `PLUGIN_FILE_BYTES_AT_MOST` | storage filled to the bound |
| `people:read` | the people the caller may see, as the person | the names and logins its role holders may see anyway |
| `people:read:all` | everyone, for `console` callers too | the directory |
| `projects:read` | the projects and members the caller may see | what the person sees |
| `projects:read:all` | every project and its members | the projects and who is in them |
| `board:read` | the tasks, decisions, runs, documents and events of its board projects, and of the project a call is on | the content of those boards, to its role holders |
| `board:tasks` | tasks created in its projects; its own changed, closed, commented | tasks that mislead; each marked as the plugin's, put away by anyone |
| `board:decisions` | decisions raised in its projects; the answers to its own read | questions that mislead; never an answer |
| `board:documents` | pages written under `plugins/<key>/` in its projects | pages that mislead, in its folder |
| `events:console` | hooks on the console's events of its board projects: the kind, the ids and the time, the content with `board:read` | when things happen on those boards |
| `events:plugins` | hooks on the events other plugins emit | what they publish |
| `jobs` | runs on a schedule | time, within the bound |
| `outbound:<host>` | `ctx.fetch` to that host, a public address, over https | what it may read, sent to that host; a cost there |
| `endpoints` | inbound requests under its path, a person's or a webhook's | input it accepts without verifying; the rate limit holds |
| `plugins:<key>` | that plugin's `api`, as the caller | what that API gives the caller |
| `storage:sql` | a schema and a login role of its own | statements up to the timeout, within its schema |

`outbound:<host>` names a host exactly or as `*.example.com`; the console resolves the host before connecting and refuses its own networks, as it does for a picture ([ADR-0048](../adr/0048-a-picture-from-elsewhere-is-read-through-the-console-from-a-public-address-and-kept-a-while.md)). A new version of a plugin that declares a capability its install was not consented to waits, disabled, as `needs consent`, until an administrator consents again.

## Roles and grants

- A plugin declares roles; what each means is the plugin's to say in its description and to enforce where it reads, since the console knows a role by its name alone.
- A grant is an administrator's: a role to a person, to the members of a project (a grant that follows the membership), or to everyone. `defaultRole` is everyone's without a grant. An administrator holds every role of every plugin.
- A command, query, page, widget or endpoint names the roles that may use it (any of them); without `roles`, every member may. A collection names the roles that read it, and those that read their own records in it.
- A token acts with its person's roles; nothing is granted to an agent ([ADR-0021](../adr/0021-a-token-configures-as-its-person-does.md)).
- A person without a role in a plugin sees none of its tabs or widgets, and its pages and commands are `plugin.forbidden`; the plugin itself is listed, so that the person knows what to ask for.

## Settings

The form on `/settings/plugins/<key>` and `console plugin <key> settings --set` come from the manifest's `settings`. A `secret` is sealed with the deployment's secret (`AUTH_SECRET`, with the purpose `plugin-secret`), never returned by any route or shown in any form (only whether and when it was set), and used by the console where the plugin names it: `ctx.fetch`'s `secret`, `ctx.secrets.sign` and `verify`, a webhook's `secret`. A deployment without `AUTH_SECRET` refuses settings of type `secret`. `person` and `project` settings hold ids and are shown as names; a person who left or a project put away makes the setting invalid, which the pages show. Settings are the workspace's; a plugin that needs a value per project keeps a record linked to the project.

## Records

The console keeps a plugin's records in `plugin_records` (id UUIDv7, plugin, collection, project, owner, data, version, created and updated by whom and through what, archived), `plugin_record_versions`, `plugin_record_files` (a file in the blob store, by content hash) and `plugin_links` (a record to a task, a decision, a document, a project, a run, or a record of any plugin; and the board's items a plugin made, with no record).

- `where` is `{ field: value | { in: [...] } | { gte, gt, lte, lt } | { exists } }` on `indexes` fields, several combined with and; `order` one `indexes` field, ascending or descending, the id as the tie; pages by `limit` (up to 200) and `after` (the cursor the last page returned). `search` is the database's text search over the `search` fields, as documents are searched. `aggregate` groups by up to two `indexes` fields and counts, sums, takes the least and the most of numeric fields.
- A write checks the schema, bounds the record to 64 KiB and the collection to the plugin's quota, and keeps the version before it where `history` is on; `update` with `baseVersion` is `plugin.conflict` when the record moved on. `archive` keeps a record out of lists; nothing is deleted but by purge.
- Who reads a record through the console's generic routes and the bridge: a person with a `read` role of the collection, or a `readOwn` role where the record's `owner` is them; and, where the record is linked to a project, only if they may see the project. Plugin code reads its own records whole; what it shows is its own responsibility, `ctx.caller` saying who asks.
- Files: `POST .../files` takes bytes from a person's page or from the command and answers a handle good for an hour; a command attaches the handle to a record, and the console counts the bytes to the plugin's bound. `GET .../files/<id>` is read under the record's rule.
- Export: `GET .../export` is JSON Lines, a line per record, version, link, grant and setting, then the list of the files with their hashes; an administrator's.

## SQL

With `storage:sql` consented to, enabling creates the schema `plugin_<key>` and the login role `plugin_<key>`, grants the role `USAGE` and `CREATE` on that schema and nothing on any other, sets its `search_path` to the schema, its `statement_timeout` to ten seconds and its connection limit to four, and gives it a password the console draws at every boot and keeps in memory alone. The plugin's `migrations/*.sql`, in the order of their names, are applied as the plugin's role by the `migrate` role under the console's migration lock, those applied recorded in `plugin_<key>._migrations`. `ctx.sql.query` and `transaction` run on a pool of the plugin's role in the parent, and a result is bounded to 10,000 rows and 4 MiB. The console's own tables are in `public`, where the role holds no right. Purge drops the schema with everything in it, and the role. The console's database user needs `CREATEROLE`; without it, `GET /api/v1/plugins` says `storage:sql` is unavailable in this deployment, and a plugin that declares it cannot be enabled (`plugin.unavailable`).

## The board

- `board.needs` says whether the plugin puts things on a board. Enabling one with `required` or `optional`, the administrator makes a project from `board.defaults` (the key, name and description in the workspace's languages, edited as they like; private; they are its owner) or chooses one that exists; several plugins may bind to one project. The install keeps the project's id, and the project's settings page shows the plugins bound to it.
- A plugin with `level: project` pages, or with `project: optional` or `required` collections, is on the projects the administrator names: all, or a list. A plugin on no project has no project pages. Owners do not enable plugins in their projects.
- What a plugin makes on a board carries its name: the console writes the link (`plugin_links`: plugin, kind, id) when `ctx.console.tasks.create`, `decisions.ask` or `documents.write` runs, the event carries `plugin = <key>` beside `actor` and `agent`, and the pages and the feed say "through <plugin>" (`plugin` on a task, a decision and a document as the API answers them). A person's call acts as the person; a `console` caller, a job or a hook, acts as the administrator who enabled the plugin, who owns what it makes, within the plugin's projects alone. A plugin changes, closes, comments or reads the answer of its own items only; it reads every item of its board projects with `board:read`. Its documents go under `plugins/<key>/`; a write elsewhere is `plugin.forbidden`.
- A decision a plugin raises is a decision as any ([ADR-0042](../adr/0042-a-decision-is-addressed-to-a-person-its-raiser-unless-another-is-named.md)): addressed to the person named in `deciderId`, who must be able to work in the project, else to the project's owners; answered by anyone of the project; shown among the person's decisions and in `console work`. The command that raised it returns `waiting` and exits with `3`, and the agent waits as it does for `ask`. The plugin learns of the answer through `on["console:decision.answered"]`, which `about` lets it map to its record; a plugin never answers.
- Where a record is linked to a project and the caller may work there, `ask` and `tasks.create` may name that project instead of the board project.
- Two plugins on one project do not collide: each edits its own, reads all, writes in its own folder; one refers to another's work by reading, or through the other's `api`.

## Events, hooks and jobs

- New kinds of the console's events: `plugin.enabled`, `plugin.disabled`, `plugin.configured`, `plugin.granted`, `plugin.revoked`, `plugin.upgraded`, `plugin.command`, `plugin.failed`, `plugin.purged`. `events.plugin` names the plugin on every event a plugin caused, its own kinds and the board's. `plugin.command` records the plugin, the command, the arguments (the secret ones as `[hidden]`), the outcome (`ok`, `refused` with its code, `waiting`, `failed`), the duration and the caller's run. They are in the board project's feed where there is one, and always at `GET /api/v1/plugins/<key>/events`.
- A plugin's own events (`ctx.events.emit`, the kind named as a `key`, the data JSON up to 16 KiB) go to `plugin_events` (plugin, kind, data, at; 100,000 kept, for ninety days, the janitor sweeping the rest), reach the frames of that plugin that subscribed, read at `GET .../plugin-events?after=&limit=` by its role holders, and the hooks of plugins with `events:plugins` on `plugin:<key>:<kind>`. They are not the board's feed.
- Hooks run in the `worker` role's host. A dispatcher reads the console's events and `plugin_events` from a cursor per plugin (`plugin_cursors`, begun at the end of both streams when the plugin is enabled, so that it is not told of everything that ever happened) under an advisory lock, so that one process dispatches, and delivers each event to the handler that named its kind; a console event is delivered for the plugin's board project, the projects it is on, the items it made and what it caused, with the kind, the ids and the time, and the content and the actor with `board:read`. Delivery is at least once and in order: a handler that fails is retried five times with doubling backoff, then the event is skipped with a `plugin.failed` event; a handler has thirty seconds.
- Jobs run in the `worker` role's host, with the `jobs` capability, each under an advisory lock, never two at once; `plugin_jobs` keeps the last run, its outcome and the next time, the first run one period after the scheduler first sees the job, `at` read in the workspace's time zone; a failed job is a `plugin.failed` event, at most one an hour per job, and a line in the log every time. A job has five minutes.
- `WORKER_IN_PROCESS` puts hooks and jobs in the `api` role's host.

## Between plugins

- `requires` is enabled first and stays enabled: enabling a plugin whose requirement is not enabled, or not in range, is `plugin.requires`; disabling one that another enabled plugin requires is `plugin.required_by`.
- `plugins:<key>` lets a plugin call `ctx.plugins.get(key).api.<name>(input)`; the callee checks `input` with its schema and runs with the caller passed through, so that the callee's roles decide again; a callee that is disabled is `plugin.disabled` to the caller.
- `events:plugins` is the loose coupling: a plugin emits, another listens; a payload is the emitter's to define and document.

## Lifecycle

| State | How it comes about | What works |
|---|---|---|
| installed | the package is in `PLUGINS_DIR` with a manifest, and loads | listed in the settings; nothing else |
| failed | the manifest is invalid, the key is taken, `pluginApi` is not served, `requires` names a plugin that is missing, the server module does not load, or the installed `dataVersion` is newer than the code's | listed with its reasons; a `plugin.failed` event; the console boots on |
| enabled | an administrator consented to the capabilities, bound the board, named the projects and filled the required settings, and `onEnable` ran | everything |
| needs consent | a new version asks capabilities the install lacks | nothing but the settings, until consented |
| disabled | an administrator disabled it and `onDisable` ran, or a required plugin is gone | nothing; the data kept; the tabs gone; commands `plugin.disabled` |
| orphaned | the package left the directory while the install stays | nothing; the settings offer export and purge |
| purged | an administrator purged it, naming the key again | nothing remains but the board's items, marked |

Upgrades: the `migrate` role, before the `api` and `worker` roles start on a new image, runs each enabled plugin's SQL migrations and `upgrades` from the installed versions to the manifest's, in a host of its own, under the console's migration lock. `GET /readyz` is the console's; a plugin's state is on `GET /api/v1/plugins`.

## The host

- The `api` and `worker` roles each spawn one child process from the console's own code (`dist/plugin-host.js`), as `node --permission --allow-fs-read=<PLUGINS_DIR>,<the host's own directory> --allow-worker dist/plugin-host.js`, with an environment of nothing but what Node needs, no database credentials, and no configuration but what the parent sends over the IPC channel: the plugins to load and the limits. No `--allow-fs-write`, `--allow-child-process`, `--allow-addons` or `--allow-wasi`.
- The host loads each plugin's server module in a worker thread of its own, with `resourceLimits` from `PLUGIN_MEMORY_MB_AT_MOST`, after hardening the thread: a module hook refuses `node:net`, `node:http`, `node:https`, `node:http2`, `node:tls`, `node:dgram`, `node:dns`, `node:child_process`, `node:cluster`, `node:worker_threads`, `node:vm`, `node:inspector`, `node:repl`, `node:wasi` and `node:v8`; `globalThis.fetch`, `WebSocket`, `EventSource` and `process.binding` are removed; `process.env` is emptied. Reading files is the plugin's own directory, by the permission model; writing is nowhere.
- The host's main thread is the broker: a call on `ctx` is a message from the thread to the broker to the parent, which decides and performs it and answers; messages are JSON up to 4 MiB, and files travel as handles the parent resolves.
- A thread that runs past its time (`ctx.signal` fires first, then the broker ends it), grows past its memory or crashes is ended alone; the broker starts it afresh, and the call that was running fails as `plugin.timeout` or `plugin.unavailable`. Module-level state does not survive; state is in records.
- A host that dies is restarted by its parent; while it is away, every plugin call is `plugin.unavailable`, and the console answers everything else.
- The `migrate` role spawns a host to run upgrades and stops it. `WORKER_IN_PROCESS` means one host.

## REST

Under `/api/v1/plugins`. Who may call: *anyone* signed in or on a token, *roles* a person holding a role the thing names, *admin* an administrator. The shapes of these routes are in `@skillcdn/console/api` and in the REST snapshot ([ADR-0043](../adr/0043-the-rest-contract-is-held-to-a-snapshot-taken-at-the-floors.md)); what a plugin's command or query carries is the plugin's.

| Route | Who | What |
|---|---|---|
| `GET /api/v1/plugins` | anyone | the plugins a member may know of (the enabled ones; every state for an administrator): key, name, description, version, state and reasons, the caller's roles, the menu, the pages and widgets the caller may see, the board project's key; and whether `storage:sql` is available in this deployment |
| `GET /api/v1/plugins/<key>` | anyone | one plugin: the above, its commands and queries (name, about, args), its skills address, its settings without the secrets (whether each is set); for an administrator the consent, the grants and the projects |
| `POST .../enable` | admin | `{ consent: [...], board: { create: { key, name, description } } \| { project: "<key>" } \| null, projects: "all" \| [...], settings: {...} }` |
| `POST .../disable` | admin | |
| `PATCH .../settings` | admin | `{ values }`, without secrets |
| `PUT .../secrets/<name>`, `DELETE .../secrets/<name>` | admin | `{ value }`; never read |
| `GET .../grants`, `POST .../grants`, `DELETE .../grants/<id>` | admin | `{ role, person?: id, project?: key, everyone?: true }` |
| `POST .../invoke` | roles | `{ argv: [...], files?: [handles], project?: key, run?: id }`: the words as typed, the command's or the query's name first, parsed by the console against the definition (`parseArgv`: the positionals in declaration order, `--name value` or `--name=value`, a boolean flag alone, a list as the flag repeated or with commas between, `--` ending the flags; a person by login or `me`, a project by key and a file by its handle resolved to what the caller may see or uploaded); the handles of the files uploaded for its `file` arguments, in declaration order; the project the call is on; the run it is for, one of the caller's open in the board project, where several are. `{ kind: "command" \| "query", text, data, waiting }`, a query's file as `data.file` with `name`, `type`, `bytes` and `base64`; or the refusal |
| `POST .../commands/<name>` | roles | `{ args, project?, run? }`, the arguments as JSON by name, for the pages; the same answer |
| `GET .../queries/<name>?args=<json>&project=` | roles | the query's JSON, or its file as bytes with `content-disposition` |
| `GET .../records/<collection>?where=&order=&limit=&after=&q=&project=` | roles | the records the caller may read |
| `GET .../records/<collection>/<id>[?version=]`, `GET .../records/<collection>/<id>/versions` | roles | one record, a version of it, its versions |
| `POST .../files`, `GET .../files/<id>` | roles | a file for a command (a handle, good for an hour); a record's file |
| `GET .../events?limit=&offset=` | roles | the plugin's events |
| `GET .../plugin-events?after=&limit=` | roles | the events the plugin emitted (`ctx.events.emit`), after a number, oldest first: `{ items: [{ id, kind, data, at }], more }` |
| `GET .../skills`, `.../skills/one?path=&cursor=`, `.../skills/file?path=&offset=&limit=`, `.../skills/browse?path=&cursor=&limit=`, `.../skills/find?query=&path=&cursor=&limit=` | anyone who may know of the plugin | the plugin's skills, a pack of its own at `/local/plugins/<key>`, read from its package on the console's machine as a `local` pack is ([ADR-0031](../adr/0031-the-console-reads-a-pack-as-the-skillcdn-command-does-and-a-local-one-from-a-directory.md)), answered as a project's five reads are; `status: none` for a plugin that ships none |
| `ANY .../x/<name>[/<rest>]` | a person, or nobody | an endpoint, with `endpoints`: a `person` endpoint for whoever is signed in or presents a token and holds a role it names (a session's request that is not a read, from elsewhere than the console's own pages, counts for nobody), a `webhook` endpoint for nobody, run as the console with every role and held to 600 requests a minute per plugin (`plugin.rate_limited`). The request's body up to 1 MiB, its headers cut to `content-type` and those the definition names; the answer's status, its `content-type`, `location` and `cache-control`, and its body, under the console's own `nosniff`, `no-store` and a sandboxing policy. A method the definition does not name is `plugin.invalid_args` |
| `GET .../export` | admin | JSON Lines, and the list of the files |
| `POST .../purge` | admin | `{ confirm: "<key>" }` |
| `GET .../frame?page=<key>\|widget=<key>&project=<key>` | anyone, no session | the frame document |
| `GET .../web/<version>/<path>` | anyone, no session | a file of the bundle, immutable |
| `GET /api/v1/plugin-runtime/console.css` | anyone, no session | the console's stylesheet, for frames |

## The command

`console plugins` and `console plugin <key> …` are two entries of the command's table; the command sends words and renders the generic shapes, and knows nothing of any plugin. `console help` gains one line: the plugins of this console, if any, are `console plugins`, and one of them `console plugin <key>`.

| Command | Asks | Says |
|---|---|---|
| `plugins` | `GET /api/v1/plugins` | a line per plugin: key, name, version, state, the caller's roles |
| `plugin <key>` | `GET /api/v1/plugins/<key>` | the description and the agent note; a line per command and query; the skills (`console plugin <key> skills`); the board project; the settings an agent should know |
| `plugin <key> help [<command>]` | the same | one command whole, in the form of `console help <command>`: the forms, the arguments, the limits, the refusals |
| `plugin <key> <command> [args] [--<flag> <value>]... [--file <path> \| -] [--run <id>] [--json]` | `POST .../files` where `--file` or `-`, then `POST .../invoke` with the words as typed, the handle, the project the command works in and the run named | the command's `text`, or its `data` with `--json`; a query's answer as JSON, a file it answers saved under its name; exit `0`; `3` with `waiting`, printing the decision's id and `console decision <id> --wait`; `1` on a refusal, in the console's form. `--json`, `--url`, `--account`, `--project`, `--file` and `--run` are the command's own wherever they stand; every other word is the plugin's |
| `plugin <key> records <collection> [<id>] [--where <field>=<value>]... [--search <words>] [--project <key>] [--order <field>[:desc]] [--limit <n>] [--after <cursor>] [--archived] [--versions]` | `GET .../records/...` | the records, one a line, or one whole, or its versions |
| `plugin <key> skills [--search <words>]`, `plugin <key> skill <path>` | `GET .../skills...` | as `console skills` and `console skill` |
| `plugin <key> enable [--consent <capability>,...] [--board new\|<key>] [--projects all\|<key>,...] [--set <key>=<value>]...`, `plugin <key> disable`, `plugin <key> settings [--set ...]`, `plugin <key> secret <name>` (the value from standard input), `plugin <key> grant <role> --person <login>\|--project <key>\|--everyone`, `plugin <key> revoke <grant>` | the administrator's routes | what changed; `enable` prints what each capability opens before asking the console, and refuses without `--consent` naming every capability the manifest asks |

The rules an agent reads carry the plugins: `GET /api/v1/rules` and `GET /api/v1/projects/<key>/rules` answer `plugins`, each with its `key`, `name`, `agentNote` and `description` by language and the caller's `roles` in it, and `console take` and `console rules` print, after the project's rules, a section `## Plugins` with a line per plugin bound to the project (as its board project, or on it) that the caller holds a role in, `- <key> (<name>): <agentNote> Start with console plugin <key>.`, the note in the caller's language where the manifest has it, the description where it has no note; `console rules` at the workspace lists every plugin the caller may use. Nothing else of a plugin reaches an agent unasked. `console help` names the two commands in a section of their own, and `console skills` ends with where a plugin's skills are. The skill `working-the-board` says: when the rules name a plugin, read `console plugin <key>` and its skills before its first command.

## Pages

### The frame

`GET /api/v1/plugins/<key>/frame?page=<key>` (or `widget=<key>`), with `&project=<key>` on a project, answers a document the console writes, with no session needed and nothing a session would add:

```html
<!doctype html>
<html lang="<language>" data-console="<origin>" data-plugin="<key>" data-page="<key>">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="<origin>/api/v1/plugin-runtime/console.css">
  <link rel="stylesheet" href="<origin>/api/v1/plugins/<key>/web/<version>/index.css">
</head>
<body><div id="root"></div><script type="module" src="<origin>/api/v1/plugins/<key>/web/<version>/index.js"></script></body>
</html>
```

with the headers `content-security-policy: default-src 'none'; script-src <origin>/api/v1/plugins/<key>/web/; style-src <origin>/api/v1/plugins/<key>/web/ <origin>/api/v1/plugin-runtime/; img-src <origin>/api/v1/plugins/<key>/web/ data: blob:; font-src <origin>/api/v1/plugins/<key>/web/ <origin>/api/v1/plugin-runtime/; connect-src 'none'; frame-ancestors <origin>; base-uri 'none'; form-action 'none'; sandbox allow-scripts`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff` and `cache-control: no-store`. `<origin>` is the origin of the page that embeds the frame, read from the request's `referer`: `PUBLIC_URL`'s, or the loopback a person's own console is served on by `console serve` ([ADR-0014](../adr/0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)); any other, or none, is not found. The console's page embeds the frame as `<iframe sandbox="allow-scripts" referrerpolicy="origin" src=...>`. The document's origin is opaque: no cookie travels, the API is out of reach, and its scripts are the bundle's alone. The files of the bundle, `GET .../web/<version>/<path>`, are served from the package's `web` directory with `cache-control: public, max-age=31536000, immutable` and `cross-origin-resource-policy: cross-origin`, since the frame's origin is not the console's. A bundle holds no secret, since anyone may fetch it. The console's own pages gain `frame-src 'self'` in their policy and nothing else.

### The bridge

The console's page and the frame speak over `postMessage`, every message `{ v: 1, t, ... }`; the page accepts messages from the frame's `contentWindow` alone, the frame from the origin in `data-console` alone.

| From | `t` | Carries |
|---|---|---|
| the page | `init` | `plugin: { key, version }`, `page` or `widget`, `project?: { key, name }`, `person: { id, login, name, language, admin }`, `roles`, `path` (what follows the page in the address), `language`, `theme: { [token]: value }` |
| the page | `result` | `id`, `ok`, `value` or `error: { code, message }` |
| the page | `event` | `kind: "records" \| "command" \| "plugin"`, `data`: something of this plugin changed |
| the page | `theme` | the tokens, when the console's look changes |
| the page | `path` | `path`, when the console navigated within this page's address |
| the frame | `ready` | nothing; the page answers with `init` |
| the frame | `call` | `id`, `method`, `params`: `command` (`name`, `args`), `query` (`name`, `args`), `records.list`, `records.get`, `records.versions`, `files.get` (`id`; the bytes come back transferred), `files.put` (`bytes`, `name`, `type`; a handle comes back) |
| the frame | `navigate` | `path`: a path of the console's, which the page follows in place; a URL is refused |
| the frame | `resize` | `height`, which the page gives the frame, up to a bound for a widget |
| the frame | `title` | `text`, for the document's title |
| the frame | `download` | `id` of a file, which the page downloads |
| the frame | `subscribe` | `kinds`, to receive `event` |

The page performs every `call` with the person's session under `/api/v1/plugins/<key>/` only; a method or a path outside it is refused before any request, as `plugin.forbidden`. A page thus holds exactly the authority of its plugin's server module, as the person using it.

`@skillcdn/console/plugin/web` is the frame's side: `connect()` says `ready`, waits for `init`, and resolves to `{ context, call, command, query, records, files, navigate, download, setTitle, onEvent, onTheme, onPath, close }`, applies the tokens to `:root` and the language to the document, and watches the body's height; it depends on nothing, and a refusal arrives as a `PluginBridgeError` with the console's code. `@skillcdn/console/plugin/web/react` adds `usePlugin()` for a plugin that chooses React. A page renders nothing a person wrote as HTML, as the console's own pages do not.

### Tabs, sub-tabs and addresses

- At the workspace, after the console's own tabs come the groups that hold a plugin the person has a role in. A group with one plugin is a tab with the plugin's name, leading to its first page; a group with several is a tab with the group's name that opens the list of its plugins, each leading to its first page (a `<details>`, as the person's menu is; `NavItem.children`). The groups the console knows have names in every language pack; a group a plugin declares has the plugin's. Groups and plugins are ordered by `menu.order`, then by key.
- A plugin with several pages at a level has a row of sub-tabs the console draws above the frame, in the manifest's order; a page's `wide` widens the frame as `CustomPage.wide` does.
- Addresses: `/plugins/<key>` is the first page, `/plugins/<key>/<page>` a page, `/plugins/<key>/<page>/<rest>` a page with `<rest>` handed to the frame as `path`; on a project, `/projects/<pkey>/plugins/<key>[/<page>[/<rest>]]`. The custom pages of a console keep `/pages/<key>` ([ADR-0010](../adr/0010-the-default-uis-addresses-name-what-they-show-and-every-page-and-form-has-one.md)).
- On a project, the tab row gains the same, for the plugins on that project with `level: project` pages, to the members who hold a role.
- A person without a role sees no tab, and a plugin's address answers not found, as a project they may not see does.

### Widgets

The front page (`/`) shows the widgets the person holds a role for, `home:top` above the projects and `home:bottom` below, in a grid of six columns: `third` takes two, `half` three, `full` six. Each widget is a frame with the same document and bridge, `widget=<key>` in place of `page`, its name above it, its height what it asks up to 480 pixels.

### The look

The console's page reads its computed `--sc-*` tokens (the list is `CONSOLE_TOKENS` in the package) and sends them in `init.theme` and in `theme`; the frame's SDK sets them on `:root`, so that a custom console's look reaches its plugins' pages. `GET /api/v1/plugin-runtime/console.css` is the package's `console.css`, so that the `sc-*` classes work in a frame. Tokens added to the console's set for plugins: `--sc-color-info` and `--sc-color-info-subtle`; `--sc-color-neutral` and `--sc-color-neutral-subtle`, a state neither good nor bad; `--sc-series-1` to `--sc-series-6`, a palette for figures; `--sc-numeric`, the font features for tabular numerals. A plugin's own classes begin with `pl-<key>-`; `console-plugin check` warns of others. The frame's `lang` is the person's language, and the console shows the manifest's names in it; the words inside the frame are the plugin's, from `init.language`.

### The settings pages

`/settings/plugins` lists the plugins with their state; `/settings/plugins/<key>` is one: its state and reasons; the capabilities, each with a sentence of what it opens, to consent to; the board project, to make (the form filled from `board.defaults`) or to choose; the projects, all or chosen; the settings form from the manifest; the secrets, set and never shown; the grants (a person, a project's members, everyone); the plugin's events; export and purge, the latter asking for the key to be typed. Administrators only; no plugin code runs on these pages.

## Security model

The install path is the first line (a release of the deployment, from a lockfile, under review); the host is the second; the capabilities and the roles the third; the record the last. What follows holds for a plugin that is malicious.

**The ceiling.** Whatever its manifest asks and whatever was consented to, a plugin cannot:

| | Held by |
|---|---|
| read a secret, a credential or the environment | the host's empty environment; secrets used by the parent, never sent |
| reach the database | no connection in the host; `ctx.sql` on the plugin's own role |
| read a file outside its own directory, or write any file | the permission model |
| start a process, load an addon, open a socket | the permission model, the module hook, the removed globals |
| answer a decision, or act as a person it is not | no such call; every call is the caller's or the console's |
| change a person, a role, a membership, a project's settings or the workspace's | no such call |
| read another plugin's records or secrets, or write outside its collections, its schema and its folder | the parent's checks on every call |
| make a request a person could not make | the person's own policy on every read |
| hold the console: run past its time, grow past its memory, send more than fits | the bounds; the thread ended alone |
| hide: run a command, change the board or fail without a trace | the events and the log |

**The reach, by capability,** is the last column of the catalogue above. In sum: a plugin reaches what its role holders may see through it and what its consented capabilities open; sending anything out needs an `outbound` host the administrator consented to; what it does on a board is marked and reversible.

**What is checked, not enforced.** The hardening of a thread is defence in depth: a sandbox of its own would be a host container without egress, left to later. `console-plugin check` scans a plugin for what the host refuses, so that an author learns before an administrator does.

**The pages.** A frame's code runs in an opaque origin and reaches the console through the bridge alone, which performs its plugin's own routes and nothing else; it holds the person's authority within its plugin, exactly as the plugin's server does. Nothing a plugin writes is rendered as HTML by the console's pages: a tab, a sub-tab and a widget's name are text.

**The record.** Who did what, through which plugin, is on the board: `plugin.command` for every command, the board's own events with the plugin's key for every change, `plugin.enabled` and its kin for every administrative act. The settings page shows a plugin's events, and a feed is filtered by plugin. What was read, queried, received and run on schedule is in the operational log, a line each, with the plugin, the person, the name, the duration and the outcome.

## Limits and refusals

| Bound | Value |
|---|---|
| a command; a query or an endpoint; a hook; a job; `onEnable`, `onDisable`, an upgrade | 30 s; 10 s; 30 s; 5 min; 10 min |
| a message between host and parent; a query's answer; an endpoint's body and answer | 4 MiB; 4 MiB; 1 MiB and 4 MiB |
| a command line sent to `invoke`; one word of it; the files of one command | 200 words; 50,000 characters; 20 |
| a plugin's memory | `PLUGIN_MEMORY_MB_AT_MOST`, 256 unless set |
| records in a plugin; a record; versions of a record; the files' bytes in a plugin | 100,000; 64 KiB; 100; `PLUGIN_FILE_BYTES_AT_MOST`, none unless set |
| a plugin's own events | 100,000 kept, 90 days |
| outbound requests; an answer; its time | 60 a minute per plugin; 10 MiB; 10 s |
| webhook requests | 600 a minute per plugin |
| `ctx.log` | 100 lines a minute |
| collections; commands and queries; endpoints; pages; widgets; roles; settings; indexes of a collection | 50; 100; 20; 12; 4; 10; 50; 8 |
| SQL: a statement; a result; connections | 10 s; 10,000 rows and 4 MiB; 4 |
| a page of a list | 200 |

| Status | `code` | When |
|---|---|---|
| 404 | `plugin.not_found` | no plugin has the key |
| 409 | `plugin.disabled` | the plugin is installed and not enabled |
| 503 | `plugin.unavailable` | the plugin failed to load, its host is away, or this deployment lacks what it needs |
| 403 | `plugin.forbidden` | the caller lacks the role, the plugin lacks the capability, or the item is another's |
| 400 | `plugin.invalid_args` | the words or the arguments do not fit the definition; the message names the first at fault |
| 504 | `plugin.timeout` | the plugin's code ran past its bound |
| 409 | `plugin.too_many` | a quota of the plugin is reached |
| 409 | `plugin.conflict` | the record moved on since `baseVersion` |
| 409 | `plugin.needs_consent` | enabling, or a call, before the capabilities are consented to |
| 409 | `plugin.requires` | a required plugin is not enabled or not in range |
| 409 | `plugin.required_by` | another enabled plugin requires this one |
| 429 | `plugin.rate_limited` | more webhook or outbound requests than the bound |
| 500 | `plugin.failed` | the plugin's code threw what is not its own refusal, or the console could not perform a call on `ctx`; what was said is in the log, never in the answer |
| 400 | `plugin.<key>.<code>` | the plugin's own refusal, `code` as the plugin says, the message its own |

## Authoring

- `console-plugin init <dir> --key <key> [--name <name>] [--console <dependency>]` writes a plugin from the template in the package (`template/plugin`, the words `__key__`, `__name__` and `__console__` replaced in its files and their names): the manifest, a server module with one collection, one command and one query, the source of a web bundle with the bridge client, one page and one widget, one skill with `SKILLCDN.md`, tests against `@skillcdn/console/plugin/testing` and of the package as a console reads it, and the build with esbuild (`build.mjs`: the server module, the web bundle and its stylesheet). `examples/plugin-hello` in the repository is that result, built, and the check holds the two equal.
- `console-plugin check [<dir>]` reads the package as the console would and fails on: an invalid manifest; a reserved or malformed key; a `pluginApi` the command does not know; a server module that does not load under the host's hardening, or yields a definition naming a role, a setting, a collection or a page that is not declared; a built-in the host refuses, imported anywhere in the server bundle; a web bundle that is not self-contained (a script, a style or an import from elsewhere; `fetch`, `XMLHttpRequest`, `WebSocket` or `document.cookie` in it); a class without the `pl-<key>-` prefix; skills that `skillcdn check` refuses; a license that is not permissive; a `files` field that leaves out what runs. It is what a store would ask of a plugin. It needs Node.js 24 or newer; it warns, and does not fail, on a private package, a class without the prefix, a capability no definition uses, and skills left out; it exits `1` with every problem, `0` with a summary.
- `createTestContext({ collections?, plugin?, caller?, console?, sql?, fetch?, secrets?, plugins?, now?, language? })` from `@skillcdn/console/plugin/testing` is a `ctx` for a plugin's own tests: records in memory, checked against the schema and the indexes as the console checks them, versions, links and files kept; the console answering what the test provided and refusing the rest as `plugin.forbidden`; `emitted` and `logged` to assert on; `all(collection)` for every record; `as(caller)` for the same store as someone else.
- The skill `skills/building-a-plugin` is the map: what to ask, how to split a feature into commands, queries, decisions, tasks and jobs so that agents work and people decide, records or SQL, running a local console with the plugin linked into `PLUGINS_DIR`, the tests, `check`, publishing or tagging, and handing the install to the deployment as a task. It names this document for every field and bound, and repeats none.
- Before 1.0 the plugin API moves with the console's line; `pluginApi` is raised when the contract breaks, and the console names the majors it serves; a plugin is rebuilt against the console it runs on, with no floor between them. The generic routes and the command are in the REST snapshot, so an addition stays an addition.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PLUGINS_DIR` | unset | the directory of the installed plugins; unset, the console has no plugins, spawns no host and answers `GET /api/v1/plugins` with none |
| `PLUGIN_FILE_BYTES_AT_MOST` | unset | the bytes a plugin's files may hold together; unset, no bound |
| `PLUGIN_MEMORY_MB_AT_MOST` | 256 | the memory a plugin's thread may hold |

Plugin pages need `PUBLIC_URL`, as signing in does. The image installs plugins thus ([deploy/README.md](../../deploy/README.md), "Plugins in the image", once written):

```dockerfile
FROM <the console image>
USER root
COPY plugins/package.json plugins/package-lock.json /app/plugins/
RUN cd /app/plugins && npm ci --omit=dev --ignore-scripts
USER node
ENV PLUGINS_DIR=/app/plugins
```
