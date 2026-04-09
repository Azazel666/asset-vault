import { SearchAutocomplete } from "../search/SearchAutocomplete.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  #browseResult = null;
  #sidebarRootDirs = null;
  #sidebarSourceKey = null;
  #sidebarCollapsed = false;
  #searchFilters = [];
  #searchFreeText = "";
  #searchCursorStart = 0;
  #searchCursorEnd = 0;
  #lastBrowsePath = "";
  #lastBrowseSource = "data";
  #indexStatusHook = null;
  #autocomplete = null;
  #activeMedia = null;
  selectedFile = null;

  get #searchQuery() {
    const ops = this.#searchFilters.map(f => `[${f.key}:${f.value}]`).join(" ");
    return [ops, this.#searchFreeText].filter(Boolean).join(" ");
  }

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
      removeTag: AssetVaultHub.#onRemoveTag,
      removeSearchFilter: AssetVaultHub.#onRemoveSearchFilter,
      toggleTypeFilter:   AssetVaultHub.#onToggleTypeFilter,
      toggleSourceFilter: AssetVaultHub.#onToggleSourceFilter,
      toggleTagFilter:    AssetVaultHub.#onToggleTagFilter,
      clearAllFilters:    AssetVaultHub.#onClearAllFilters
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
    const isSearchMode = this.#searchFilters.length > 0 || this.#searchFreeText.length > 0;

    let filterFacets = null;
    if (isSearchMode) {
      // Search mode: skip FilePicker.browse, return index results
      const index = game.assetVault?.index;
      if (index?.status === "ready") {
        const extensions = this.pickerOptions.extensions ?? null;
        const rawEntries = index.search(this.#searchQuery);
        const filteredEntries = extensions
          ? rawEntries.filter(e => extensions.some(ext => e.path.toLowerCase().endsWith(ext)))
          : rawEntries;
        files = filteredEntries.map(entry => {
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
        filterFacets = this.#computeSearchFacets(filteredEntries);
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
      searchQuery: this.#searchFreeText,
      searchFilters: this.#searchFilters,
      filterFacets,
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
    }

    // Wire search input + autocomplete
    const searchInput = this.element.querySelector(".av-search-input");
    const clearBtn = this.element.querySelector(".av-search-clear");

    if (searchInput) {
      searchInput.value = this.#searchFreeText;
      const hasSearch = this.#searchFilters.length > 0 || this.#searchFreeText.length > 0;
      if (clearBtn) clearBtn.style.display = hasSearch ? "" : "none";

      // Restore focus and cursor position after re-render so typing isn't disrupted
      if (this.#searchFreeText) {
        searchInput.focus();
        searchInput.setSelectionRange(this.#searchCursorStart, this.#searchCursorEnd);
      }

      // Show/hide clear button immediately as user types (before debounce)
      searchInput.addEventListener("input", e => {
        const hasAny = e.target.value || this.#searchFilters.length > 0;
        if (clearBtn) clearBtn.style.display = hasAny ? "" : "none";
      });
    }

    // Create or reattach the autocomplete
    if (!this.#autocomplete) {
      this.#autocomplete = new SearchAutocomplete(
        this.element,
        () => this.element.querySelector(".av-search-input"),
        (key, value) => {
          // Operator chip confirmed — add to filters, clear free text, re-render
          const wasSearching = this.#searchFreeText.length > 0 || this.#searchFilters.length > 0;
          if (!wasSearching) {
            this.#lastBrowsePath = this.target;
            this.#lastBrowseSource = this.activeSource;
          }
          this.#searchFilters = [...this.#searchFilters, { key, value }];
          this.#searchFreeText = "";
          this.#searchCursorStart = 0;
          this.#searchCursorEnd = 0;
          this.render();
        },
        foundry.utils.debounce((text) => {
          const curInput = this.element?.querySelector(".av-search-input");
          this.#searchCursorStart = curInput?.selectionStart ?? 0;
          this.#searchCursorEnd   = curInput?.selectionEnd   ?? 0;
          const wasSearching = this.#searchFreeText.length > 0 || this.#searchFilters.length > 0;
          if (text && !wasSearching) {
            this.#lastBrowsePath   = this.target;
            this.#lastBrowseSource = this.activeSource;
          }
          this.#searchFreeText = text;
          if (text || this.#searchFilters.length > 0) this.render();
          else this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
        }, 150)
      );
    }
    if (searchInput) this.#autocomplete.attach(searchInput);

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        clearBtn.style.display = "none";
        this.#searchFreeText = "";
        this.#searchFilters = [];
        this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
      });
    }

    // Search syntax hint toggle
    const hintBtn = this.element.querySelector(".av-search-hint-btn");
    const hintEl  = this.element.querySelector(".av-search-hint");
    if (hintBtn && hintEl) {
      hintBtn.addEventListener("click", () => {
        hintEl.toggleAttribute("hidden");
        hintBtn.classList.toggle("active", !hintEl.hasAttribute("hidden"));
      });
    }

    // Wire tag input Enter key
    this.#wireTagInput();

    // Re-wire loadedmetadata after a full re-render (e.g. index status hook fires while a file is selected)
    const renderedMedia = this.element.querySelector(".av-detail-panel audio, .av-detail-panel video");
    if (renderedMedia && renderedMedia !== this.#activeMedia) {
      if (this.#activeMedia) this.#activeMedia.pause();
      this.#activeMedia = renderedMedia;
      renderedMedia.addEventListener("loadedmetadata", () => this.#updateMediaMeta(renderedMedia), { once: true });
    } else if (!renderedMedia) {
      this.#activeMedia = null;
    }

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
    this.#stopActiveMedia();
    this.#autocomplete?.destroy();
    this.#autocomplete = null;
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
    this.#stopActiveMedia();
    const f = this.selectedFile;
    if (!f) { panel.hidden = true; return; }

    const esc = s => String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let previewHtml;
    if (f.isImage) {
      previewHtml = `<img class="av-detail-img" src="${esc(f.path)}" alt="${esc(f.name)}" />`;
    } else if (f.isVideo) {
      previewHtml = `<video class="av-detail-video" src="${esc(f.path)}" controls preload="metadata"></video>`;
    } else if (f.isAudio) {
      previewHtml = `<audio class="av-detail-audio" src="${esc(f.path)}" controls preload="metadata"></audio>`;
    } else {
      const icon = f.isPdf ? "fa-file-pdf" : "fa-file";
      previewHtml = `<i class="fa-solid ${icon} av-detail-type-icon"></i>`;
    }

    const mediaMeta = (f.isAudio || f.isVideo)
      ? `<div class="av-detail-media-meta"></div>`
      : "";

    panel.innerHTML = `
      <div class="av-detail-preview-area">${previewHtml}</div>
      <div class="av-detail-meta">
        <div class="av-detail-filename" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="av-detail-path" title="${esc(f.path)}">${esc(f.path)}</div>
        <div class="av-detail-filetype">${esc(f.fileType)}</div>
        ${mediaMeta}
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

    // Wire loadedmetadata for duration / dimensions
    const mediaEl = panel.querySelector("audio, video");
    if (mediaEl) {
      this.#activeMedia = mediaEl;
      mediaEl.addEventListener("loadedmetadata", () => this.#updateMediaMeta(mediaEl), { once: true });
    }
  }

  #stopActiveMedia() {
    if (!this.#activeMedia) return;
    this.#activeMedia.pause();
    this.#activeMedia = null;
  }

  #updateMediaMeta(el) {
    const metaEl = this.element?.querySelector(".av-detail-media-meta");
    if (!metaEl) return;
    const parts = [];
    if (isFinite(el.duration) && el.duration > 0) {
      parts.push(`${game.i18n.localize("asset-vault.detail.duration")}: ${AssetVaultHub.#formatDuration(el.duration)}`);
    }
    if (el.tagName === "VIDEO" && el.videoWidth > 0 && el.videoHeight > 0) {
      parts.push(`${game.i18n.localize("asset-vault.detail.dimensions")}: ${el.videoWidth}\u00d7${el.videoHeight}`);
    }
    metaEl.textContent = parts.join("  \u00b7  ");
  }

  static #formatDuration(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
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
    this.#stopActiveMedia();
    if (source !== this.activeSource) {
      this.#sidebarRootDirs = null;
      this.#sidebarSourceKey = null;
    }
    this.activeSource = source;
    this.target = path;
    this.#browseResult = null;
    this.selectedFile = null;
    this.#searchFreeText = "";
    this.#searchFilters = [];
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

  static #onRemoveSearchFilter(event, target) {
    const { key, value } = target.dataset;
    this.#searchFilters = this.#searchFilters.filter(f => !(f.key === key && f.value === value));
    if (this.#searchFilters.length === 0 && !this.#searchFreeText) {
      this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
    } else {
      this.render();
    }
  }

  static #onToggleTypeFilter(event, target) {
    this.#toggleFilter("type", target.dataset.value);
  }

  static #onToggleSourceFilter(event, target) {
    this.#toggleFilter("source", target.dataset.value);
  }

  static #onToggleTagFilter(event, target) {
    this.#toggleFilter("tag", target.dataset.value);
  }

  static #onClearAllFilters() {
    this.#searchFilters = [];
    if (!this.#searchFreeText) this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
    else this.render();
  }

  #toggleFilter(key, value) {
    const exists = this.#searchFilters.some(f => f.key === key && f.value === value);
    if (exists) {
      this.#searchFilters = this.#searchFilters.filter(f => !(f.key === key && f.value === value));
    } else {
      const wasSearching = this.#searchFreeText.length > 0 || this.#searchFilters.length > 0;
      if (!wasSearching) {
        this.#lastBrowsePath   = this.target;
        this.#lastBrowseSource = this.activeSource;
      }
      this.#searchFilters = [...this.#searchFilters, { key, value }];
    }
    if (this.#searchFilters.length === 0 && !this.#searchFreeText) {
      this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
    } else {
      this.render();
    }
  }

  #computeSearchFacets(entries) {
    const typeCounts = new Map([["image", 0], ["video", 0], ["audio", 0], ["pdf", 0]]);
    const sourceMap  = new Map();
    const tagMap     = new Map();

    for (const e of entries) {
      if (typeCounts.has(e.type)) typeCounts.set(e.type, typeCounts.get(e.type) + 1);
      sourceMap.set(e.source, (sourceMap.get(e.source) ?? 0) + 1);
      for (const tag of [...(e.autoTags ?? []), ...(e.userTags ?? [])]) {
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
      }
    }

    const af = this.#searchFilters;

    const TYPE_LABEL_KEYS = {
      image: "asset-vault.content.typeImage",
      video: "asset-vault.content.typeVideo",
      audio: "asset-vault.content.typeAudio",
      pdf:   "asset-vault.content.typePdf"
    };
    const types = ["image", "video", "audio", "pdf"]
      .filter(t => typeCounts.get(t) > 0)
      .map(t => ({
        key:    t,
        label:  game.i18n.localize(TYPE_LABEL_KEYS[t]),
        count:  typeCounts.get(t),
        active: af.some(f => f.key === "type" && f.value === t)
      }));

    const worldItems = [], moduleItems = [], systemItems = [], assetItems = [], otherItems = [];
    for (const [src, count] of [...sourceMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const item = { key: src, count, active: af.some(f => f.key === "source" && f.value === src) };
      if (src === "world:current") {
        worldItems.push({ ...item, label: game.i18n.localize("asset-vault.scanLocations.currentWorld") });
      } else if (src.startsWith("module:")) {
        moduleItems.push({ ...item, label: src.slice("module:".length) });
      } else if (src.startsWith("system:")) {
        systemItems.push({ ...item, label: src.slice("system:".length) });
      } else if (src === "assets") {
        assetItems.push({ ...item, label: game.i18n.localize("asset-vault.scanLocations.globalAssets") });
      } else {
        otherItems.push({ ...item, label: src });
      }
    }

    const sourceGroups = [];
    if (worldItems.length)  sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.currentWorld"), items: worldItems });
    if (moduleItems.length) sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.modules"),      items: moduleItems });
    if (systemItems.length) sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.systems"),      items: systemItems });
    if (assetItems.length)  sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.globalAssets"), items: assetItems });
    if (otherItems.length)  sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.otherFolders"), items: otherItems });

    const topTags = [...tagMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({
        tag, count,
        active: af.some(f => f.key === "tag" && f.value === tag)
      }));

    return { types, sourceGroups, topTags, hasActiveFilters: af.length > 0 };
  }
}
