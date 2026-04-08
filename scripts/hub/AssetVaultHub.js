const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  #browseResult = null;
  selectedFile = null;

  constructor(options = {}) {
    super(options);
    this.mode = options.mode ?? "hub";
    this.pickerOptions = options.pickerOptions ?? {};
    this.activeSource = "data";
    this.target = "";

    // Start at the directory containing the currently selected file, if any
    if (this.pickerOptions.current) {
      const cur = this.pickerOptions.current;
      this.target = cur.includes("/") ? cur.substring(0, cur.lastIndexOf("/")) : "";
    }
  }

  static DEFAULT_OPTIONS = {
    id: "asset-vault-hub",
    window: {
      title: "Asset Vault",
      icon: "fa-solid fa-vault",
      resizable: true
    },
    position: { width: 960, height: 620 },
    actions: {
      pickDirectory: AssetVaultHub.#onPickDirectory,
      backTraverse: AssetVaultHub.#onBackTraverse,
      setSource: AssetVaultHub.#onSetSource,
      setViewMode: AssetVaultHub.#onSetViewMode,
      selectFile: AssetVaultHub.#onSelectFile,
      confirmSelection: AssetVaultHub.#onConfirmSelection,
      copyUrl: AssetVaultHub.#onCopyUrl
    }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/hub.hbs" }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    let dirs = [];
    let files = [];
    let browseError = null;

    // Use cached result to avoid a network round-trip on selection changes
    if (!this.#browseResult) {
      try {
        this.#browseResult = await FilePicker.browse(this.activeSource, this.target);
      } catch(err) {
        browseError = err.message;
      }
    }

    if (this.#browseResult) {
      dirs = this.#browseResult.dirs
        .map(d => ({ name: decodeURIComponent(d.split("/").pop()), path: d }))
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

      const extensions = this.pickerOptions.extensions ?? null;
      files = this.#browseResult.files
        .filter(f => !extensions || extensions.some(ext => f.toLowerCase().endsWith(ext)))
        .map(path => {
          const isImage = foundry.helpers.media.ImageHelper.hasImageExtension(path);
          const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(path);
          const isAudio = foundry.audio.AudioHelper.hasAudioExtension(path);
          const isPdf = path.toLowerCase().endsWith(".pdf");
          const fileType = isImage ? "Image" : isVideo ? "Video" : isAudio ? "Audio" : isPdf ? "PDF" : "File";
          return {
            name: decodeURIComponent(path.split("/").pop()),
            path, isImage, isVideo, isAudio, isPdf, fileType,
            isSelected: this.selectedFile?.path === path
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    }

    const viewMode = game.settings.get("asset-vault", "viewMode");
    const storages = game.data.files?.storages ?? ["data"];
    const availableSources = ["data", "public", "s3"].filter(s => storages.includes(s));

    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      viewMode,
      isGrid: viewMode === "grid",
      isList: viewMode === "list",
      dirs,
      files,
      noResults: dirs.length + files.length === 0,
      browseError,
      breadcrumbs: this.#buildBreadcrumbs(),
      activeSource: this.activeSource,
      sources: availableSources.map(s => ({
        key: s,
        label: AssetVaultHub.#sourceLabel(s),
        active: s === this.activeSource
      })),
      selectedFile: this.selectedFile
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Double-click a file to confirm in picker mode (re-registered each render)
    this.element.querySelector(".av-content")?.addEventListener("dblclick", ev => {
      if (this.mode !== "picker") return;
      const item = ev.target.closest(".av-item-file");
      if (!item) return;
      if (this.selectedFile?.path !== item.dataset.path) {
        this.selectedFile = this.#fileDataFromElement(item);
        this.#applySelectionToDOM(item);
      }
      this.#doConfirmSelection();
    });
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  #buildBreadcrumbs() {
    const crumbs = [{ label: AssetVaultHub.#sourceLabel(this.activeSource), path: "", isLast: false }];
    if (!this.target) {
      crumbs[0].isLast = true;
      return crumbs;
    }
    const parts = this.target.split("/").filter(Boolean);
    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      crumbs.push({ label: decodeURIComponent(parts[i]), path: currentPath, isLast: i === parts.length - 1 });
    }
    return crumbs;
  }

  static #sourceLabel(source) {
    return { data: "User Data", public: "Public", s3: "Amazon S3" }[source] ?? source;
  }

  #fileDataFromElement(el) {
    return {
      path: el.dataset.path,
      name: el.dataset.name,
      isImage: el.dataset.isImage === "true",
      isVideo: el.dataset.isVideo === "true",
      isAudio: el.dataset.isAudio === "true",
      isPdf: el.dataset.isPdf === "true",
      fileType: el.dataset.fileType
    };
  }

  // Update selected highlight in the content list without a re-render
  #applySelectionToDOM(selectedEl) {
    this.element.querySelectorAll(".av-item.selected").forEach(el => el.classList.remove("selected"));
    selectedEl.classList.add("selected");

    // Enable footer Select button
    const footerBtn = this.element.querySelector(".av-select-btn");
    if (footerBtn) footerBtn.disabled = false;

    // Populate the detail panel via DOM
    this.#renderDetailPanel();
  }

  // Build and inject detail panel HTML without a full re-render
  #renderDetailPanel() {
    const panel = this.element.querySelector(".av-detail-panel");
    if (!panel) return;
    const f = this.selectedFile;
    if (!f) { panel.hidden = true; return; }

    const esc = s => String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let previewHtml;
    if (f.isImage) {
      previewHtml = `<img class="av-detail-img" src="${esc(f.path)}" alt="${esc(f.name)}" />`;
    } else if (f.isVideo) {
      previewHtml = `<video class="av-detail-video" src="${esc(f.path)}" controls></video>`;
    } else if (f.isAudio) {
      previewHtml = `<audio class="av-detail-audio" src="${esc(f.path)}" controls></audio>`;
    } else {
      const icon = f.isPdf ? "fa-file-pdf" : "fa-file";
      previewHtml = `<i class="fa-solid ${icon} av-detail-type-icon"></i>`;
    }

    const selectBtn = this.mode === "picker"
      ? `<button type="button" class="av-confirm-btn" data-action="confirmSelection">
           <i class="fa-solid fa-check"></i> ${game.i18n.localize("asset-vault.actions.select")}
         </button>`
      : "";

    panel.innerHTML = `
      <div class="av-detail-preview-area">${previewHtml}</div>
      <div class="av-detail-meta">
        <div class="av-detail-filename" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="av-detail-path" title="${esc(f.path)}">${esc(f.path)}</div>
        <div class="av-detail-filetype">${esc(f.fileType)}</div>
      </div>
      <div class="av-detail-actions">
        <button type="button" class="av-copy-btn" data-action="copyUrl">
          <i class="fa-solid fa-copy"></i> ${game.i18n.localize("asset-vault.actions.copyUrl")}
        </button>
        ${selectBtn}
      </div>
    `;
    panel.removeAttribute("hidden");
  }

  #doConfirmSelection() {
    if (!this.selectedFile) return;
    const { callback, field } = this.pickerOptions;
    if (callback) callback(this.selectedFile.path);
    if (field) field.value = this.selectedFile.path;
    this.close();
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  navigate(path, source = this.activeSource) {
    this.activeSource = source;
    this.target = path;
    this.#browseResult = null;
    this.selectedFile = null;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onPickDirectory(event, target) {
    this.navigate(target.dataset.path);
  }

  static #onBackTraverse() {
    if (!this.target) return;
    const newTarget = this.target.includes("/")
      ? this.target.substring(0, this.target.lastIndexOf("/"))
      : "";
    this.navigate(newTarget);
  }

  static #onSetSource(event, target) {
    this.navigate("", target.dataset.source);
  }

  static async #onSetViewMode(event, target) {
    await game.settings.set("asset-vault", "viewMode", target.dataset.mode);
    this.render();
  }

  // DOM-only update — no re-render, scroll position preserved
  static #onSelectFile(event, target) {
    this.selectedFile = this.#fileDataFromElement(target);
    this.#applySelectionToDOM(target);
  }

  static #onConfirmSelection() {
    this.#doConfirmSelection();
  }

  static async #onCopyUrl() {
    if (!this.selectedFile) return;
    await navigator.clipboard.writeText(this.selectedFile.path);
    ui.notifications.info(
      game.i18n.format("asset-vault.notifications.copiedUrl", { path: this.selectedFile.name })
    );
  }
}
