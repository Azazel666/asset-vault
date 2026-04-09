import { IndexStore } from "./IndexStore.js";
import { Scanner } from "./Scanner.js";
import { createEntry, typeFromPath } from "./IndexEntry.js";
import { generateTags } from "./AutoTagger.js";

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

      this.status = "ready";
      this.progress = 100;
      console.log(`Asset Vault | Rebuild complete: ${entries.length} entries indexed`);
    } catch(err) {
      console.error("Asset Vault | IndexManager.rebuild failed:", err);
      this.status = "error";
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
    const enabled = (key, def) => isDefault ? def : (setting[key] ?? false);

    const locations = [];

    // Current world
    if (enabled("world:current", true)) {
      locations.push({ path: `worlds/${game.world.id}`, sourceKey: "world:current" });
    }

    // Active system
    if (game.system && enabled(`system:${game.system.id}`, true)) {
      locations.push({ path: `systems/${game.system.id}`, sourceKey: `system:${game.system.id}` });
    }

    // Active modules (skip asset-vault itself)
    for (const mod of game.modules.values()) {
      if (!mod.active || mod.id === "asset-vault") continue;
      if (enabled(`module:${mod.id}`, true)) {
        locations.push({ path: `modules/${mod.id}`, sourceKey: `module:${mod.id}` });
      }
    }

    // Global assets folder
    if (enabled("assets", true)) {
      locations.push({ path: "assets", sourceKey: "assets" });
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
