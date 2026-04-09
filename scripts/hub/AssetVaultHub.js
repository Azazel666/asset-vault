const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  #browseResult = null;
  #sidebarRootDirs = null;
  #sidebarSourceKey = null;
  #sidebarCollapsed = false;
  #searchQuery = "";
  #searchCursorStart = 0;
  #searchCursorEnd = 0;
  #lastBrowsePath = "";
  #lastBrowseSource = "data";
  #indexStatusHook = null;
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
    position: { width: 960, height: 640 },
    actions: {
      pickDirectory: AssetVaultHub.#onPickDirectory,
      backTraverse: AssetVaultHub.#onBackTraverse,
      setSource: AssetVaultHub.#onSetSource,
      setViewMode: AssetVaultHub.#onSetViewMode,
      toggleSidebar: AssetVaultHub.#onToggleSidebar,
      selectFile: AssetVaultHub.#onSelectFile,
      confirmSelection: AssetVaultHub.#onConfirmSelection,
      copyUrl: AssetVaultHub.#onCopyUrl,
      addTag: AssetVaultHub.#onAddTag,
      removeTag: AssetVaultHub.#onRemoveTag
    }
  };

  static PARTS = {
    body: { template: "modules/asset-vault/templates/hub.hbs" }
  };

  static #MIN_WIDTH = 800;
  static #MIN_HEIGHT = 580;

  setPosition(pos = {}) {
    if (pos.width !== undefined) pos.width = Math.max(pos.width, AssetVaultHub.#MIN_WIDTH);
    if (pos.height !== undefined) pos.height = Math.max(pos.height, AssetVaultHub.#MIN_HEIGHT);
    return super.setPosition(pos);
  }

  get title() {
    if (this.mode !== "picker") return game.i18n.localize("asset-vault.title");
    const type = this.pickerOptions.type ?? "";
    if (type === "image") return game.i18n.localize("asset-vault.picker.titleImage");
    if (type === "audio") return game.i18n.localize("asset-vault.picker.titleAudio");
    if (type === "video") return game.i18n.localize("asset-vault.picker.titleVideo");
    return game.i18n.localize("asset-vault.picker.titleFile");
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    let dirs = [];
    let files = [];
    let browseError = null;
    const isSearchMode = this.#searchQuery.length > 0;

    if (isSearchMode) {
      // Search mode: skip FilePicker.browse, return index results
      const index = game.assetVault?.index;
      if (index?.status === "ready") {
        const extensions = this.pickerOptions.extensions ?? null;
        files = index.search(this.#searchQuery)
          .filter(entry => !extensions || extensions.some(ext => entry.path.toLowerCase().endsWith(ext)))
          .map(entry => {
            const isImage = entry.type === "image";
            const isVideo = entry.type === "video";
            const isAudio = entry.type === "audio";
            const isPdf = entry.type === "pdf";
            const fileType = game.i18n.localize(isImage ? "asset-vault.content.typeImage" : isVideo ? "asset-vault.content.typeVideo" : isAudio ? "asset-vault.content.typeAudio" : isPdf ? "asset-vault.content.typePdf" : "asset-vault.content.typeFile");
            return {
              name: entry.name,
              path: entry.path,
              isImage, isVideo, isAudio, isPdf, fileType,
              isSelected: this.selectedFile?.path === entry.path
            };
          });
      }
    } else {
      // Browse mode: load directory listing (cached per navigation)
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
            const fileType = game.i18n.localize(isImage ? "asset-vault.content.typeImage" : isVideo ? "asset-vault.content.typeVideo" : isAudio ? "asset-vault.content.typeAudio" : isPdf ? "asset-vault.content.typePdf" : "asset-vault.content.typeFile");
            return {
              name: decodeURIComponent(path.split("/").pop()),
              path, isImage, isVideo, isAudio, isPdf, fileType,
              isSelected: this.selectedFile?.path === path
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      }

      // Load sidebar root dirs (cached per source)
      await this.#loadSidebarRootDirs();
    }

    const viewMode = game.settings.get("asset-vault", "viewMode");
    const storages = game.data.files?.storages ?? ["data"];
    const availableSources = ["data", "public", "s3"].filter(s => storages.includes(s));

    // Index status banner
    const indexStatus = game.assetVault?.index?.status ?? "none";
    const indexBanner = AssetVaultHub.#indexBanner(indexStatus);

    // Build selectedFile context with tag data from index
    const showAutoTags = game.settings.get("asset-vault", "showAutoTags");
    let selectedFileCtx = null;
    if (this.selectedFile) {
      const entry = game.assetVault?.index?.getEntry(this.selectedFile.path);
      selectedFileCtx = {
        ...this.selectedFile,
        autoTags: entry?.autoTags ?? [],
        userTags: entry?.userTags ?? []
      };
    }

    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      viewMode,
      isGrid: viewMode === "grid",
      isList: viewMode === "list",
      isSearchMode,
      searchQuery: this.#searchQuery,
      searchResultCount: isSearchMode ? files.length : 0,
      searchResultText: isSearchMode
        ? game.i18n.format("asset-vault.search.resultCount", { count: files.length, query: this.#searchQuery })
        : "",
      dirs,
      files,
      noResults: !isSearchMode && dirs.length + files.length === 0,
      browseError,
      breadcrumbs: this.#buildBreadcrumbs(),
      activeSource: this.activeSource,
      sources: availableSources.map(s => ({
        key: s,
        label: AssetVaultHub.#sourceLabel(s),
        active: s === this.activeSource
      })),
      sidebarTree: this.#buildSidebarTree(),
      selectedFile: selectedFileCtx,
      showAutoTags,
      indexStatus,
      indexBanner
    };
  }

  static #indexBanner(status) {
    if (status === "none") return { icon: "fa-circle-info", message: game.i18n.localize("asset-vault.index.statusNone") };
    if (status === "building") return { icon: "fa-spinner fa-spin", message: game.i18n.localize("asset-vault.index.statusBuilding") };
    if (status === "error") return { icon: "fa-triangle-exclamation", message: game.i18n.localize("asset-vault.index.statusError") };
    return null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    // Register index status hook once — re-renders the hub when indexing starts/finishes
    if (!this.#indexStatusHook) {
      this.#indexStatusHook = () => this.render();
      Hooks.on("assetVault.indexStatus", this.#indexStatusHook);
    }

    // Restore sidebar collapsed / search-hidden state
    const sidebar = this.element.querySelector(".av-sidebar");
    if (sidebar) {
      sidebar.classList.toggle("av-collapsed", this.#sidebarCollapsed);
      sidebar.classList.toggle("av-search-hidden", this.#searchQuery.length > 0);
    }

    // Wire search input
    const searchInput = this.element.querySelector(".av-search-input");
    const clearBtn = this.element.querySelector(".av-search-clear");
    if (searchInput) {
      searchInput.value = this.#searchQuery;
      if (clearBtn) clearBtn.style.display = this.#searchQuery ? "" : "none";

      // Restore focus and cursor position after re-render so typing isn't disrupted
      if (this.#searchQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(this.#searchCursorStart, this.#searchCursorEnd);
      }

      // Show/hide clear button immediately as user types (before debounce)
      searchInput.addEventListener("input", e => {
        if (clearBtn) clearBtn.style.display = e.target.value ? "" : "none";
      });

      const doSearch = foundry.utils.debounce((query) => {
        if (query && !this.#searchQuery) {
          // Entering search mode — save browse location to restore on clear
          this.#lastBrowsePath = this.target;
          this.#lastBrowseSource = this.activeSource;
        }
        // Save cursor position before render so it can be restored
        this.#searchCursorStart = searchInput.selectionStart ?? 0;
        this.#searchCursorEnd = searchInput.selectionEnd ?? 0;
        this.#searchQuery = query;
        if (query) {
          this.render();
        } else {
          this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
        }
      }, 150);

      searchInput.addEventListener("input", e => doSearch(e.target.value));
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        clearBtn.style.display = "none";
        this.#searchQuery = "";
        this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
      });
    }

    // Wire tag input Enter key
    this.#wireTagInput();

    // Double-click a file to confirm in picker mode (works for both browse and search results)
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
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  async close(options) {
    if (this.#indexStatusHook) {
      Hooks.off("assetVault.indexStatus", this.#indexStatusHook);
      this.#indexStatusHook = null;
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Sidebar helpers                             */
  /* -------------------------------------------- */

  async #loadSidebarRootDirs() {
    if (this.#sidebarSourceKey === this.activeSource && this.#sidebarRootDirs !== null) return;
    try {
      // Reuse the content browse result if we're already at the root
      const result = (this.target === "" && this.#browseResult)
        ? this.#browseResult
        : await FilePicker.browse(this.activeSource, "");
      this.#sidebarRootDirs = result.dirs;
    } catch(e) {
      this.#sidebarRootDirs = [];
    }
    this.#sidebarSourceKey = this.activeSource;
  }

  #buildSidebarTree() {
    return (this.#sidebarRootDirs ?? [])
      .map(d => ({
        path: d,
        name: decodeURIComponent(d.split("/").pop()),
        isActive: this.target === d || this.target.startsWith(d + "/")
      }))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  /* -------------------------------------------- */
  /*  General helpers                             */
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

  #applySelectionToDOM(selectedEl) {
    this.element.querySelectorAll(".av-item.selected").forEach(el => el.classList.remove("selected"));
    selectedEl.classList.add("selected");
    const footerBtn = this.element.querySelector(".av-select-btn");
    if (footerBtn) footerBtn.disabled = false;
    this.#renderDetailPanel();
  }

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
      </div>
      ${this.#buildTagsHtml(f)}
    `;
    panel.removeAttribute("hidden");
    this.#wireTagInput();
  }

  #buildTagsHtml(file) {
    const index = game.assetVault?.index;
    const entry = index?.getEntry(file.path);
    const userTags = entry?.userTags ?? [];
    const autoTags = entry?.autoTags ?? [];
    const showAutoTags = game.settings.get("asset-vault", "showAutoTags");
    const esc = s => String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let autoSection = "";
    if (showAutoTags) {
      const chips = autoTags.map(t => `<span class="av-tag av-tag--auto">${esc(t)}</span>`).join("");
      autoSection = `
        <div class="av-tags-section">
          <div class="av-tags-label">${game.i18n.localize("asset-vault.tags.autoTagsLabel")}</div>
          <div class="av-tags-list">${chips}</div>
        </div>`;
    }

    const userChips = userTags.map(t => `
      <span class="av-tag av-tag--user">
        ${esc(t)}<button type="button" class="av-tag-remove" data-action="removeTag" data-tag="${esc(t)}">×</button>
      </span>`).join("");

    const userSection = `
      <div class="av-tags-section">
        <div class="av-tags-label">${game.i18n.localize("asset-vault.tags.userTagsLabel")}</div>
        <div class="av-tags-list">${userChips}</div>
        <div class="av-tag-input-row">
          <input type="text" class="av-tag-input" placeholder="${game.i18n.localize("asset-vault.tags.addPlaceholder")}" maxlength="50">
          <button type="button" class="av-tag-add-btn" data-action="addTag">${game.i18n.localize("asset-vault.tags.add")}</button>
        </div>
      </div>`;

    return `<div class="av-detail-tags">${autoSection}${userSection}</div>`;
  }

  #wireTagInput() {
    const input = this.element?.querySelector(".av-tag-input");
    if (!input) return;
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.#doAddTag(e.target.value);
      }
    });
  }

  async #doAddTag(rawValue) {
    if (!this.selectedFile) return;
    const index = game.assetVault?.index;
    if (!index) return;

    const tags = rawValue.split(",")
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0 && t.length <= 50);
    if (tags.length === 0) return;

    const entry = index.getEntry(this.selectedFile.path);
    const existing = entry?.userTags ?? [];
    const allExisting = [...(entry?.autoTags ?? []), ...existing];
    const duplicates = tags.filter(t => allExisting.includes(t));
    const newTags = tags.filter(t => !allExisting.includes(t));

    if (duplicates.length > 0) {
      ui.notifications.warn(
        game.i18n.format("asset-vault.notifications.tagDuplicate", { tag: duplicates.join(", ") })
      );
    }
    if (newTags.length === 0) return;

    await index.updateUserTags(this.selectedFile.path, [...existing, ...newTags]);
    this.#renderDetailPanel();

    const input = this.element?.querySelector(".av-tag-input");
    if (input) input.value = "";
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
    if (source !== this.activeSource) {
      this.#sidebarRootDirs = null;
      this.#sidebarSourceKey = null;
    }
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

  static #onToggleSidebar() {
    this.#sidebarCollapsed = !this.#sidebarCollapsed;
    this.element.querySelector(".av-sidebar")?.classList.toggle("av-collapsed", this.#sidebarCollapsed);
  }

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

  static async #onAddTag() {
    const input = this.element?.querySelector(".av-tag-input");
    if (!input) return;
    await this.#doAddTag(input.value);
  }

  static async #onRemoveTag(event, target) {
    const tag = target.dataset.tag;
    if (!tag || !this.selectedFile) return;
    const index = game.assetVault?.index;
    if (!index) return;
    const entry = index.getEntry(this.selectedFile.path);
    if (!entry) return;
    const newTags = entry.userTags.filter(t => t !== tag);
    await index.updateUserTags(this.selectedFile.path, newTags);
    this.#renderDetailPanel();
  }
}
