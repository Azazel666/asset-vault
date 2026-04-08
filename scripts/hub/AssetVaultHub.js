const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.mode = options.mode ?? "hub";
    this.pickerOptions = options.pickerOptions ?? {};
    this.activeSource = "data";
    this.target = "";

    // Start at the directory containing the currently selected file, if any
    if (this.pickerOptions.current) {
      const cur = this.pickerOptions.current;
      this.target = cur.includes("/") ? cur.substring(0, cur.lastIndexOf("/")) : "";
    }
  }

  static DEFAULT_OPTIONS = {
    id: "asset-vault-hub",
    window: {
      title: "Asset Vault",
      icon: "fa-solid fa-vault",
      resizable: true
    },
    position: { width: 900, height: 600 },
    actions: {
      pickDirectory: AssetVaultHub.#onPickDirectory,
      backTraverse: AssetVaultHub.#onBackTraverse,
      setSource: AssetVaultHub.#onSetSource,
      setViewMode: AssetVaultHub.#onSetViewMode
    }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/hub.hbs" }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    let dirs = [];
    let files = [];
    let browseError = null;

    try {
      const result = await FilePicker.browse(this.activeSource, this.target);

      dirs = result.dirs
        .map(d => ({ name: decodeURIComponent(d.split("/").pop()), path: d }))
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

      const extensions = this.pickerOptions.extensions ?? null;
      files = result.files
        .filter(f => !extensions || extensions.some(ext => f.toLowerCase().endsWith(ext)))
        .map(path => ({
          name: decodeURIComponent(path.split("/").pop()),
          path,
          isImage: foundry.helpers.media.ImageHelper.hasImageExtension(path),
          isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(path),
          isAudio: foundry.audio.AudioHelper.hasAudioExtension(path)
        }))
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    } catch(err) {
      browseError = err.message;
    }

    const viewMode = game.settings.get("asset-vault", "viewMode");
    const storages = game.data.files?.storages ?? ["data"];
    const availableSources = ["data", "public", "s3"].filter(s => storages.includes(s));

    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      viewMode,
      isGrid: viewMode === "grid",
      isList: viewMode === "list",
      dirs,
      files,
      noResults: dirs.length + files.length === 0,
      browseError,
      breadcrumbs: this.#buildBreadcrumbs(),
      activeSource: this.activeSource,
      sources: availableSources.map(s => ({
        key: s,
        label: AssetVaultHub.#sourceLabel(s),
        active: s === this.activeSource
      }))
    };
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  #buildBreadcrumbs() {
    const crumbs = [{ label: AssetVaultHub.#sourceLabel(this.activeSource), path: "", isLast: false }];
    if (!this.target) {
      crumbs[0].isLast = true;
      return crumbs;
    }
    const parts = this.target.split("/").filter(Boolean);
    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      crumbs.push({ label: decodeURIComponent(parts[i]), path: currentPath, isLast: i === parts.length - 1 });
    }
    return crumbs;
  }

  static #sourceLabel(source) {
    return { data: "User Data", public: "Public", s3: "Amazon S3" }[source] ?? source;
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  navigate(path, source = this.activeSource) {
    this.activeSource = source;
    this.target = path;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onPickDirectory(event, target) {
    this.navigate(target.dataset.path);
  }

  static #onBackTraverse() {
    if (!this.target) return;
    const newTarget = this.target.includes("/")
      ? this.target.substring(0, this.target.lastIndexOf("/"))
      : "";
    this.navigate(newTarget);
  }

  static #onSetSource(event, target) {
    this.navigate("", target.dataset.source);
  }

  static async #onSetViewMode(event, target) {
    await game.settings.set("asset-vault", "viewMode", target.dataset.mode);
    this.render();
  }
}
