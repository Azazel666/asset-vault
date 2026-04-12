const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

/** Root folders handled by dedicated toggles — excluded from preset list. */
const KNOWN_ROOT_DIRS = new Set(["worlds", "modules", "systems", "assets"]);

export class PlayerAccessConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "asset-vault-player-access",
    window: {
      title: "asset-vault.settings.playerAccess.name",
      icon: "fa-solid fa-users"
    },
    position: { width: 480 },
    actions: {
      addPlayerPath:    PlayerAccessConfig.#onAddPlayerPath,
      removePlayerPath: PlayerAccessConfig.#onRemovePlayerPath,
      presetToInput:    PlayerAccessConfig.#onPresetToInput,
      save:             PlayerAccessConfig.#onSave,
    }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/player-access.hbs" }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const rawPaths = game.settings.get("asset-vault", "playerVisiblePaths");
    const playerPaths = Array.isArray(rawPaths) ? rawPaths : [];

    const presets = [];
    presets.push({ path: `worlds/${game.world.id}`, label: `worlds/${game.world.id}` });
    if (game.system) {
      presets.push({ path: `systems/${game.system.id}`, label: `systems/${game.system.id}` });
    }
    presets.push({ path: "assets", label: "assets" });

    try {
      const result = await FilePicker.browse("data", "worlds");
      for (const dir of result.dirs) {
        const id = dir.split("/").pop();
        if (id && id !== game.world.id) presets.push({ path: `worlds/${id}`, label: `worlds/${id}` });
      }
    } catch { /* worlds/ inaccessible */ }

    try {
      const result = await FilePicker.browse("data", "");
      for (const dir of result.dirs) {
        const name = dir.split("/").pop();
        if (name && !KNOWN_ROOT_DIRS.has(name)) presets.push({ path: name, label: name });
      }
    } catch { /* root inaccessible */ }

    return { playerPaths, presets };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector(".avsl-player-path-input")
      ?.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const path = e.target.value.trim();
        if (path) { this.#addPathItem(path); e.target.value = ""; }
      });
  }

  /* -------------------------------------------- */
  /*  Path list helpers                           */
  /* -------------------------------------------- */

  #addPathItem(path) {
    if (!path) return;
    const list = this.element?.querySelector(".avsl-player-path-list");
    if (!list) return;
    if (list.querySelector(`.avsl-player-path-item[data-path="${CSS.escape(path)}"]`)) return;
    list.querySelector(".avsl-empty")?.remove();
    const item = document.createElement("div");
    item.className = "avsl-player-path-item";
    item.dataset.path = path;
    item.innerHTML = `<span class="avsl-player-path-text">${path}</span>
      <button type="button" class="avsl-remove-path-btn" data-action="removePlayerPath" data-path="${path}">×</button>`;
    list.appendChild(item);
    const chip = this.element.querySelector(`.avsl-preset-btn[data-path="${CSS.escape(path)}"]`);
    if (chip) chip.hidden = true;
  }

  #removePathItem(path) {
    if (!path) return;
    const list = this.element?.querySelector(".avsl-player-path-list");
    if (!list) return;
    list.querySelector(`.avsl-player-path-item[data-path="${CSS.escape(path)}"]`)?.remove();
    const chip = this.element.querySelector(`.avsl-preset-btn[data-path="${CSS.escape(path)}"]`);
    if (chip) chip.hidden = false;
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

  static async #onSave() {
    const form = this.element.querySelector("form.avsl-form");
    if (!form) return;
    const playerVisiblePaths = [...form.querySelectorAll(".avsl-player-path-item")]
      .map(el => el.dataset.path).filter(Boolean);
    await game.settings.set("asset-vault", "playerVisiblePaths", playerVisiblePaths);
    ui.notifications.info(game.i18n.localize("asset-vault.scanLocations.saved"));
    this.close();
  }
}
