import { ScanLocationsConfig } from "./settings/ScanLocationsConfig.js";

export function registerSettings() {
  game.settings.register("asset-vault", "useDefaultPicker", {
    name: "asset-vault.settings.useDefaultPicker.name",
    hint: "asset-vault.settings.useDefaultPicker.hint",
    scope: "user",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => ui.controls?.render()
  });

  game.settings.register("asset-vault", "viewMode", {
    name: "asset-vault.settings.viewMode.name",
    hint: "asset-vault.settings.viewMode.hint",
    scope: "user",
    config: true,
    type: String,
    choices: {
      grid: "asset-vault.settings.viewMode.grid",
      list: "asset-vault.settings.viewMode.list"
    },
    default: "grid"
  });

  game.settings.register("asset-vault", "detachedMode", {
    name: "asset-vault.settings.detachedMode.name",
    hint: "asset-vault.settings.detachedMode.hint",
    scope: "user",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register("asset-vault", "showAutoTags", {
    name: "asset-vault.settings.showAutoTags.name",
    hint: "asset-vault.settings.showAutoTags.hint",
    scope: "user",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("asset-vault", "enableForPlayers", {
    name: "asset-vault.settings.enableForPlayers.name",
    hint: "asset-vault.settings.enableForPlayers.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    restricted: true
  });

  game.settings.register("asset-vault", "scanLocations", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu("asset-vault", "scanLocationsMenu", {
    name: "asset-vault.settings.scanLocations.name",
    label: "asset-vault.settings.scanLocations.label",
    icon: "fa-solid fa-folder-tree",
    type: ScanLocationsConfig,
    restricted: true
  });
}
