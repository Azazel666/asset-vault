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
}
