# ADR-0043: The REST contract is held to a snapshot taken at the floors

- Status: Accepted
- Date: 2026-10-30
- Fulfils point 4 of [ADR-0038](0038-the-command-and-the-console-go-together-within-a-line-and-a-release-that-changes-what-passes-between-them-raises-the-floors.md), which stands otherwise. The contract is in [specs/rest.md](../specs/rest.md).

## Context

Within a line of SkillCDN the command and the console go together whatever the patch, and a release that changes what passes between them raises the floor of the side it breaks for (ADR-0038). `pnpm check` held the floors to the line and to the version the pending changesets make, and nothing held the contract to the floors: a field removed from an answer, or made required of a request, shipped as a patch if its author forgot the floor, and an older command then failed on an answer it could not read, which it reported but could not mend. ADR-0038 left a snapshot of the schemas for when the need came; the public console, where agents of several organizations run commands of several ages, is the need.

## Decision

1. **The contract is every `rest*Schema` of the package, as JSON Schema.** `scripts/check-rest-compat.mjs` reads the built package, writes each schema with `z.toJSONSchema`, as the console answers it (`output`) or takes it (`input`: the schemas named `…InputSchema` and `…PatchSchema`), and keeps them in `scripts/rest-schemas.snapshot.json` with the floors they were taken at, `CLIENT_POLICY.atLeast` and `CONSOLE_AT_LEAST`. The snapshot is tracked, and generated only by `pnpm snapshot:rest`.
2. **`pnpm check` compares the schemas as built with the snapshot, after the build, and fails on what breaks.** What an older command reads breaks when a field goes or is no longer always there, may be null where it was not, changes its kind, gains a value of an enum or a member of a union, or admits what the older reader's bounds refuse. What an older command sends breaks when a field goes or becomes required, stops taking null, changes its kind, loses a value or a member, or narrows its bounds. An addition passes, since the other side ignores it; a whole schema added passes too. The check names each break and what to do: raise the floor of the side it breaks for, with a changeset that begins with `Breaking:`, or undo the change.
3. **When a floor moves, the snapshot is taken again in the same change.** The snapshot records the floors it was taken at; floors in `compat.ts` that differ from them fail the check until `pnpm snapshot:rest` is run, so a breaking release carries the new contract as the baseline for the next, and the diff of the snapshot shows in review what the release broke.
4. **What the snapshot does not hold.** A field added to a request that the command relies on the console answering is not a break in the schemas and is not caught: that floor, `CONSOLE_AT_LEAST`, stays a matter of the author's care, as ADR-0038 has it. Nor is a change of meaning behind an unchanged shape. A snapshot taken again without a floor moved hides a break; it shows in review as a change to a generated file beside none to `compat.ts`.

## Consequences

- A forgotten floor fails `pnpm check` on the author's machine and in CI, with the field named, instead of failing an agent's command after the deploy.
- A breaking release costs its author one more command, `pnpm snapshot:rest`, and the review one more file; a patch that changes nothing the command reads or sends costs nothing, as before.
- The snapshot is large and generated: Biome does not format it, and nobody edits it by hand.
- Rejected: comparing TypeScript types (what passes is JSON, and the schemas are what both sides parse); a snapshot of example answers (a sample shows one shape, a schema every one); failing on every change including additions (ADR-0038 says additions are ignored, and the check would then be noise).
