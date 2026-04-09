import { IndexStore } from "./IndexStore.js";

/**
 * Singleton index manager attached to `game.assetVault.index`.
 * Orchestrates loading, rebuilding, and querying the asset index.
 */
export class IndexManager {
  /** @type {"none"|"building"|"ready"|"error"} */
  status = "none";

  /** @type {number} 0–100 during a rebuild */
  progress = 0;

  #store = new IndexStore();

  /* -------------------------------------------- */
  /*  Initialisation                              */
  /* -------------------------------------------- */

  /**
   * Load the existing index from disk.
   * Sets status to "ready" if an index was found, "none" otherwise.
   * Called once in the "ready" hook.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const found = await this.#store.load();
      this.status = found ? "ready" : "none";
    } catch(err) {
      console.error("Asset Vault | IndexManager.initialize failed:", err);
      this.status = "error";
    }
  }

  /* -------------------------------------------- */
  /*  Rebuild (implemented in Iteration 9)        */
  /* -------------------------------------------- */

  /**
   * Full rescan of all configured locations. Stub for Iteration 9.
   * @returns {Promise<void>}
   */
  async rebuild() {
    this.status = "building";
    this.progress = 0;
    // Scanner implementation added in Iteration 9
    this.status = "ready";
    this.progress = 100;
  }

  /* -------------------------------------------- */
  /*  Query API                                   */
  /* -------------------------------------------- */

  /** @returns {import("./IndexEntry.js").IndexEntry[]} */
  getEntries() {
    return this.#store.getEntries();
  }

  /** @param {string} path @returns {import("./IndexEntry.js").IndexEntry|undefined} */
  getEntry(path) {
    return this.#store.getEntry(path);
  }

  /**
   * Haystack string array for uFuzzy — one string per entry.
   * @returns {string[]}
   */
  getHaystack() {
    return this.#store.getHaystack();
  }

  get size() {
    return this.#store.size;
  }

  /* -------------------------------------------- */
  /*  Write API (used by Scanner in Iteration 9)  */
  /* -------------------------------------------- */

  /** @param {import("./IndexEntry.js").IndexEntry[]} entries */
  addEntries(entries) {
    this.#store.addEntries(entries);
  }

  /** @param {string[]} paths */
  removeEntries(paths) {
    this.#store.removeEntries(paths);
  }

  async save() {
    await this.#store.save();
  }
}
