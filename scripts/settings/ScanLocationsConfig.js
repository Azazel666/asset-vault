const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ScanLocationsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "asset-vault-scan-locations",
    window: {
      title: "asset-vault.settings.scanLocations.name",
      icon: "fa-solid fa-folder-tree"
    },
    position: { width: 500, height: 400 }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/scan-locations.hbs" }
  };

  async _prepareContext(options) {
    return {};
  }
}
