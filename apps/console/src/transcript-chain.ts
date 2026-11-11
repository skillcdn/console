import { createHash } from "node:crypto";

// The chain a session's events are held by (ADR-0090): every event has a digest of what it
// holds, and the session keeps the head of the chain its digests fold to, in the row that stays
// when the month is put away. A month that comes back is checked against it: an event changed,
// taken out, put in or moved leaves another head. Pure: what is hashed is said here once, for
// whoever appends and whoever checks.

/** The form a digest is taken of: raised when what is hashed changes, so that an older event is still read by its own. */
export const CHAIN_FORM = 1;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A fact of an event, as its row keeps one. */
type Fact = string | number | boolean | null;

/** What of an event is hashed: what its row keeps, and nothing of when the console received it. */
export interface ChainedEvent {
  readonly sessionId: string;
  readonly n: number;
  readonly kind: string;
  readonly at: Date;
  /** The text as the row keeps it: the whole of a short one, the beginning of a long one. */
  readonly text: string;
  /** The hash and the size of the whole of a long text, which is kept apart; nothing for a short one. */
  readonly textSha256: string | null;
  readonly textSize: number | null;
  readonly data: Readonly<Record<string, Fact>>;
  readonly files: readonly {
    readonly id: string;
    readonly name: string;
    readonly size: number;
    readonly contentType: string;
    readonly sha256: string;
  }[];
}

/**
 * The digest of an event: of its place in its session, what it is, when it happened, its text,
 * its facts in the order of their names, and its pictures by their own hashes. The bytes of a
 * long text and of a picture are not read: they are named by their hashes, which are hashed.
 */
export function eventDigest(event: ChainedEvent): string {
  return sha256(
    JSON.stringify([
      "event",
      CHAIN_FORM,
      event.sessionId,
      event.n,
      event.kind,
      event.at.toISOString(),
      sha256(event.text),
      event.textSha256,
      event.textSize,
      Object.keys(event.data)
        .sort()
        .map((name) => [name, event.data[name] ?? null]),
      event.files.map((file) => [file.id, file.name, file.size, file.contentType, file.sha256]),
    ]),
  );
}

/** Where a session's chain begins: at the session itself, so that no two sessions share a chain. */
export function chainStart(sessionId: string): string {
  return sha256(JSON.stringify(["session", CHAIN_FORM, sessionId]));
}

/** The chain one event on: the chain before it and the event's digest, folded. */
export function chainNext(chain: string, digest: string): string {
  return sha256(`${chain}${digest}`);
}
