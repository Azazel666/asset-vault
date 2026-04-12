import { ScanLocationsConfig } from "./settings/ScanLocationsConfig.js";
import { PlayerAccessConfig } from "./settings/PlayerAccessConfig.js";

export function registerSettings() {
  game.settings.register("asset-vault", "useDefaultPicker", {
    name: "asset-vault.settings.useDefaultPicker.name",
    hint: "asset-vault.settings.useDefaultPicker.hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: false,
    onChange: () => ui.controls?.render()
  });

  game.settings.register("asset-vault", "viewMode", {
    name: "asset-vault.settings.viewMode.name",
    hint: "asset-vault.settings.viewMode.hint",
    scope: "world",
    config: true,
    restricted: true,
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
    scope: "world",
    config: true,
    restricted: true,
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

  game.settings.register("asset-vault", "playerVisiblePaths", {
    scope: "world",
    config: false,
    type: Object,
    default: []
  });

  game.settings.register("asset-vault", "indexBuildSignal", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: (value) => {
      const index = game.assetVault?.index;
      if (!index) return;
      if (value < 0) {
        // Rebuild started — update local status so all clients show the banner
        if (index.status !== "building") {
          index.status = "building";
          Hooks.callAll("assetVault.indexStatus", "building");
        }
      } else if (value > 0) {
        // Rebuild complete — all clients reload the fresh index from disk.
        // The rebuilding GM gets a redundant reload (harmless); other GMs
        // and players all pick up the newly written index.
        index.reload().catch(err =>
          console.error("Asset Vault | Index reload failed:", err)
        );
      }
      // value === 0 (error): Hub re-renders via the hook emitted inside rebuild()
    }
  });

  game.settings.registerMenu("asset-vault", "scanLocationsMenu", {
    name: "asset-vault.settings.scanLocations.name",
    label: "asset-vault.settings.scanLocations.label",
    icon: "fa-solid fa-folder-tree",
    type: ScanLocationsConfig,
    restricted: true
  });

  game.settings.registerMenu("asset-vault", "playerAccessMenu", {
    name: "asset-vault.settings.playerAccess.name",
    label: "asset-vault.settings.scanLocations.label",
    icon: "fa-solid fa-users",
    type: PlayerAccessConfig,
    restricted: true
  });
}
