const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { FilePicker } = foundry.applications.apps;

export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
  #browseResult = null;
  #sidebarRootDirs = null;
  #sidebarSourceKey = null;
  #sidebarCollapsed = false;
  #searchQuery = "";
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
    position: { width: 960, height: 620 },
    actions: {
      pickDirectory: AssetVaultHub.#onPickDirectory,
      backTraverse: AssetVaultHub.#onBackTraverse,
      setSource: AssetVaultHub.#onSetSource,
      setViewMode: AssetVaultHub.#onSetViewMode,
      toggleSidebar: AssetVaultHub.#onToggleSidebar,
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
            const fileType = isImage ? "Image" : isVideo ? "Video" : isAudio ? "Audio" : isPdf ? "PDF" : "File";
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
            const fileType = isImage ? "Image" : isVideo ? "Video" : isAudio ? "Audio" : isPdf ? "PDF" : "File";
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
      selectedFile: this.selectedFile,
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

      // Restore focus after re-render so typing isn't disrupted
      if (this.#searchQuery) {
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
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
}
