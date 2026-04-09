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
   * Returns an empty array for an empty query or if no results found.
   * @param {string} query
   * @returns {import("../index/IndexEntry.js").IndexEntry[]}
   */
  search(query) {
    if (!query || !query.trim() || this.#haystack.length === 0) return [];

    const [idxs, info, order] = uf.search(this.#haystack, query.trim());
    if (!idxs || idxs.length === 0) return [];

    // order is the relevance-sorted permutation of idxs
    const sorted = order ?? Array.from({ length: idxs.length }, (_, i) => i);
    return sorted.map(i => this.#entries[idxs[i]]).filter(Boolean);
  }

  get size() {
    return this.#haystack.length;
  }
}
