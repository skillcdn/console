import type { RestAgentState } from "./schemas.js";

// How an agent account stands (ADR-0085), as the pages and the command read it: the state has
// a moment, since when it stands, and the reason may have another, when it was said. A reason
// changes under a state that stays, a turn completes or a new conversation begins while the
// agent runs on, so the one is never shown as the other's.

/**
 * How far apart the two moments are before the reason's is shown beside it: a reason said
 * within a minute of its state is the state's own, and the pages show a moment to the minute.
 * The runner's clock and the console's are two machines', a few seconds apart.
 */
const OWN_MOMENT_MS = 60_000;

/**
 * When the reason was said, where that is a moment of its own to show beside it: one the
 * console keeps, and another than the state's. A reason that came with its state is of the
 * state's moment, which stands with the state; one of before the console kept such a moment
 * has none. Either is shown without one, and never beside the state's as if it were its own.
 */
export function reasonMoment(
  state: Pick<RestAgentState, "since" | "reasonAt">,
): string | undefined {
  const at = state.reasonAt ?? undefined;
  if (at === undefined) {
    return undefined;
  }
  const said = Date.parse(at);
  const since = Date.parse(state.since);
  return Number.isNaN(said) || Number.isNaN(since) || Math.abs(said - since) < OWN_MOMENT_MS
    ? undefined
    : at;
}
