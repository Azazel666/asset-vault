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

    return {
      currentWorld: { id: game.world.id, name: game.world.title ?? game.world.id },
      systems,
      indexActiveModules: get("indexActiveModules", true),
      indexGlobalAssets: get("assets", true),
      indexFontAwesome: get("indexFontAwesome", false),
      otherWorlds,
      otherFolders,
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
  }

  async close(options) {
    if (this.#indexStatusHook) {
      Hooks.off("assetVault.indexStatus", this.#indexStatusHook);
      this.#indexStatusHook = null;
    }
    return super.close(options);
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
    await game.settings.set("asset-vault", "scanLocations", scanLocations);
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

}
