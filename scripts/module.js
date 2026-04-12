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
  CONFIG.ux.FilePicker = AssetVaultPicker;

  // Monkey-patch upload on our own class so the hook fires whether callers use
  // FilePicker.upload() (which delegates here via FilePicker.implementation) or
  // AssetVaultPicker.upload() directly.  IndexStore.save() also goes through this
  // path; IndexManager.handleFileUploaded() skips non-media types to avoid
  // self-indexing the index.json file.
  const _origUpload = AssetVaultPicker.upload;
  AssetVaultPicker.upload = async function(source, path, file, body = {}, options = {}) {
    const result = await _origUpload.call(this, source, path, file, body, options);
    if (result && result !== false) {
      Hooks.callAll("assetVault.fileUploaded", source, path, file.name, result);
    }
    return result;
  };
});

Hooks.once("ready", async () => {
  console.log("Asset Vault | Ready");

  const index = new IndexManager();
  game.assetVault.index = index;
  await index.initialize();

  // Only GMs can write to disk — skip rebuild for players.
  // Players load the existing index written by the GM via initialize() above.
  if (game.user.isGM) {
    // Rebuild in background so newly activated modules/systems are picked up.
    // The existing index (if any) remains queryable while the scan runs.
    console.log("Asset Vault | Starting background index rebuild...");
    index.rebuild().catch(err => console.error("Asset Vault | Background rebuild error:", err));
  }

  console.log(`Asset Vault | Index status: ${index.status}`);
});

// Canvas Tile creation from Asset Vault image drags.
// Image drags set text/plain to the raw URL (not JSON) so ProseMirror RTEs work
// correctly. The canvas board reads text/plain via getDragEventData, which returns {}
// for a plain URL. We intercept here to inject the Tile drop data before the switch.
Hooks.on("dropCanvasData", (board, data, event) => {
  if (data.type || !event?.dataTransfer) return; // already typed — not ours
  const raw = event.dataTransfer.getData("text/plain");
  if (!raw) return;
  if (!foundry.helpers.media.ImageHelper.hasImageExtension(raw)) return;
  data.type = "Tile";
  data.texture = { src: raw };
  data.tileSize = canvas?.dimensions?.size ?? 100;
  // Allow board.mjs to continue into the switch statement with data.type = "Tile"
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (game.settings.get("asset-vault", "useDefaultPicker")) return;
  if (!game.user.isGM && !game.settings.get("asset-vault", "enableForPlayers")) return;
  const browse = controls?.tiles?.tools?.browse;
  if (!browse) return;
  browse.title = "asset-vault.title";
  browse.icon = "fa-solid fa-vault";
  browse.onChange = () => new AssetVaultHub({ mode: "hub" }).render(true);
  delete browse.toolclip;
});
