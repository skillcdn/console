import { and, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Finding a thing by the words of its title, as a picker or a command searches a listing: each
// word a substring of the title, whatever the case, in any order. The words are what a person
// typed, bounded at the edge; here they are made safe for `like` and nothing else.

/** The characters `like` reads as patterns, escaped, so that a word is matched as it is. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The words of a query, as typed, with the spaces between them gone. */
export function wordsOf(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * On the row being read: whether `column` holds every word of `query`, whatever the case. A
 * query with no word matches everything.
 */
export function titleMatches(column: AnyPgColumn, query: string): SQL {
  const conditions = wordsOf(query).map(
    (word) => sql`lower(${column}) like ${`%${escapeLike(word.toLowerCase())}%`} escape '\\'`,
  );
  return conditions.length === 0 ? sql`true` : (and(...conditions) as SQL);
}
