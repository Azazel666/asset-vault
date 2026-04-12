import { AssetVaultHub } from "../hub/AssetVaultHub.js";

const { FilePicker } = foundry.applications.apps;

export class AssetVaultPicker extends FilePicker {
  // Delegate to AssetVaultHub in picker mode instead of rendering itself.
  render(options = {}) {
    // Escape hatch: fall back to the original picker if the setting is on.
    if (game.settings.get("asset-vault", "useDefaultPicker")) {
      return new game.assetVault.originalPicker(this.options).render(options);
    }
    // Non-GMs use the original picker unless the GM has enabled player access.
    if (!game.user.isGM && !game.settings.get("asset-vault", "enableForPlayers")) {
      return new game.assetVault.originalPicker(this.options).render(options);
    }

    const hub = new AssetVaultHub({
      // Each picker instance gets a unique id so it can coexist with the hub
      // or other picker instances without sharing the same DOM id.
      id: `asset-vault-picker-${foundry.utils.randomID()}`,
      mode: "picker",
      pickerOptions: {
        type: this.type,
        current: this.request,
        callback: this.callback,
        field: this.field,
        button: this.button,
        extensions: this.extensions
      }
    });
    hub.render(options);
    return this;
  }
}
