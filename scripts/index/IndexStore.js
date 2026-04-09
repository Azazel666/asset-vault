const { FilePicker } = foundry.applications.apps;

const INDEX_VERSION = 1;

export class IndexStore {
  /** @type {Map<string, import("./IndexEntry.js").IndexEntry>} */
  #entries = new Map();

  get #dirPath() {
    return `worlds/${game.world.id}/asset-vault`;
  }

  get #filePath() {
    return `${this.#dirPath}/index.json`;
  }

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Load the index from disk. Returns true if an existing index was found,
   * false if no file exists yet (empty index).
   * @returns {Promise<boolean>}
   */
  async load() {
    try {
      // Check directory listing first — avoids a 404 network error in the console
      const result = await FilePicker.browse("data", this.#dirPath);
      const exists = result.files.some(f => f === this.#filePath || f.endsWith("/index.json"));
      if (!exists) return false;

      const response = await fetch(`/${this.#filePath}`);
      if (!response.ok) return false;
      const data = await response.json();
      if (!Array.isArray(data.entries)) return false;
      this.#entries = new Map(data.entries.map(e => [e.path, e]));
      console.log(`Asset Vault | Loaded index: ${this.#entries.size} entries`);
      return true;
    } catch {
      // Directory doesn't exist yet — clean first run
      return false;
    }
  }

  /**
   * Write the current entries to disk as index.json.
   * Creates the asset-vault directory under the world folder if needed.
   * @returns {Promise<void>}
   */
  async save() {
    await this.#ensureDir();
    const json = JSON.stringify({
      version: INDEX_VERSION,
      savedAt: Date.now(),
      entries: Array.from(this.#entries.values())
    }, null, 0);
    const file = new File([json], "index.json", { type: "application/json" });
    const result = await FilePicker.upload("data", this.#dirPath, file, {}, { notify: false });
    if (!result || result === false) {
      throw new Error(`Asset Vault | FilePicker.upload returned failure for "${this.#dirPath}/index.json"`);
    }
    console.log(`Asset Vault | Saved index: ${this.#entries.size} entries`);
  }

  /* -------------------------------------------- */
  /*  Entry access                                */
  /* -------------------------------------------- */

  /** @returns {IndexEntry[]} */
  getEntries() {
    return Array.from(this.#entries.values());
  }

  /** @param {string} path @returns {IndexEntry|undefined} */
  getEntry(path) {
    return this.#entries.get(path);
  }

  /**
   * Build the haystack string array used by uFuzzy.
   * One string per entry: "filename tag1 tag2 ..."
   * @returns {string[]}
   */
  getHaystack() {
    return Array.from(this.#entries.values()).map(entry => {
      const tags = [...entry.autoTags, ...entry.userTags].join(" ");
      return tags ? `${entry.name} ${tags}` : entry.name;
    });
  }

  /**
   * Merge new or updated entries into the index (does not save to disk).
   * @param {IndexEntry[]} entries
   */
  addEntries(entries) {
    for (const entry of entries) {
      this.#entries.set(entry.path, entry);
    }
  }

  /**
   * Remove entries by path (does not save to disk).
   * @param {string[]} paths
   */
  removeEntries(paths) {
    for (const path of paths) {
      this.#entries.delete(path);
    }
  }

  /** Remove all entries without saving. */
  clear() {
    this.#entries.clear();
  }

  get size() {
    return this.#entries.size;
  }

  /* -------------------------------------------- */
  /*  Private                                     */
  /* -------------------------------------------- */

  async #ensureDir() {
    try {
      await FilePicker.browse("data", this.#dirPath);
    } catch {
      // Directory doesn't exist — create it
      try {
        await FilePicker.createDirectory("data", this.#dirPath);
      } catch(err) {
        // May already exist in a race condition; log and continue
        console.warn(`Asset Vault | Could not create directory "${this.#dirPath}": ${err.message}`);
      }
    }
  }
}
