import { AssetVaultHub } from "./hub/AssetVaultHub.js";
import { AssetVaultPicker } from "./picker/AssetVaultPicker.js";
import { registerSettings } from "./settings.js";
import { IndexManager } from "./index/IndexManager.js";

Hooks.once("init", () => {
  console.log("Asset Vault | Initializing");

  game.assetVault = {
    originalPicker: CONFIG.ux.FilePicker,
    AssetVaultPicker,
    AssetVaultHub
  };

  registerSettings();

  loadTemplates([
    "modules/asset-vault/templates/parts/toolbar.hbs",
    "modules/asset-vault/templates/parts/sidebar.hbs",
    "modules/asset-vault/templates/parts/content.hbs",
    "modules/asset-vault/templates/parts/detail-panel.hbs"
  ]);
});

Hooks.once("setup", () => {
  // user-scoped settings are available here (not in init)
  if (!game.settings.get("asset-vault", "useDefaultPicker")) {
    CONFIG.ux.FilePicker = AssetVaultPicker;
  }
});

Hooks.once("ready", async () => {
  console.log("Asset Vault | Ready");

  const index = new IndexManager();
  game.assetVault.index = index;
  await index.initialize();

  console.log(`Asset Vault | Index status: ${index.status}`);
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (game.settings.get("asset-vault", "useDefaultPicker")) return;
  const browse = controls?.tiles?.tools?.browse;
  if (!browse) return;
  browse.title = "asset-vault.title";
  browse.icon = "fa-solid fa-vault";
  browse.onChange = () => new AssetVaultHub({ mode: "hub" }).render(true);
  delete browse.toolclip;
});
