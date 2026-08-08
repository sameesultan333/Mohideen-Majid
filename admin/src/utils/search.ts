/**
 * Forgiving text search for list filters.
 *
 * Real data is messy: "S.A. Mohideen Arif (A1 Hardwares)", "98419 74095",
 * "MM-CH-202601-000001". Typing what you see should find it, so both the query
 * and the searched fields are reduced to letters and digits only. That makes
 * the match case-insensitive, space-insensitive and punctuation-insensitive:
 *
 *   "sa mohideen"  -> matches "S.A. Mohideen Arif"
 *   "98419 74095"  -> matches "9841974095"
 *   "a1hardwares"  -> matches "(A1 Hardwares)"
 *
 * Each whitespace-separated token must match, in any order, so "arif mohideen"
 * finds "Mohideen Arif" too. Tokens never match across two different fields, so
 * a name and a phone number are not silently concatenated.
 *
 * Letters outside A-Z are preserved via \p{L}, so Tamil names still match.
 */

const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/** Lowercase and strip everything that is not a letter or digit. */
export function normalizeSearch(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().replace(NON_ALPHANUMERIC, "");
}

/** Split a raw query into normalized tokens, dropping empties. */
export function searchTokens(query: string): string[] {
  return query.split(/\s+/).map(normalizeSearch).filter(Boolean);
}

// Normalized fields contain no spaces, so joining them with one stops a token
// from straddling two fields.
function haystackOf(fields: unknown[]): string {
  return fields.map(normalizeSearch).join(" ");
}

/**
 * True when every token in `query` appears in at least one of `fields`.
 * An empty or whitespace-only query matches everything.
 */
export function matchesSearch(query: string, ...fields: unknown[]): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = haystackOf(fields);
  return tokens.every(token => haystack.includes(token));
}

/**
 * Pre-built matcher for filtering a list: normalizes the query once instead of
 * once per row. Returns a predicate to call with each row's fields.
 */
export function makeSearchMatcher(query: string): (...fields: unknown[]) => boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return () => true;
  return (...fields: unknown[]) => {
    const haystack = haystackOf(fields);
    return tokens.every(token => haystack.includes(token));
  };
}
