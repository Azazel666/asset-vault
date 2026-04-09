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

  /** Debounced save — batches rapid uploads into a single disk write. */
  #saveDebounced = null;

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
    // Initialise the debounced save here so foundry.utils is available.
    this.#saveDebounced = foundry.utils.debounce(() => {
      this.#store.save().catch(err => console.error("Asset Vault | Debounced save failed:", err));
    }, 2000);

    // Listen for uploads made through the monkey-patched FilePicker.upload.
    Hooks.on("assetVault.fileUploaded", (source, dirPath, fileName) => {
      this.handleFileUploaded(source, dirPath, fileName);
    });

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

      // Preserve user-defined tags across rebuilds
      const savedUserTags = new Map(
        this.#store.getEntries()
          .filter(e => e.userTags.length > 0)
          .map(e => [e.path, e.userTags])
      );

      const entries = found.map(({ filePath, sourceKey }) =>
        createEntry(filePath, {
          type: typeFromPath(filePath),
          source: sourceKey,
          autoTags: generateTags(filePath, sourceKey),
          userTags: savedUserTags.get(filePath) ?? []
        })
      );

      // Add Font Awesome icon entries if enabled
      const rawSetting = game.settings.get("asset-vault", "scanLocations");
      const locSetting = (rawSetting && typeof rawSetting === "object") ? rawSetting : {};
      if (locSetting.indexFontAwesome) {
        const faEntries = await this.#buildFontAwesomeEntries(savedUserTags);
        entries.push(...faEntries);
      }

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
  /*  Font Awesome icon builder                   */
  /* -------------------------------------------- */

  /**
   * Load the trimmed FA icon metadata and create IndexEntry objects.
   * @param {Map<string,string[]>} savedUserTags
   * @returns {Promise<import("./IndexEntry.js").IndexEntry[]>}
   */
  async #buildFontAwesomeEntries(savedUserTags) {
    try {
      const response = await fetch("/modules/asset-vault/data/fa-icons.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const icons = await response.json();
      const entries = [];
      for (const [name, data] of Object.entries(icons)) {
        const primaryStyle = data.styles.includes("solid") ? "solid"
          : data.styles.includes("regular") ? "regular"
          : data.styles[0];
        const prefix = primaryStyle === "brands" ? "fa-brands"
          : primaryStyle === "regular" ? "fa-regular"
          : "fa-solid";
        const path = `${prefix} fa-${name}`;
        entries.push(createEntry(path, {
          name,
          type: "icon",
          source: "fontawesome",
          autoTags: ["icon", "fontawesome", ...data.terms],
          userTags: savedUserTags.get(path) ?? [],
          meta: { unicode: data.unicode, label: data.label }
        }));
      }
      console.log(`Asset Vault | Loaded ${entries.length} Font Awesome icon entries`);
      return entries;
    } catch(err) {
      console.error("Asset Vault | Failed to load Font Awesome icons:", err);
      return [];
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

  /**
   * Called when a file is successfully uploaded via FilePicker.upload().
   * Creates an index entry for the new file, updates the search engine,
   * and schedules a debounced save.
   * Non-media files (type "other") are silently skipped — this prevents
   * the module's own index.json writes from being self-indexed.
   * @param {string} source  - "data", "public", or "s3"
   * @param {string} dirPath - Directory path the file was uploaded to
   * @param {string} fileName - The uploaded file's name
   */
  handleFileUploaded(source, dirPath, fileName) {
    if (this.status !== "ready") return;

    const filePath = dirPath ? `${dirPath}/${fileName}` : fileName;
    const type = typeFromPath(filePath);
    if (type === "other") return; // skip json, txt, etc.

    const sourceKey = this.#sourceKeyForPath(filePath);
    const entry = createEntry(filePath, {
      type,
      source: sourceKey,
      autoTags: generateTags(filePath, sourceKey),
      userTags: this.#store.getEntry(filePath)?.userTags ?? []
    });

    this.#store.addEntries([entry]);
    this.#search.update(this.#store.getHaystack(), this.#store.getEntries());
    this.#saveDebounced();

    console.log(`Asset Vault | Indexed uploaded file: ${filePath}`);
    Hooks.callAll("assetVault.fileIndexed", filePath);
  }

  /**
   * Map a file path to its source key using the same rules as #resolveLocations.
   * @param {string} filePath
   * @returns {string}
   */
  #sourceKeyForPath(filePath) {
    const worldPrefix = `worlds/${game.world.id}/`;
    if (filePath.startsWith(worldPrefix)) return "world:current";
    if (filePath.startsWith("assets/")) return "assets";
    if (filePath.startsWith("modules/")) return `module:${filePath.split("/")[1]}`;
    if (filePath.startsWith("systems/")) return `system:${filePath.split("/")[1]}`;
    if (filePath.startsWith("worlds/")) return `world:${filePath.split("/")[1]}`;
    return "data";
  }

  /**
   * Update the user tags for a single indexed entry.
   * Rebuilds the search haystack and persists to disk.
   * @param {string} path
   * @param {string[]} userTags
   * @returns {Promise<void>}
   */
  async updateUserTags(path, userTags) {
    const entry = this.#store.getEntry(path);
    if (!entry) return;
    entry.userTags = userTags;
    this.#search.update(this.#store.getHaystack(), this.#store.getEntries());
    await this.#store.save();
  }
}
