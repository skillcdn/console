import { createHash } from "node:crypto";
import type { Clock } from "../ports/clock.js";
import type { PictureRefusal, PictureSource } from "../ports/picture-source.js";

// The pictures from elsewhere this process has fetched (ADR-0048), kept in memory a while so
// that a picture on a board is fetched once for everyone who looks, not once per look: served
// as is while fresh, asked after again with what the origin said it was once stale, kept and
// served when the origin cannot be reached, and let go of oldest first when the room is full.
// A refusal is kept a short while too, so that a dead link costs one try in a while. One
// fetch at a time per address: whoever asks meanwhile waits for it.

export interface PictureCacheOptions {
  readonly source: PictureSource;
  readonly clock: Clock;
  /** How many bytes of pictures are kept in all, and how large one may be. */
  readonly maxBytes: number;
  readonly maxEntryBytes: number;
  /** How long a picture is served without asking the origin again. */
  readonly freshMs: number;
  /** How long a picture is still served when the origin cannot be reached or answers an error. */
  readonly staleMs: number;
  /** How long a refusal is kept before the address is tried again. */
  readonly refusedMs: number;
}

export interface CachedPicture {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** The SHA-256 of the bytes, in hex: what the browser is told the picture is. */
  readonly sha256: string;
}

export type PictureAnswer =
  | { readonly kind: "picture"; readonly picture: CachedPicture }
  | { readonly kind: "refused"; readonly reason: PictureRefusal };

interface Entry {
  picture: CachedPicture | undefined;
  reason: PictureRefusal | undefined;
  etag: string | undefined;
  lastModified: string | undefined;
  /** When the bytes were fetched or found unchanged. */
  fetchedAt: number;
  /** When the origin was last asked, whatever it answered. */
  checkedAt: number;
  size: number;
}

/** The refusals after which a picture kept is still served, since the origin may be back soon. */
const PASSING = new Set<PictureRefusal>(["unreachable", "upstream"]);

export class PictureCache {
  readonly #options: PictureCacheOptions;
  /** By address, in the order last used: the first is the oldest. */
  readonly #entries = new Map<string, Entry>();
  readonly #inFlight = new Map<string, Promise<PictureAnswer>>();
  #bytes = 0;

  constructor(options: PictureCacheOptions) {
    this.#options = options;
  }

  /** How many bytes of pictures are kept now. */
  get bytes(): number {
    return this.#bytes;
  }

  /** How many addresses are kept, pictures and refusals. */
  get size(): number {
    return this.#entries.size;
  }

  /** The picture at an address, fetched now or kept, or why it is not served. */
  async get(url: string): Promise<PictureAnswer> {
    const now = this.#options.clock.now().getTime();
    const entry = this.#entries.get(url);
    if (entry !== undefined) {
      const since = now - entry.checkedAt;
      if (entry.picture !== undefined && since < this.#options.freshMs) {
        this.#touch(url, entry);
        return { kind: "picture", picture: entry.picture };
      }
      if (
        entry.picture === undefined &&
        entry.reason !== undefined &&
        since < this.#options.refusedMs
      ) {
        return { kind: "refused", reason: entry.reason };
      }
    }
    const pending = this.#inFlight.get(url);
    if (pending !== undefined) {
      return pending;
    }
    const fetching = this.#fetch(url, entry, now).finally(() => this.#inFlight.delete(url));
    this.#inFlight.set(url, fetching);
    return fetching;
  }

  async #fetch(url: string, kept: Entry | undefined, now: number): Promise<PictureAnswer> {
    const fetched = await this.#options.source.fetch({
      url,
      etag: kept?.picture === undefined ? undefined : kept.etag,
      lastModified: kept?.picture === undefined ? undefined : kept.lastModified,
    });
    if (fetched.kind === "picture") {
      if (fetched.bytes.byteLength > this.#options.maxEntryBytes) {
        return this.#refuse(url, "too_large", now);
      }
      const picture: CachedPicture = {
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        sha256: createHash("sha256").update(fetched.bytes).digest("hex"),
      };
      this.#store(url, {
        picture,
        reason: undefined,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchedAt: now,
        checkedAt: now,
        size: fetched.bytes.byteLength,
      });
      return { kind: "picture", picture };
    }
    if (fetched.kind === "unchanged" && kept?.picture !== undefined) {
      kept.fetchedAt = now;
      kept.checkedAt = now;
      this.#touch(url, kept);
      return { kind: "picture", picture: kept.picture };
    }
    const reason: PictureRefusal = fetched.kind === "refused" ? fetched.reason : "upstream";
    if (
      kept?.picture !== undefined &&
      PASSING.has(reason) &&
      now - kept.fetchedAt < this.#options.staleMs
    ) {
      // The origin is away for the while; what was fetched stands, and is asked after again later.
      kept.checkedAt = now;
      this.#touch(url, kept);
      return { kind: "picture", picture: kept.picture };
    }
    return this.#refuse(url, reason, now);
  }

  #refuse(url: string, reason: PictureRefusal, now: number): PictureAnswer {
    this.#store(url, {
      picture: undefined,
      reason,
      etag: undefined,
      lastModified: undefined,
      fetchedAt: now,
      checkedAt: now,
      size: 0,
    });
    return { kind: "refused", reason };
  }

  /** Keeps an entry as the newest, making room by letting the oldest go. */
  #store(url: string, entry: Entry): void {
    this.#drop(url);
    this.#entries.set(url, entry);
    this.#bytes += entry.size;
    for (const [oldest, held] of this.#entries) {
      if (this.#bytes <= this.#options.maxBytes) {
        break;
      }
      if (oldest === url) {
        continue;
      }
      this.#entries.delete(oldest);
      this.#bytes -= held.size;
    }
  }

  #drop(url: string): void {
    const held = this.#entries.get(url);
    if (held !== undefined) {
      this.#entries.delete(url);
      this.#bytes -= held.size;
    }
  }

  /** Marks an entry as the newest. */
  #touch(url: string, entry: Entry): void {
    this.#entries.delete(url);
    this.#entries.set(url, entry);
  }
}
