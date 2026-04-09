const KNOWN_OPERATORS = new Set(["type", "tag", "source", "ext"]);
const OPERATOR_RE = /\[([^\]]+)\]/g;

/**
 * @typedef {{ filters: Array<{key: string, value: string}>, freeText: string }} ParsedQuery
 */

/**
 * Parse a query string into structured operator filters and free-text remainder.
 *
 * Supported operators (case-insensitive):
 *   [type:image]          — matches IndexEntry.type
 *   [tag:npc]             — matches autoTags or userTags
 *   [source:module:pf2e]  — substring match against IndexEntry.source
 *   [ext:webp]            — matches file extension
 *
 * Unknown operators (e.g. [foo:bar]) are left in the free-text portion unchanged.
 *
 * @param {string} query
 * @returns {ParsedQuery}
 */
export function parseQuery(query) {
  const filters = [];
  const freeText = query
    .replace(OPERATOR_RE, (match, inner) => {
      const colonIdx = inner.indexOf(":");
      if (colonIdx < 1) return match; // no key — keep as free text
      const key = inner.slice(0, colonIdx).trim().toLowerCase();
      const value = inner.slice(colonIdx + 1).trim().toLowerCase();
      if (!KNOWN_OPERATORS.has(key) || !value) return match; // unknown — keep as free text
      filters.push({ key, value });
      return " "; // remove matched operator from free text
    })
    .trim()
    .replace(/\s+/g, " ");

  return { filters, freeText };
}
