import uFuzzy from "../vendor/uFuzzy.esm.js";
import { parseQuery } from "./QueryParser.js";

// intraSlice [start, end] — [1, Infinity] means first char must match exactly.
const _intraSlice = [1, Infinity];
const uf = new uFuzzy({
  intraMode: 1,
  // Allow single-char substitution for terms of 3+ chars (uFuzzy default disables
  // intraSub for terms shorter than 5 chars, which prevents "ece" from matching "eye").
  intraRules: p => {
    if (/^\d+$/.test(p) || p.length < 3) return { intraSlice: _intraSlice, intraIns: 0, intraSub: 0, intraTrn: 0, intraDel: 0 };
    if (p.length <= 4) return { intraSlice: _intraSlice, intraIns: p.length === 4 ? 1 : 0, intraSub: 1, intraTrn: 1, intraDel: 0 };
    return { intraSlice: _intraSlice, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 0 };
  }
});

/**
 * Wraps uFuzzy to search the asset index haystack.
 *
 * Search semantics:
 *   - [operator:value] tokens are extracted and AND-combined as pre-filters.
 *   - Remaining free text is fuzzy-searched against the filtered candidate set.
 *   - Comma-separated free-text terms are OR-combined.
 *   - Operators-only query returns filtered results sorted alphabetically.
 */
export class SearchEngine {
  /** @type {string[]} */
  #haystack = [];

  /** @type {import("../index/IndexEntry.js").IndexEntry[]} */
  #entries = [];

  /**
   * @param {string[]} haystack
   * @param {import("../index/IndexEntry.js").IndexEntry[]} entries
   */
  constructor(haystack = [], entries = []) {
    this.#haystack = haystack;
    this.#entries = entries;
  }

  /**
   * Replace the haystack and entries after a rebuild.
   * @param {string[]} haystack
   * @param {import("../index/IndexEntry.js").IndexEntry[]} entries
   */
  update(haystack, entries) {
    this.#haystack = haystack;
    this.#entries = entries;
  }

  /**
   * Search the index and return matching entries sorted by relevance.
   * Returns an empty array for an empty query or if no results found.
   * @param {string} query
   * @returns {import("../index/IndexEntry.js").IndexEntry[]}
   */
  search(query) {
    if (!query || !query.trim() || this.#haystack.length === 0) return [];

    const { filters, freeText } = parseQuery(query);

    // Build candidate set: full index or operator-filtered subset
    const candidates = filters.length === 0
      ? this.#entries.map((entry, i) => ({ entry, hay: this.#haystack[i] }))
      : this.#entries
          .map((entry, i) => ({ entry, hay: this.#haystack[i] }))
          .filter(({ entry }) => this.#matchesFilters(entry, filters));

    if (candidates.length === 0) return [];

    // Operators-only: return filtered set sorted alphabetically
    if (!freeText) {
      return candidates.map(c => c.entry)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Free-text: fuzzy-search against the candidate haystack
    // Comma-separated terms are OR-combined
    const tempHaystack = candidates.map(c => c.hay);
    const tempEntries  = candidates.map(c => c.entry);
    const terms = freeText.split(",").map(t => t.trim()).filter(Boolean);

    if (terms.length === 1) return this.#fuzzySearch(tempHaystack, tempEntries, terms[0]);

    const seen = new Set();
    const results = [];
    for (const term of terms) {
      for (const entry of this.#fuzzySearch(tempHaystack, tempEntries, term)) {
        if (!seen.has(entry.path)) {
          seen.add(entry.path);
          results.push(entry);
        }
      }
    }
    return results;
  }

  /* -------------------------------------------- */
  /*  Private helpers                             */
  /* -------------------------------------------- */

  /**
   * @param {import("../index/IndexEntry.js").IndexEntry} entry
   * @param {Array<{key:string, value:string}>} filters
   * @returns {boolean}
   */
  #matchesFilters(entry, filters) {
    for (const { key, value } of filters) {
      switch (key) {
        case "type":
          if (entry.type !== value) return false;
          break;
        case "tag": {
          const allTags = [...entry.autoTags, ...entry.userTags];
          if (!allTags.includes(value)) return false;
          break;
        }
        case "source":
          if (!entry.source.toLowerCase().includes(value)) return false;
          break;
        case "ext":
          if (!entry.path.toLowerCase().endsWith(`.${value}`)) return false;
          break;
        default:
          break;
      }
    }
    return true;
  }

  /**
   * @param {string[]} haystack
   * @param {import("../index/IndexEntry.js").IndexEntry[]} entries
   * @param {string} term
   * @returns {import("../index/IndexEntry.js").IndexEntry[]}
   */
  #fuzzySearch(haystack, entries, term) {
    if (!term || haystack.length === 0) return [];
    const [idxs, , order] = uf.search(haystack, term);
    if (!idxs || idxs.length === 0) return [];
    const sorted = order ?? Array.from({ length: idxs.length }, (_, i) => i);
    return sorted.map(i => entries[idxs[i]]).filter(Boolean);
  }

  get size() {
    return this.#haystack.length;
  }
}
