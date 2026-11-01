# ADR-0051: A plugin keeps its data in records the console holds, or in a schema of its own by consent

- Status: Accepted
- Date: 2026-11-01

## Context

A plugin has data: requests, customers, transactions. Handing a plugin the console's database would hand it every table, and its removal would be a hunt; handing it nothing would make every plugin keep its state elsewhere. Two kinds of plugin exist: most keep documents with a few fields to filter on and want search, history, files and links for free; some run relational queries over many rows and want SQL.

## Decision

1. **Records by default.** Every plugin has collections, declared in its server module with a schema, the fields that may be filtered and ordered, the fields searched, whether a record links to a project, and which roles read the collection or their own records in it. The console keeps them in tables of its own (`plugin_records`, with versions, files and links), bounds size and quota, keeps a version per write, attaches files through the blob store, indexes the searched fields as it does documents, and answers aggregates over the filterable fields. Reads are decided at the edge as everything is: the roles the collection names, a person's own records, and a project link only where the person may see the project. Writes happen in plugin code alone, through commands ([ADR-0053](0053-agents-reach-a-plugin-through-one-command-whose-definitions-the-console-holds.md)).
2. **A schema of its own, by consent: `storage:sql`.** A plugin that declares the capability, and whose administrator consents, receives when enabled a PostgreSQL schema `plugin_<key>` and a login role `plugin_<key>` with rights on that schema alone, whose password the console draws anew at every boot and keeps nowhere. The plugin's SQL migrations ship in its package and are applied by the `migrate` role as the plugin's role under the console's migration lock; `ctx.sql` runs the plugin's statements on a pool of the plugin's role, with a statement timeout, a connection limit and a bound on what a result returns. The console's own database user needs the right to create roles; a deployment whose user lacks it shows the capability as unavailable, and a plugin that requires it is not enabled there.
3. **Removal is complete either way.** Purging a plugin deletes its records, versions, files, links, settings, secrets and grants, and drops its schema and its role. What it put on the board stays, marked as its ([ADR-0052](0052-a-plugins-board-is-a-project-made-or-chosen-when-it-is-enabled-and-what-it-puts-there-carries-its-name.md)).
4. **Never the console's tables.** No capability reads or writes the console's own tables: the plugin's role holds no right on `public`, and `ctx.sql` runs on that role and no other.

## Consequences

- Most plugins write no SQL and get search, history, files, links, export and quotas by declaring collections; a heavy plugin has SQL within a fence, and may move a collection there when it outgrows records.
- With SQL, who sees what inside the schema is the plugin's to enforce in its queries; `ctx` tells it who asks and what they may see.
- Rejected: records alone (a ceiling on what a plugin can be); SQL on the console's own connection (no boundary, no clean removal); `SET ROLE` on the console's connection in place of a login role (undone by `RESET ROLE`); a database per plugin (against one database, [ADR-0002](0002-one-image-one-database-and-the-main-repositorys-toolchain.md)).
