const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.mode = options.mode ?? "hub";
    this.pickerOptions = options.pickerOptions ?? {};
  }

  static DEFAULT_OPTIONS = {
    id: "asset-vault-hub",
    window: {
      title: "Asset Vault",
      icon: "fa-solid fa-vault",
      resizable: true
    },
    position: { width: 900, height: 600 }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/hub.hbs" }
  };

  async _prepareContext(options) {
    const viewMode = game.settings.get("asset-vault", "viewMode");
    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      viewMode,
      isGrid: viewMode === "grid",
      isList: viewMode === "list"
    };
  }
}
