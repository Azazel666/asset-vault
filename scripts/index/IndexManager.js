import { IndexStore } from "./IndexStore.js";
import { Scanner } from "./Scanner.js";
import { createEntry, typeFromPath } from "./IndexEntry.js";
import { generateTags } from "./AutoTagger.js";
import { SearchEngine } from "../search/SearchEngine.js";

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
  #search = new SearchEngine();

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
      if (found) this.#search.update(this.#store.getHaystack(), this.#store.getEntries());
    } catch(err) {
      console.error("Asset Vault | IndexManager.initialize failed:", err);
      this.status = "error";
    }
  }

  /* -------------------------------------------- */
  /*  Rebuild                                     */
  /* -------------------------------------------- */

  /**
   * Full rescan of all configured locations.
   * Runs asynchronously — does not block the caller.
   * @returns {Promise<void>}
   */
  async rebuild() {
    this.status = "building";
    this.progress = 0;
    Hooks.callAll("assetVault.indexStatus", "building");

    try {
      const locations = this.#resolveLocations();
      console.log(`Asset Vault | Starting rebuild across ${locations.length} location(s)...`);

      const scanner = new Scanner({
        onProgress: (dirsScanned, currentPath) => {
          console.log(`Asset Vault | Scanning dir #${dirsScanned}: ${currentPath}`);
        }
      });

      const found = await scanner.scan(locations);
      console.log(`Asset Vault | Scanner found ${found.length} file(s)`);

      const entries = found.map(({ filePath, sourceKey }) =>
        createEntry(filePath, {
          type: typeFromPath(filePath),
          source: sourceKey,
          autoTags: generateTags(filePath, sourceKey)
        })
      );

      this.#store.clear();
      this.#store.addEntries(entries);
      await this.#store.save();

      this.#search.update(this.#store.getHaystack(), this.#store.getEntries());
      this.status = "ready";
      this.progress = 100;
      console.log(`Asset Vault | Rebuild complete: ${entries.length} entries indexed`);
      Hooks.callAll("assetVault.indexStatus", "ready");
    } catch(err) {
      console.error("Asset Vault | IndexManager.rebuild failed:", err);
      this.status = "error";
      Hooks.callAll("assetVault.indexStatus", "error");
    }
  }

  /* -------------------------------------------- */
  /*  Location resolution                         */
  /* -------------------------------------------- */

  /**
   * Build the list of {path, sourceKey} objects to scan based on the
   * scanLocations setting.  When the setting is empty (first run), all
   * four default categories are enabled.
   * @returns {Array<{path: string, sourceKey: string}>}
   */
  #resolveLocations() {
    const raw = game.settings.get("asset-vault", "scanLocations");
    const setting = (raw && typeof raw === "object") ? raw : {};
    const isDefault = Object.keys(setting).length === 0;
    const get = (key, def) => isDefault ? def : (setting[key] ?? false);

    const locations = [];

    // Current world — always included
    locations.push({ path: `worlds/${game.world.id}`, sourceKey: "world:current" });

    // Active system
    if (game.system && get(`system:${game.system.id}`, true)) {
      locations.push({ path: `systems/${game.system.id}`, sourceKey: `system:${game.system.id}` });
    }

    // Active modules — single toggle covers all of them
    if (get("indexActiveModules", true)) {
      for (const mod of game.modules.values()) {
        if (!mod.active || mod.id === "asset-vault") continue;
        locations.push({ path: `modules/${mod.id}`, sourceKey: `module:${mod.id}` });
      }
    }

    // Global assets folder
    if (get("assets", true)) {
      locations.push({ path: "assets", sourceKey: "assets" });
    }

    // Other worlds (any "world:<id>" key that is enabled, excluding current)
    for (const [key, enabled] of Object.entries(setting)) {
      if (!key.startsWith("world:") || key === "world:current") continue;
      if (!enabled) continue;
      const worldId = key.slice(6);
      if (worldId !== game.world.id) {
        locations.push({ path: `worlds/${worldId}`, sourceKey: `world:${worldId}` });
      }
    }

    // Other root folders (any "folder:<name>" key that is enabled)
    for (const [key, enabled] of Object.entries(setting)) {
      if (!key.startsWith("folder:")) continue;
      if (!enabled) continue;
      const folder = key.slice(7);
      locations.push({ path: folder, sourceKey: `folder:${folder}` });
    }

    return locations;
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

  /**
   * Fuzzy-search the index. Returns entries sorted by relevance.
   * Returns an empty array when the index is not ready or query is empty.
   * @param {string} query
   * @returns {import("./IndexEntry.js").IndexEntry[]}
   */
  search(query) {
    if (this.status !== "ready") return [];
    return this.#search.search(query);
  }

  get size() {
    return this.#store.size;
  }

  /* -------------------------------------------- */
  /*  Write API                                   */
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
