---
"@skillcdn/console": patch
---

A console of this version runs a plugin's `upgrades` with `ctx`, as a job has it: the `migrate` role refused them every call, so that no upgrade that read its records ever went through, and the install stayed at the data version it had. A plugin whose records are behind its code says so in `problems`, which `console plugins` prints; it is loaded all the same. The skill `building-a-plugin` (1.8) says what an upgrade reaches, and that the code reads a record of the version before as well.
