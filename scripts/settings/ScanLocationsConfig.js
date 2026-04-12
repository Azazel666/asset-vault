const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

/** Root folders that are handled by dedicated toggles — excluded from "Other Folders". */
const KNOWN_ROOT_DIRS = new Set(["worlds", "modules", "systems", "assets"]);

export class ScanLocationsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  #indexStatusHook = null;

  static DEFAULT_OPTIONS = {
    id: "asset-vault-scan-locations",
    window: {
      title: "asset-vault.settings.scanLocations.name",
      icon: "fa-solid fa-folder-tree"
    },
    position: { width: 480 },
    actions: {
      save: ScanLocationsConfig.#onSave,
      rebuild: ScanLocationsConfig.#onRebuild,
      addPlayerPath: ScanLocationsConfig.#onAddPlayerPath,
      removePlayerPath: ScanLocationsConfig.#onRemovePlayerPath,
      presetToInput: ScanLocationsConfig.#onPresetToInput,
    }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/scan-locations.hbs", scrollable: [""] }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const raw = game.settings.get("asset-vault", "scanLocations");
    const setting = (raw && typeof raw === "object") ? raw : {};
    const isDefault = Object.keys(setting).length === 0;
    const get = (key, def) => isDefault ? def : (setting[key] ?? false);

    // Systems — discover from filesystem
    let systemIds = [];
    try {
      const result = await FilePicker.browse("data", "systems");
      systemIds = result.dirs.map(d => d.split("/").pop()).filter(Boolean);
    } catch { /* systems/ inaccessible */ }

    const systems = systemIds.map(id => ({
      id,
      name: id === game.system?.id ? game.system.title : id,
      isActive: id === game.system?.id,
      checked: get(`system:${id}`, id === game.system?.id)
    })).sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0) || a.name.localeCompare(b.name));

    // Other worlds — discover from filesystem, exclude current
    let otherWorlds = [];
    try {
      const result = await FilePicker.browse("data", "worlds");
      otherWorlds = result.dirs
        .map(d => d.split("/").pop()).filter(Boolean)
        .filter(id => id !== game.world.id)
        .map(id => ({ id, checked: get(`world:${id}`, false) }));
    } catch { /* worlds/ inaccessible */ }

    // Other root folders — discover from filesystem, exclude known
    let otherFolders = [];
    try {
      const result = await FilePicker.browse("data", "");
      otherFolders = result.dirs
        .map(d => d.split("/").pop()).filter(Boolean)
        .filter(name => !KNOWN_ROOT_DIRS.has(name))
        .map(name => ({ name, checked: get(`folder:${name}`, false) }));
    } catch { /* root inaccessible */ }

    // Player access — path list
    const rawPaths = game.settings.get("asset-vault", "playerVisiblePaths");
    const playerPaths = Array.isArray(rawPaths) ? rawPaths : [];

    // Build preset suggestions (common paths based on indexed sources, not yet in list)
    const presets = [];
    presets.push({
      path: `worlds/${game.world.id}`,
      label: `worlds/${game.world.id}`
    });
    if (game.system) {
      presets.push({
        path: `systems/${game.system.id}`,
        label: `systems/${game.system.id}`
      });
    }
    presets.push({
      path: "assets",
      label: "assets"
    });
    for (const w of otherWorlds) {
      presets.push({ path: `worlds/${w.id}`, label: `worlds/${w.id}` });
    }
    for (const f of otherFolders) {
      presets.push({ path: f.name, label: f.name });
    }
    // All presets shown — clicking populates the input so GM can append a sub-path
    const presetsFiltered = presets;

    return {
      currentWorld: { id: game.world.id, name: game.world.title ?? game.world.id },
      systems,
      indexActiveModules: get("indexActiveModules", true),
      indexGlobalAssets: get("assets", true),
      indexFontAwesome: get("indexFontAwesome", false),
      otherWorlds,
      otherFolders,
      playerPaths,
      presets: presetsFiltered,
      isRebuilding: game.assetVault?.index?.status === "building",
      indexSize: game.assetVault?.index?.size ?? 0
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    // Re-render when index status changes so the rebuild button updates
    if (!this.#indexStatusHook) {
      this.#indexStatusHook = () => this.render();
      Hooks.on("assetVault.indexStatus", this.#indexStatusHook);
    }

    // Wire Enter key on the path input
    this.element.querySelector(".avsl-player-path-input")
      ?.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const path = e.target.value.trim();
        if (path) { this.#addPathItem(path); e.target.value = ""; }
      });
  }

  async close(options) {
    if (this.#indexStatusHook) {
      Hooks.off("assetVault.indexStatus", this.#indexStatusHook);
      this.#indexStatusHook = null;
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Path list helpers                           */
  /* -------------------------------------------- */

  #addPathItem(path) {
    if (!path) return;
    const list = this.element?.querySelector(".avsl-player-path-list");
    if (!list) return;
    if (list.querySelector(`.avsl-player-path-item[data-path="${CSS.escape(path)}"]`)) return;
    // Remove empty-state placeholder
    list.querySelector(".avsl-empty")?.remove();
    const item = document.createElement("div");
    item.className = "avsl-player-path-item";
    item.dataset.path = path;
    item.innerHTML = `<span class="avsl-player-path-text">${path}</span>
      <button type="button" class="avsl-remove-path-btn" data-action="removePlayerPath" data-path="${path}">×</button>`;
    list.appendChild(item);
    // Hide the matching preset chip
    const chip = this.element.querySelector(`.avsl-preset-btn[data-path="${CSS.escape(path)}"]`);
    if (chip) chip.hidden = true;
  }

  #removePathItem(path) {
    if (!path) return;
    const list = this.element?.querySelector(".avsl-player-path-list");
    if (!list) return;
    list.querySelector(`.avsl-player-path-item[data-path="${CSS.escape(path)}"]`)?.remove();
    // Re-show the preset chip
    const chip = this.element.querySelector(`.avsl-preset-btn[data-path="${CSS.escape(path)}"]`);
    if (chip) chip.hidden = false;
    // Show empty-state placeholder when list is empty
    if (!list.querySelector(".avsl-player-path-item")) {
      const p = document.createElement("p");
      p.className = "avsl-empty";
      p.textContent = game.i18n.localize("asset-vault.settings.playerAccess.empty");
      list.appendChild(p);
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Persist the current form state to the settings. Does NOT close the dialog. */
  async #persistSettings() {
    const form = this.element.querySelector("form.avsl-form");
    if (!form) return;
    const scanLocations = {};
    for (const input of form.querySelectorAll("input[type='checkbox'][name]")) {
      scanLocations[input.name] = input.checked;
    }
    const playerVisiblePaths = [...form.querySelectorAll(".avsl-player-path-item")]
      .map(el => el.dataset.path)
      .filter(Boolean);
    await game.settings.set("asset-vault", "scanLocations", scanLocations);
    await game.settings.set("asset-vault", "playerVisiblePaths", playerVisiblePaths);
  }

  static async #onSave() {
    await this.#persistSettings();
    ui.notifications.info(game.i18n.localize("asset-vault.scanLocations.saved"));
    this.close();
  }

  static async #onRebuild(event, button) {
    const index = game.assetVault?.index;
    if (!index || index.status === "building") return;
    await this.#persistSettings();
    index.rebuild().catch(err => console.error("Asset Vault | Rebuild error:", err));
  }

  static #onAddPlayerPath(event, target) {
    const input = this.element.querySelector(".avsl-player-path-input");
    const path = input?.value?.trim();
    if (path) { this.#addPathItem(path); input.value = ""; }
  }

  static #onRemovePlayerPath(event, target) {
    this.#removePathItem(target.dataset.path);
  }

  static #onPresetToInput(event, target) {
    const input = this.element.querySelector(".avsl-player-path-input");
    if (!input) return;
    input.value = target.dataset.path + "/";
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
