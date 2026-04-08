import { AssetVaultHub } from "./hub/AssetVaultHub.js";
import { AssetVaultPicker } from "./picker/AssetVaultPicker.js";

Hooks.once("init", () => {
  console.log("Asset Vault | Initializing");

  game.assetVault = {
    originalPicker: CONFIG.ux.FilePicker,
    AssetVaultPicker,
    AssetVaultHub
  };

  CONFIG.ux.FilePicker = AssetVaultPicker;
});

Hooks.once("ready", () => {
  console.log("Asset Vault | Ready");
});

Hooks.on("getSceneControlButtons", (controls) => {
  controls["asset-vault"] = {
    name: "asset-vault",
    title: "asset-vault.title",
    icon: "fa-solid fa-vault",
    tools: {
      openHub: {
        name: "openHub",
        title: "asset-vault.title",
        icon: "fa-solid fa-vault",
        button: true,
        onClick: () => {
          new AssetVaultHub({ mode: "hub" }).render(true);
        }
      }
    }
  };
});
