import { AssetVaultHub } from "../hub/AssetVaultHub.js";

const { FilePicker } = foundry.applications.apps;

export class AssetVaultPicker extends FilePicker {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    window: {
      icon: "fa-solid fa-vault"
    }
  });

  get title() {
    return game.i18n.localize("asset-vault.title");
  }

  // Delegate to AssetVaultHub in picker mode instead of rendering itself.
  render(options = {}) {
    const hub = new AssetVaultHub({
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
