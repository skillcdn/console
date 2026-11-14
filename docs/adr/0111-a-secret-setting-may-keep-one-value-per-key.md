# ADR-0111: A secret setting may keep one value per key

- Status: Accepted
- Date: 2026-11-15
- Extends [ADR-0070](0070-a-secret-is-sealed-by-the-console-from-an-answer-and-goes-where-its-setting-says.md), whose consequences left "a secret of an unbounded number" for a task of its own, and [ADR-0075](0075-a-secret-never-comes-back-to-a-plugin-and-sealing-fails-closed.md), whose outcomes of a seal it adds to. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

A secret setting holds one value. A plugin that connects the console to a service installed in several places at once needs one value per place: a messenger whose one app is installed in several workspaces of a chat service is handed a bot token per installation, each sealed from the answer to that installation, the workspace named in the same answer. The other secrets of the app stay one each.

A plugin never holds a secret's value, so it cannot keep the tokens in its records. A setting per place is a number fixed by hand, and empty settings on the administrator's page. A setting and a secret per project copy a token that belongs to a workspace into each of its projects, and a request that names a workspace and no project would have to find it again.

## Decision

1. **A `secret` setting may say `keyed: { max }`.** It keeps one value per key, up to `max` keys (1 to 1,000). A key is letters, digits, `_` and `-`, up to 64; it is no secret, and a page, a command and the feed show it. A keyed secret is never `required`, since its values come and go with what each key stands for, and takes no `use`: it goes into requests and verifies nothing. `hosts` holds for every key.
2. **Sealed under a key.** A seal of a keyed secret names `key`: a path into the same answer (`$.team.id`) or the key itself. Everything ADR-0070 and ADR-0075 say of a seal holds. Two outcomes are added, and in both the value is withheld and nothing is sealed:
   - `no_key`: the answer holds no key at that path, or holds one not spelled as a key.
   - `too_many`: the key is new, and the secret already keeps `max` keys.

   A value that holds a secret the request carried is `echoed` unless it is the same setting under the same key.
3. **Used by its key.** A request names `secret: { name, key, as }`. A key given for a secret that keeps one value, or none given for a keyed one, is refused before the request goes out (`plugin.invalid_args`).
4. **What the plugin may do with its keys.**
   - `ctx.secrets.has(name, key)` and `status(name, key)` answer for one key, and without a key for the value the setting kept from before it was keyed.
   - `keys(name)` lists every key with how its value stands.
   - `forget(name, key)` removes a key whose installation is gone.
   - `move(name, key)` puts the value the setting kept from before it was keyed under a key, so that an upgrade keeps a token through the change. The value moves as it was sealed, never opened, and a new key past `max` is refused with the value left where it was.
   - `sign` and `verify` refuse a keyed secret.
5. **What an administrator sees and does.** The settings page lists each key with when and from where its value was set and when it expires, never the value. An administrator sets or removes one key at a time there, through `PUT` and `DELETE .../secrets/<name>/keys/<key>`, or with `console plugin <key> secret <name> --key <key>`. Every change is `plugin.configured`, its data naming the key as `under`.
6. **Kept apart.** The values are kept in `plugin_keyed_secrets`, keyed by the workspace, the plugin, the setting and the key, sealed as every plugin secret is. What a release before this one reads and writes of `plugin_secrets` stands unchanged.

## Consequences

- A messenger keeps one bot token per workspace it is installed in, sealed and placed by the console, and forgets one when the workspace removes the app.
- Several seals at once hold the bound under a lock per setting. A seal that loses the last place to another request between the count and the write is answered `too_many`, its value withheld, although the answer's mark says `"[sealed]"`.
- A setting changed from keyed back to one value leaves its keys unread until the plugin is purged.
- Rejected:
  - A key column added to `plugin_secrets`: its primary key would change under the upsert of the release before.
  - A number of fixed settings: a limit chosen by hand, and empty settings on the page.
  - A setting and a secret per project.
  - Keyed signing secrets: no plugin needs one yet.
