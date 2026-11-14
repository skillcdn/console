---
"@skillcdn/console": patch
---

A plugin's `secret` setting may keep one value per key (ADR-0111), for a token per installation of a service: one per workspace an app is installed in, say. Declare it with `keyed: { max }` (1 to 1,000 keys). A key is letters, digits, `_` and `-`, up to 64, and no secret.

- **Sealing:** `ctx.fetch`'s `seal` takes `key`, a path into the same answer (`$.team.id`) or the key itself. Two outcomes are new, and in both the value is withheld: `no_key` (the answer holds no key there) and `too_many` (a new key past `max`).
- **Placing:** `secret: { name, key, as }` puts one key's value into a request.
- **`ctx.secrets`:** `has` and `status` take a key. New: `keys(name)`, `forget(name, key)`, and `move(name, key)`, which puts the value kept from before the setting was keyed under a key, for an upgrade.
- **For an administrator:** the settings page, `console plugin <key> settings`, `PUT` and `DELETE /api/v1/plugins/<key>/secrets/<name>/keys/<key>`, and `console plugin <key> secret <name> --key <key>` list a keyed secret's keys and set or remove one at a time.
- **Records and tests:** `plugin.configured` names the key as `under`. `createTestContext` takes a keyed secret's values by key.
