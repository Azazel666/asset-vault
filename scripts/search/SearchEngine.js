import uFuzzy from "../vendor/uFuzzy.esm.js";

const uf = new uFuzzy({ intraMode: 1 });

/**
 * Wraps uFuzzy to search the asset index haystack.
 *
 * Haystack: one string per entry — "filename tag1 tag2 ..."
 * Results are returned sorted by uFuzzy's relevance order.
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
   * Comma-separated terms are treated as OR: each term is searched
   * independently and results are merged (deduped, first-match order).
   * Returns an empty array for an empty query or if no results found.
   * @param {string} query
   * @returns {import("../index/IndexEntry.js").IndexEntry[]}
   */
  search(query) {
    if (!query || !query.trim() || this.#haystack.length === 0) return [];

    const terms = query.split(",").map(t => t.trim()).filter(Boolean);
    if (terms.length === 1) return this.#searchTerm(terms[0]);

    // Multi-term OR: merge results preserving first-occurrence order
    const seen = new Set();
    const results = [];
    for (const term of terms) {
      for (const entry of this.#searchTerm(term)) {
        if (!seen.has(entry.path)) {
          seen.add(entry.path);
          results.push(entry);
        }
      }
    }
    return results;
  }

  /**
   * @param {string} term  Single trimmed search term (no commas)
   * @returns {import("../index/IndexEntry.js").IndexEntry[]}
   */
  #searchTerm(term) {
    if (!term || this.#haystack.length === 0) return [];
    const [idxs, info, order] = uf.search(this.#haystack, term);
    if (!idxs || idxs.length === 0) return [];
    const sorted = order ?? Array.from({ length: idxs.length }, (_, i) => i);
    return sorted.map(i => this.#entries[idxs[i]]).filter(Boolean);
  }

  get size() {
    return this.#haystack.length;
  }
}
