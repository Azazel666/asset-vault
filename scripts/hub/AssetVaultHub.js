import { SearchAutocomplete } from "../search/SearchAutocomplete.js";
import { VirtualScroller } from "./VirtualScroller.js";

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
  #fileIndexedHook = null;
  #autocomplete = null;
  #restoreSearchFocus = false;
  #activeMedia = null;
  #viewMode = null;
  #popoutWindow = null;
  #isDetaching = false;
  #currentItems = [];
  #virtualScroller = null;
  #highlightFilePath = null;
  selectedFile = null;

  get #isDetached() {
    return !!this.#popoutWindow && !this.#popoutWindow.closed;
  }

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
      this.#highlightFilePath = cur;
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
      copyClass: AssetVaultHub.#onCopyClass,
      addTag: AssetVaultHub.#onAddTag,
      removeTag: AssetVaultHub.#onRemoveTag,
      removeSearchFilter: AssetVaultHub.#onRemoveSearchFilter,
      toggleTypeFilter:   AssetVaultHub.#onToggleTypeFilter,
      toggleSourceFilter: AssetVaultHub.#onToggleSourceFilter,
      toggleTagFilter:    AssetVaultHub.#onToggleTagFilter,
      clearAllFilters:    AssetVaultHub.#onClearAllFilters,
      detachWindow:       AssetVaultHub.#onDetachWindow,
      uploadFile:         AssetVaultHub.#onUploadFile,
      navigateFavorite:   AssetVaultHub.#onNavigateFavorite,
      toggleFavorite:     AssetVaultHub.#onToggleFavorite
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
        files = filteredEntries
          .filter(entry => this.#isEntryAllowed(entry))
          .map(entry => {
            const isIcon = entry.type === "icon";
            const isImage = entry.type === "image";
            const isVideo = entry.type === "video";
            const isAudio = entry.type === "audio";
            const isPdf = entry.type === "pdf";
            const fileType = game.i18n.localize(isIcon ? "asset-vault.content.typeIcon" : isImage ? "asset-vault.content.typeImage" : isVideo ? "asset-vault.content.typeVideo" : isAudio ? "asset-vault.content.typeAudio" : isPdf ? "asset-vault.content.typePdf" : "asset-vault.content.typeFile");
            return {
              name: entry.name,
              path: entry.path,
              source: entry.source,
              isIcon, isImage, isVideo, isAudio, isPdf, fileType,
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

      // Player access restriction for browse mode
      if (!browseError && !game.user.isGM && this.target && !this.#isPathNavigable(this.target)) {
        browseError = game.i18n.localize("asset-vault.access.restricted");
        this.#browseResult = null;
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

        // Apply player access restrictions
        if (!game.user.isGM) {
          // Only show directories that are navigable (either allowed or lead to an allowed path)
          dirs = dirs.filter(d => this.#isPathNavigable(d.path));
          // Only show files if the current directory is explicitly in the allowed list
          if (!this.#isPathAllowed(this.target)) {
            files = [];
          }
        }
      }

      // Load sidebar root dirs (cached per source)
      await this.#loadSidebarRootDirs();
    }

    // Build the flat items array for the VirtualScroller
    const folderType = game.i18n.localize("asset-vault.content.typeFolder");
    this.#currentItems = [
      ...dirs.map(d => ({ ...d, isDir: true, fileType: folderType })),
      ...files.map(f => ({ ...f, isDir: false }))
    ];

    // Auto-select and show detail panel for the currently-set file when picker first opens
    if (!this.selectedFile && this.pickerOptions.current) {
      const match = this.#currentItems.find(item => !item.isDir && item.path === this.pickerOptions.current);
      if (match) {
        match.isSelected = true;
        this.selectedFile = match;
      }
    }

    if (this.#viewMode === null) this.#viewMode = game.settings.get("asset-vault", "viewMode");
    const viewMode = this.#viewMode;
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
        userTags: entry?.userTags ?? [],
        unicode: entry?.meta?.unicode ?? null
      };
    }

    const canUpload = game.user.isGM && !isSearchMode && this.activeSource !== "s3";
    const isRestricted = !game.user.isGM;
    const canEditTags = game.user.isGM;

    const canFavorite = !isSearchMode && !!this.target && this.activeSource !== "s3";
    const isFavorited = canFavorite
      && this.#favorites.some(f => f.path === this.target && f.source === this.activeSource);

    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      isDetached: this.#isDetached,
      canDetach: game.user.isGM,
      isRestricted,
      canEditTags,
      canUpload,
      canFavorite,
      isFavorited,
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
      noResults: !isSearchMode && dirs.length + files.length === 0,
      searchNoResults: isSearchMode && files.length === 0,
      browseError,
      breadcrumbs: this.#buildBreadcrumbs(),
      activeSource: this.activeSource,
      sources: availableSources
        .filter(s => game.user.isGM || s === "data")
        .map(s => ({
          key: s,
          label: AssetVaultHub.#sourceLabel(s),
          active: s === this.activeSource
        })),
      sidebarTree: this.#buildSidebarTree(),
      favorites: this.#favorites,
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

  async _onFirstRender(context, options) {
    // Create context menus once — event delegation on this.element survives re-renders
    this._createContextMenu(this._getFileContextOptions, ".av-item-file", {
      fixed: true,
      hookName: "getAssetVaultFileContextOptions",
      parentClassHooks: false
    });
    this._createContextMenu(this._getFolderContextOptions, ".av-item-dir", {
      fixed: true,
      hookName: "getAssetVaultFolderContextOptions",
      parentClassHooks: false
    });

    // Auto-detach if the user previously chose detached mode (hub mode only)
    if (this.mode === "hub" && game.settings.get("asset-vault", "detachedMode")) {
      await this.#openDetachedWindow();
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#updateDetachButton();

    // Register index status hook once — re-renders the hub when indexing starts/finishes
    if (!this.#indexStatusHook) {
      this.#indexStatusHook = () => this.render();
      Hooks.on("assetVault.indexStatus", this.#indexStatusHook);
    }

    // Register file-indexed hook once — refreshes browse/search when a new file is uploaded
    if (!this.#fileIndexedHook) {
      this.#fileIndexedHook = (filePath) => {
        const isSearchMode = this.#searchFilters.length > 0 || this.#searchFreeText.length > 0;
        if (isSearchMode) {
          // New file is already in the index; re-render to include it in results
          this.render();
        } else {
          // In browse mode: only refresh if the file landed in the current directory
          const fileDir = filePath.includes("/")
            ? filePath.substring(0, filePath.lastIndexOf("/"))
            : "";
          if (fileDir === this.target) {
            this.#browseResult = null;
            this.render();
          }
        }
      };
      Hooks.on("assetVault.fileIndexed", this.#fileIndexedHook);
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
      } else if (this.#restoreSearchFocus) {
        this.#restoreSearchFocus = false;
        searchInput.focus();
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
          else {
            this.#restoreSearchFocus = true;
            this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
          }
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
        this.#restoreSearchFocus = true;
        this.navigate(this.#lastBrowsePath, this.#lastBrowseSource);
      });
    }

    // Wire upload file input
    const uploadInput = this.element.querySelector(".av-upload-input");
    if (uploadInput) {
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files);
        e.target.value = ""; // reset so the same file can be re-uploaded
        if (files.length) await this.#doUploadFiles(files);
      });
    }

    // Scroll breadcrumb to the right so the current directory is always visible
    const breadcrumbNav = this.element.querySelector(".av-breadcrumb");
    if (breadcrumbNav) breadcrumbNav.scrollLeft = breadcrumbNav.scrollWidth;

    // Wire right-click on favorite items in sidebar
    for (const item of this.element.querySelectorAll(".av-favorite-item")) {
      item.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        this.#onFavoriteContextMenu(e, item);
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

    // Wire the VirtualScroller for the items container
    this.#virtualScroller?.destroy();
    this.#virtualScroller = null;
    const contentEl = this.element.querySelector(".av-content");
    const itemsEl   = this.element.querySelector(".av-items");
    if (contentEl && itemsEl && this.#currentItems.length > 0) {
      const vm = this.#viewMode ?? "grid";
      this.#virtualScroller = new VirtualScroller({
        container:  contentEl,
        grid:       itemsEl,
        items:      this.#currentItems,
        viewMode:   vm,
        renderItem: (item) => this.#makeItemElement(item),
        wireItems:  (els)  => this.#wireItemElements(els)
      });

      // Scroll to a specific file — deferred one frame so the VirtualScroller has
      // rendered its initial slice before scrollToIndex measures from the DOM.
      if (this.#highlightFilePath) {
        const path = this.#highlightFilePath;
        this.#highlightFilePath = null;
        requestAnimationFrame(() => {
          if (!this.#virtualScroller) return;
          const idx = this.#currentItems.findIndex(item => item.path === path);
          if (idx >= 0) this.#virtualScroller.scrollToIndex(idx);
        });
      }
    }

    // Wire image viewer for the template-rendered detail panel (pre-selected file on open,
    // or any re-render while a file is selected). #renderDetailPanel() handles the
    // click-selected case separately; this covers the Handlebars template path.
    const templatePreview = this.element.querySelector(".av-detail-preview-area");
    if (templatePreview && !templatePreview.dataset.viewerWired) {
      templatePreview.dataset.viewerWired = "1";
      this.#wireImageViewer(templatePreview);
    }

    // Wire drop zone for OS-file drag-and-drop uploads (wire once per element lifetime)
    if (contentEl && !contentEl.dataset.dropWired && this.element.querySelector(".av-upload-input")) {
      contentEl.dataset.dropWired = "1";
      this.#wireDropZone(contentEl);
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
    if (this.#fileIndexedHook) {
      Hooks.off("assetVault.fileIndexed", this.#fileIndexedHook);
      this.#fileIndexedHook = null;
    }
    this.#virtualScroller?.destroy();
    this.#virtualScroller = null;
    this.#stopActiveMedia();
    this.#autocomplete?.destroy();
    this.#autocomplete = null;
    // Close popup window when Hub is closed programmatically (e.g. picker confirmed)
    if (this.#isDetached && !this.#isDetaching) {
      this.#isDetaching = true;
      const pop = this.#popoutWindow;
      this.#popoutWindow = null;
      try { pop.close(); } catch { /* ignore */ }
      this.#isDetaching = false;
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
      .filter(d => this.#isPathNavigable(d))
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
    const key = `asset-vault.source.${source}`;
    const loc = game.i18n.localize(key);
    return loc !== key ? loc : source;
  }

  /** Returns the array of player-accessible path prefixes. */
  #getAllowedPaths() {
    const raw = game.settings.get("asset-vault", "playerVisiblePaths");
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * Returns true if a file can be shown at this path (path is explicitly in the allowed list
   * or is a descendant of an allowed prefix). Root always returns false — no files at root.
   */
  #isPathAllowed(path) {
    if (game.user.isGM) return true;
    if (!path) return false; // root: always navigable but files are never shown there
    const allowed = this.#getAllowedPaths();
    return allowed.some(p => path === p || path.startsWith(p + "/"));
  }

  /**
   * Returns true if a directory can appear in listings or be navigated to.
   * Includes ancestor dirs that lead toward an allowed path (e.g. "systems" is
   * navigable when "systems/pf2e" is allowed, even though "systems" itself is not).
   */
  #isPathNavigable(path) {
    if (game.user.isGM) return true;
    if (!path) return true; // root is always navigable
    const allowed = this.#getAllowedPaths();
    return allowed.some(p =>
      path === p ||
      path.startsWith(p + "/") ||  // path is inside an allowed subtree
      p.startsWith(path + "/")     // path is an ancestor leading to an allowed location
    );
  }

  /** Returns true if a search index entry is accessible to the current player. */
  #isEntryAllowed(entry) {
    if (game.user.isGM) return true;
    const allowed = this.#getAllowedPaths();
    return allowed.some(p => entry.path === p || entry.path.startsWith(p + "/"));
  }

  #fileDataFromElement(el) {
    return {
      path: el.dataset.path,
      name: el.dataset.name,
      isIcon: el.dataset.isIcon === "true",
      isImage: el.dataset.isImage === "true",
      isVideo: el.dataset.isVideo === "true",
      isAudio: el.dataset.isAudio === "true",
      isPdf: el.dataset.isPdf === "true",
      fileType: el.dataset.fileType
    };
  }

  #applySelectionToDOM(selectedEl) {
    // Keep #currentItems in sync so VirtualScroller re-renders (e.g. triggered by
    // the panel opening and causing a ResizeObserver layout change) use the correct state.
    const selectedPath = selectedEl.dataset.path;
    for (const item of this.#currentItems) {
      item.isSelected = item.path === selectedPath;
    }

    this.element.querySelectorAll(".av-item.selected").forEach(el => el.classList.remove("selected"));
    selectedEl.classList.add("selected");
    const footerBtn = this.element.querySelector(".av-select-btn");
    if (footerBtn) footerBtn.disabled = false;
    this.#renderDetailPanel();
  }

  /* -------------------------------------------- */
  /*  Virtual scroller helpers                    */
  /* -------------------------------------------- */

  /** Build one item element from the flat item data object. */
  #makeItemElement(item) {
    const el = document.createElement("div");

    if (item.isDir) {
      el.className = "av-item av-item-dir";
      el.dataset.action = "pickDirectory";
      el.dataset.path = item.path;
      el.dataset.name = item.name;
      el.title = item.name;
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-folder av-item-icon";
      const nameEl = document.createElement("span");
      nameEl.className = "av-item-name";
      nameEl.textContent = item.name;
      const typeEl = document.createElement("span");
      typeEl.className = "av-item-type";
      typeEl.textContent = item.fileType;
      el.append(icon, nameEl, typeEl);
    } else {
      el.className = `av-item av-item-file${item.isSelected ? " selected" : ""}`;
      el.dataset.action = "selectFile";
      el.dataset.path = item.path;
      el.dataset.name = item.name;
      if (item.isIcon)  el.dataset.isIcon  = "true";
      if (item.isImage) el.dataset.isImage = "true";
      if (item.isVideo) el.dataset.isVideo = "true";
      if (item.isAudio) el.dataset.isAudio = "true";
      if (item.isPdf)   el.dataset.isPdf   = "true";
      el.dataset.fileType = item.fileType ?? "";
      el.title = item.name;

      let thumb;
      if (item.isIcon) {
        thumb = document.createElement("i");
        // item.path is an FA class string like "fa-solid fa-dragon"
        thumb.className = `${item.path} av-item-icon av-item-icon--fa`;
      } else if (item.isImage) {
        thumb = document.createElement("img");
        thumb.className = "av-thumb";
        thumb.src = item.path;
        thumb.loading = "lazy";
        thumb.alt = item.name;
        thumb.draggable = false;
      } else {
        thumb = document.createElement("i");
        const iconClass = item.isVideo ? "fa-file-video"
          : item.isAudio ? "fa-file-audio"
          : item.isPdf   ? "fa-file-pdf"
          : "fa-file";
        thumb.className = `fa-solid ${iconClass} av-item-icon`;
      }
      const nameEl = document.createElement("span");
      nameEl.className = "av-item-name";
      nameEl.textContent = item.name;
      const typeEl = document.createElement("span");
      typeEl.className = "av-item-type";
      typeEl.textContent = item.fileType ?? "";
      el.append(thumb, nameEl, typeEl);

      // Cross-world badge — shown only for files from other worlds (search results)
      if (item.source?.startsWith("world:") && item.source !== "world:current") {
        const worldId = item.source.slice("world:".length);
        const badge = document.createElement("span");
        badge.className = "av-world-badge";
        badge.title = game.i18n.format("asset-vault.content.crossWorldBadge", { id: worldId });
        badge.innerHTML = `<i class="fa-solid fa-globe"></i> ${worldId}`;
        el.appendChild(badge);
      }
    }

    return el;
  }

  /** Wire drag-and-drop on freshly rendered file elements (hub mode only). */
  #wireItemElements(els) {
    if (this.mode !== "hub") return;
    for (const el of els) {
      if (!el.classList.contains("av-item-file")) continue;
      el.draggable = true;
      el.addEventListener("dragstart", ev => this.#onDragStart(ev));
    }
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
    if (f.isIcon) {
      previewHtml = `<i class="${esc(f.path)} av-detail-icon-glyph"></i>`;
    } else if (f.isImage) {
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

    let unicodeLine = "";
    if (f.isIcon) {
      const entry = game.assetVault?.index?.getEntry(f.path);
      const uni = entry?.meta?.unicode;
      if (uni) unicodeLine = `<div class="av-detail-unicode">U+${uni.toUpperCase()}</div>`;
    }

    const actionBtn = f.isIcon
      ? `<button type="button" class="av-copy-btn" data-action="copyClass">
           <i class="fa-solid fa-copy"></i> ${game.i18n.localize("asset-vault.actions.copyClass")}
         </button>`
      : `<button type="button" class="av-copy-btn" data-action="copyUrl">
           <i class="fa-solid fa-copy"></i> ${game.i18n.localize("asset-vault.actions.copyUrl")}
         </button>`;

    panel.innerHTML = `
      <div class="av-detail-preview-area">${previewHtml}</div>
      <div class="av-detail-meta">
        <div class="av-detail-filename" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="av-detail-path" title="${esc(f.path)}">${esc(f.path)}</div>
        <div class="av-detail-filetype">${esc(f.fileType)}</div>
        ${unicodeLine}${mediaMeta}
      </div>
      <div class="av-detail-actions">${actionBtn}</div>
      ${this.#buildTagsHtml(f)}
    `;
    panel.removeAttribute("hidden");
    this.#wireTagInput();

    const previewArea = panel.querySelector(".av-detail-preview-area");
    if (previewArea) this.#wireImageViewer(previewArea);

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

  /* -------------------------------------------- */
  /*  Detached window                             */
  /* -------------------------------------------- */

  async #openDetachedWindow() {
    if (this.#isDetached || !this.element) return;
    const pos = this.position;
    const w = Math.max(pos.width ?? 960, AssetVaultHub.#MIN_WIDTH);
    const h = Math.max(pos.height ?? 640, AssetVaultHub.#MIN_HEIGHT);

    const pop = window.open(
      "about:blank", "asset-vault-popout",
      `width=${w},height=${h},resizable=yes,scrollbars=no,location=no,menubar=no,toolbar=no,status=no`
    );
    if (!pop) {
      ui.notifications.warn(game.i18n.localize("asset-vault.detach.popupBlocked"));
      return;
    }

    this.#popoutWindow = pop;

    // Write base HTML structure to popup
    pop.document.open();
    pop.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${this.title}</title></head><body style="margin:0;overflow:hidden"></body></html>`);
    pop.document.close();

    // Copy all stylesheets from parent window
    for (const link of document.querySelectorAll("link[rel='stylesheet']")) {
      const newLink = pop.document.createElement("link");
      newLink.rel = "stylesheet";
      newLink.href = link.href;
      pop.document.head.appendChild(newLink);
    }
    for (const style of document.querySelectorAll("style")) {
      const newStyle = pop.document.createElement("style");
      newStyle.textContent = style.textContent;
      pop.document.head.appendChild(newStyle);
    }

    // Copy CSS custom properties (Foundry theme variables) from parent
    const htmlStyles = window.getComputedStyle(document.documentElement);
    const bodyStyles = window.getComputedStyle(document.body);
    let varCSS = ":root {";
    for (const prop of htmlStyles) {
      if (prop.startsWith("--")) varCSS += `${prop}:${htmlStyles.getPropertyValue(prop)};`;
    }
    varCSS += "} body {";
    for (const prop of bodyStyles) {
      if (prop.startsWith("--")) varCSS += `${prop}:${bodyStyles.getPropertyValue(prop)};`;
    }
    varCSS += "}";
    const varStyle = pop.document.createElement("style");
    varStyle.textContent = varCSS;
    pop.document.head.appendChild(varStyle);

    // Mirror body classes for theming
    pop.document.body.className = document.body.className;

    // Move the Hub element to the popup
    const adopted = pop.document.adoptNode(this.element);
    pop.document.body.appendChild(adopted);

    // Resize to fill the popup window
    this.setPosition({ left: 0, top: 0, width: w, height: h });
    this.#updateDetachButton();

    // When user closes the popup window with the OS close button
    pop.addEventListener("beforeunload", () => {
      if (this.#isDetaching) return;
      this.#popoutWindow = null;
      this.close();
    });
  }

  #closeDetachedWindow() {
    if (!this.#isDetached) return;
    this.#isDetaching = true;
    const pop = this.#popoutWindow;

    // Move element back to main window
    const adopted = document.adoptNode(this.element);
    document.body.appendChild(adopted);

    this.#popoutWindow = null;
    try { pop.close(); } catch { /* ignore */ }
    this.#isDetaching = false;

    // Restore a sensible position
    this.setPosition({
      left: undefined,
      top: undefined,
      width: AssetVaultHub.DEFAULT_OPTIONS.position.width,
      height: AssetVaultHub.DEFAULT_OPTIONS.position.height
    });
    this.bringToFront();
    this.#updateDetachButton();
  }

  #updateDetachButton() {
    const btn = this.element?.querySelector("[data-action='detachWindow']");
    if (!btn) return;
    const icon = btn.querySelector("i");
    if (icon) {
      icon.className = this.#isDetached
        ? "fa-solid fa-down-left-and-up-right-to-center"
        : "fa-solid fa-up-right-from-square";
    }
    btn.title = game.i18n.localize(
      this.#isDetached ? "asset-vault.toolbar.attach" : "asset-vault.toolbar.detach"
    );
  }

  static async #onDetachWindow() {
    if (this.#isDetached) {
      await this.#closeDetachedWindow();
    } else {
      await this.#openDetachedWindow();
    }
  }

  static #onUploadFile() {
    this.element.querySelector(".av-upload-input")?.click();
  }

  #onDragStart(event) {
    // Handler is only registered in hub mode — use currentTarget (the item element)
    const item = event.currentTarget;

    const { path, name } = item.dataset;
    const isIcon  = item.dataset.isIcon  === "true";
    const isImage = item.dataset.isImage === "true";
    const isAudio = item.dataset.isAudio === "true";

    // FA icons have no meaningful drop target
    if (isIcon) { event.preventDefault(); return; }

    event.dataTransfer.effectAllowed = "copy";

    if (isImage) {
      // text/plain must be the raw URL (not JSON) for ProseMirror RTE drops.
      // Foundry's ProseMirrorContentLinkPlugin reads text/plain as JSON; if
      // data.type is truthy it calls event.stopPropagation() + return true,
      // which prevents ProseMirror from inserting the image slice.
      // A plain URL fails JSON.parse → getDragEventData returns {} → plugin
      // exits early, and ProseMirror uses text/html to insert the image.
      // Canvas Tile creation is handled via a dropCanvasData hook in module.js.
      event.dataTransfer.setData("text/plain", path);
      // Rich text editor (ProseMirror / TinyMCE) image insertion
      event.dataTransfer.setData("text/html", `<img src="${path}">`);

      // Use thumbnail as drag ghost
      const img = item.querySelector("img.av-thumb");
      if (img?.complete && img.naturalWidth > 0) {
        event.dataTransfer.setDragImage(img, img.offsetWidth / 2, img.offsetHeight / 2);
      }
    } else if (isAudio) {
      // Canvas AmbientSound drop via PlaylistSound data format
      event.dataTransfer.setData("text/plain", JSON.stringify({
        type: "PlaylistSound",
        data: { path, name, volume: 0.5 }
      }));
    } else {
      // Video, PDF, other — provide path only; canvas silently ignores unknown types
      event.dataTransfer.setData("text/plain", path);
    }

    // Visual feedback during drag
    item.classList.add("av-dragging");
    item.addEventListener("dragend", () => item.classList.remove("av-dragging"), { once: true });
  }

  /* -------------------------------------------- */
  /*  Favorites                                   */
  /* -------------------------------------------- */

  get #favorites() {
    return game.user.getFlag("asset-vault", "favorites") ?? [];
  }

  async #saveFavorites(list) {
    await game.user.setFlag("asset-vault", "favorites", list);
  }

  static #onNavigateFavorite(event, target) {
    const { path, source } = target.dataset;
    this.#searchFreeText = "";
    this.#searchFilters = [];
    this.navigate(path, source);
  }

  static async #onToggleFavorite() {
    const path = this.target;
    const source = this.activeSource;
    const favs = this.#favorites;
    const idx = favs.findIndex(f => f.path === path && f.source === source);
    if (idx >= 0) {
      const fav = favs[idx];
      await this.#saveFavorites(favs.filter((_, i) => i !== idx));
      ui.notifications.info(game.i18n.format("asset-vault.favorites.removed", { label: fav.label }));
    } else {
      const label = path.split("/").pop() || AssetVaultHub.#sourceLabel(source);
      await this.#saveFavorites([...favs, { path, source, label }]);
      ui.notifications.info(game.i18n.format("asset-vault.favorites.added", { label }));
    }
    this.render();
  }

  async #onFavoriteContextMenu(event, item) {
    const idx = parseInt(item.dataset.index, 10);
    const favs = this.#favorites;
    const fav = favs[idx];
    if (!fav) return;

    // Remove any existing inline menu
    document.querySelector(".av-fav-ctx-menu")?.remove();

    const menu = document.createElement("ul");
    menu.className = "av-fav-ctx-menu";
    menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:9999`;

    const mkItem = (icon, label, handler) => {
      const li = document.createElement("li");
      li.innerHTML = `${icon} ${label}`;
      li.addEventListener("click", async () => { menu.remove(); await handler(); });
      menu.append(li);
    };

    mkItem('<i class="fa-solid fa-pencil"></i>',
      game.i18n.localize("asset-vault.favorites.rename"),
      async () => {
        const { DialogV2 } = foundry.applications.api;
        const result = await DialogV2.input({
          window: { title: game.i18n.localize("asset-vault.favorites.rename") },
          content: `<div class="form-group"><label>${game.i18n.localize("asset-vault.favorites.renamePrompt")}
            <input type="text" name="label" value="${fav.label}" autofocus></label></div>`,
          ok: { callback: (event, button) => button.form.elements.label.value.trim() }
        });
        if (!result) return;
        await this.#saveFavorites(favs.map((f, i) => i === idx ? { ...f, label: result } : f));
        this.render();
      }
    );

    mkItem('<i class="fa-solid fa-trash"></i>',
      game.i18n.localize("asset-vault.favorites.remove"),
      async () => {
        await this.#saveFavorites(favs.filter((_, i) => i !== idx));
        ui.notifications.info(game.i18n.format("asset-vault.favorites.removed", { label: fav.label }));
        this.render();
      }
    );

    document.body.append(menu);
    const dismiss = () => menu.remove();
    document.addEventListener("click", dismiss, { once: true });
    document.addEventListener("keydown", dismiss, { once: true });
  }

  /* -------------------------------------------- */
  /*  Upload                                      */
  /* -------------------------------------------- */

  #wireDropZone(contentEl) {
    let enterCount = 0;

    contentEl.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      if (++enterCount === 1) contentEl.classList.add("av-drop-active");
    });

    contentEl.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    contentEl.addEventListener("dragleave", () => {
      if (--enterCount <= 0) {
        enterCount = 0;
        contentEl.classList.remove("av-drop-active");
      }
    });

    contentEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      enterCount = 0;
      contentEl.classList.remove("av-drop-active");
      let files = Array.from(e.dataTransfer.files).filter(f => f.size > 0);
      if (this.options.mode === "picker") files = files.slice(0, 1);
      if (files.length) await this.#doUploadFiles(files);
    });
  }

  #wireImageViewer(previewArea) {
    const img = previewArea.querySelector(".av-detail-img");
    if (!img) return;

    img.style.visibility = "hidden";

    let scale = 1, tx = 0, ty = 0, fitScale = 1;
    const SCALE_MAX = 10, WHEEL_FACTOR = 0.0015;

    const applyTransform = () => {
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    // Centre when image fits container; clamp to edges when zoomed beyond bounds.
    // Uses naturalWidth/Height directly — always valid after decode() resolves.
    const clamp = () => {
      const cw = previewArea.clientWidth;
      const ch = previewArea.clientHeight;
      const rw = img.naturalWidth  * scale;
      const rh = img.naturalHeight * scale;
      tx = rw <= cw ? (cw - rw) / 2 : Math.min(0, Math.max(cw - rw, tx));
      ty = rh <= ch ? (ch - rh) / 2 : Math.min(0, Math.max(ch - rh, ty));
    };

    // decode() resolves only when the image is fully decoded and naturalWidth is real.
    // Handles cached (complete but not yet decoded), loading, and memory-cached images.
    img.decode()
      .then(() => {
        const cw = previewArea.clientWidth;
        const ch = previewArea.clientHeight;
        if (!previewArea.isConnected || !cw || !ch) { img.style.visibility = "visible"; return; }
        fitScale = Math.min(1, cw / img.naturalWidth, ch / img.naturalHeight);
        scale = fitScale;
        tx = 0; ty = 0;
        clamp();
        applyTransform();
        img.style.visibility = "visible";
      })
      .catch(() => { img.style.visibility = "visible"; }); // broken/unsupported image — show as-is

    previewArea.addEventListener("wheel", ev => {
      ev.preventDefault();
      let delta = ev.deltaY;
      if (ev.deltaMode === 1) delta *= 20;
      if (ev.deltaMode === 2) delta *= 400;
      const newScale = Math.min(SCALE_MAX, Math.max(fitScale, scale * (1 - delta * WHEEL_FACTOR)));
      if (Math.abs(newScale - scale) < 0.0001) return;
      const rect = previewArea.getBoundingClientRect();
      tx = (ev.clientX - rect.left) - (ev.clientX - rect.left - tx) * (newScale / scale);
      ty = (ev.clientY - rect.top)  - (ev.clientY - rect.top  - ty) * (newScale / scale);
      scale = newScale;
      clamp();
      applyTransform();
    }, { passive: false });

    previewArea.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      previewArea.classList.add("av-panning");
      let lastX = ev.clientX, lastY = ev.clientY;
      const onMove = mv => {
        tx += mv.clientX - lastX;
        ty += mv.clientY - lastY;
        lastX = mv.clientX;
        lastY = mv.clientY;
        clamp();
        applyTransform();
      };
      const onUp = () => {
        previewArea.classList.remove("av-panning");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    previewArea.addEventListener("dblclick", () => {
      scale = fitScale; tx = 0; ty = 0; clamp(); applyTransform();
    });

    img.addEventListener("dragstart", ev => ev.preventDefault());
  }

  async #doUploadFiles(files) {
    const source = this.activeSource;
    const path = this.target;

    const results = await Promise.allSettled(
      files.map(file => FilePicker.upload(source, path, file, {}, { notify: false }))
    );

    const successes = results.filter(r => r.status === "fulfilled" && r.value && r.value !== false).length;
    const failures = files.length - successes;

    if (successes > 0) {
      ui.notifications.info(
        game.i18n.format("asset-vault.notifications.uploadSuccess", {
          count: successes,
          path: path || "/"
        })
      );
    }
    if (failures > 0) {
      ui.notifications.error(
        game.i18n.format("asset-vault.notifications.uploadFailed", { count: failures })
      );
    }
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

    const canEditTags = game.user.isGM;
    const userChips = userTags.map(t => `
      <span class="av-tag av-tag--user">
        ${esc(t)}${canEditTags ? `<button type="button" class="av-tag-remove" data-action="removeTag" data-tag="${esc(t)}">×</button>` : ""}
      </span>`).join("");

    const inputRow = canEditTags ? `
      <div class="av-tag-input-row">
        <input type="text" class="av-tag-input" placeholder="${game.i18n.localize("asset-vault.tags.addPlaceholder")}" maxlength="50">
        <button type="button" class="av-tag-add-btn" data-action="addTag">${game.i18n.localize("asset-vault.tags.add")}</button>
      </div>` : "";

    const userSection = `
      <div class="av-tags-section">
        <div class="av-tags-label">${game.i18n.localize("asset-vault.tags.userTagsLabel")}</div>
        <div class="av-tags-list">${userChips}</div>
        ${inputRow}
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
  /*  Context menus                               */
  /* -------------------------------------------- */

  _getFileContextOptions() {
    return [
      {
        name: "asset-vault.context.copyUrl",
        icon: '<i class="fa-solid fa-link"></i>',
        condition: target => target.dataset.isIcon !== "true",
        callback: async target => {
          await navigator.clipboard.writeText(target.dataset.path);
          ui.notifications.info(
            game.i18n.format("asset-vault.notifications.copiedUrl", { path: target.dataset.name })
          );
        }
      },
      {
        name: "asset-vault.context.copyClass",
        icon: '<i class="fa-solid fa-copy"></i>',
        condition: target => target.dataset.isIcon === "true",
        callback: async target => {
          await navigator.clipboard.writeText(target.dataset.path);
          ui.notifications.info(
            game.i18n.format("asset-vault.notifications.copiedClass", { name: target.dataset.name })
          );
        }
      },
      {
        name: "asset-vault.context.copyFilename",
        icon: '<i class="fa-solid fa-file"></i>',
        callback: async target => {
          await navigator.clipboard.writeText(target.dataset.name);
        }
      },
      {
        name: "asset-vault.context.openNewTab",
        icon: '<i class="fa-solid fa-arrow-up-right-from-square"></i>',
        condition: target => target.dataset.isIcon !== "true",
        callback: target => {
          window.open(target.dataset.path, "_blank");
        }
      },
      {
        name: "asset-vault.context.showInFolder",
        icon: '<i class="fa-solid fa-folder-open"></i>',
        condition: target => {
          const inSearch = this.#searchFilters.length > 0 || this.#searchFreeText.length > 0;
          return inSearch && target.dataset.isIcon !== "true";
        },
        callback: target => {
          const path = target.dataset.path;
          // Pre-select the file so the detail panel opens immediately on re-render
          this.selectedFile = this.#fileDataFromElement(target);
          this.#highlightFilePath = path;
          const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
          this.navigate(dir, "data", { keepSelection: true });
        }
      },
      {
        name: "asset-vault.context.addTag",
        icon: '<i class="fa-solid fa-tag"></i>',
        condition: () => this.mode === "hub" && game.user.isGM,
        callback: target => {
          this.#doContextAddTag(target.dataset.path, target.dataset.name);
        }
      },
      {
        name: "asset-vault.context.select",
        icon: '<i class="fa-solid fa-check"></i>',
        condition: () => this.mode === "picker",
        callback: target => {
          this.selectedFile = this.#fileDataFromElement(target);
          this.#doConfirmSelection();
        }
      }
    ];
  }

  _getFolderContextOptions() {
    return [
      {
        name: "asset-vault.context.openFolder",
        icon: '<i class="fa-solid fa-folder-open"></i>',
        callback: target => {
          this.navigate(target.dataset.path);
        }
      },
      {
        name: "asset-vault.context.copyPath",
        icon: '<i class="fa-solid fa-copy"></i>',
        callback: async target => {
          await navigator.clipboard.writeText(target.dataset.path);
        }
      },
      {
        name: "asset-vault.context.addFavorite",
        icon: '<i class="fa-regular fa-star"></i>',
        condition: target => {
          const { path } = target.dataset;
          const source = this.activeSource;
          return !this.#favorites.some(f => f.path === path && f.source === source);
        },
        callback: async target => {
          const { path, name: label } = target.dataset;
          const source = this.activeSource;
          await this.#saveFavorites([...this.#favorites, { path, source, label }]);
          ui.notifications.info(game.i18n.format("asset-vault.favorites.added", { label }));
          this.render();
        }
      },
      {
        name: "asset-vault.context.removeFavorite",
        icon: '<i class="fa-solid fa-star"></i>',
        condition: target => {
          const { path } = target.dataset;
          const source = this.activeSource;
          return this.#favorites.some(f => f.path === path && f.source === source);
        },
        callback: async target => {
          const { path } = target.dataset;
          const source = this.activeSource;
          const fav = this.#favorites.find(f => f.path === path && f.source === source);
          await this.#saveFavorites(this.#favorites.filter(f => !(f.path === path && f.source === source)));
          ui.notifications.info(game.i18n.format("asset-vault.favorites.removed", { label: fav?.label ?? path }));
          this.render();
        }
      }
    ];
  }

  async #doContextAddTag(path, name) {
    const index = game.assetVault?.index;
    if (!index) return;

    const { DialogV2 } = foundry.applications.api;
    const result = await DialogV2.input({
      window: { title: game.i18n.format("asset-vault.context.addTagTitle", { name }) },
      content: `<div class="form-group">
        <label>${game.i18n.localize("asset-vault.tags.addPlaceholder")}</label>
        <input type="text" name="tags" placeholder="${game.i18n.localize("asset-vault.tags.addPlaceholder")}" autofocus maxlength="200">
      </div>`,
      position: { width: 340 }
    });
    if (!result?.tags) return;

    const tags = result.tags.split(",")
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0 && t.length <= 50);
    if (tags.length === 0) return;

    const entry = index.getEntry(path);
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

    await index.updateUserTags(path, [...existing, ...newTags]);

    // Refresh detail panel if this file is currently selected
    if (this.selectedFile?.path === path) this.#renderDetailPanel();
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  navigate(path, source = this.activeSource, { keepSelection = false } = {}) {
    this.#stopActiveMedia();
    if (source !== this.activeSource) {
      this.#sidebarRootDirs = null;
      this.#sidebarSourceKey = null;
    }
    this.activeSource = source;
    this.target = path;
    this.#browseResult = null;
    if (!keepSelection) this.selectedFile = null;
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

  static #onSetViewMode(event, target) {
    this.#viewMode = target.dataset.mode;
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

  static async #onCopyClass() {
    if (!this.selectedFile) return;
    await navigator.clipboard.writeText(this.selectedFile.path);
    ui.notifications.info(
      game.i18n.format("asset-vault.notifications.copiedClass", { name: this.selectedFile.name })
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
    const typeCounts = new Map([["image", 0], ["video", 0], ["audio", 0], ["pdf", 0], ["icon", 0]]);
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
      pdf:   "asset-vault.content.typePdf",
      icon:  "asset-vault.content.typeIcon"
    };
    const types = ["image", "video", "audio", "pdf", "icon"]
      .filter(t => typeCounts.get(t) > 0)
      .map(t => ({
        key:    t,
        label:  game.i18n.localize(TYPE_LABEL_KEYS[t]),
        count:  typeCounts.get(t),
        active: af.some(f => f.key === "type" && f.value === t)
      }));

    const worldItems = [], otherWorldItems = [], moduleItems = [], systemItems = [], assetItems = [], otherItems = [];
    for (const [src, count] of [...sourceMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const item = { key: src, count, active: af.some(f => f.key === "source" && f.value === src) };
      if (src === "world:current") {
        worldItems.push({ ...item, label: game.i18n.localize("asset-vault.scanLocations.currentWorld") });
      } else if (src.startsWith("world:")) {
        otherWorldItems.push({ ...item, label: src.slice("world:".length) });
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
    if (worldItems.length)      sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.currentWorld"), items: worldItems });
    if (otherWorldItems.length) sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.otherWorlds"),  items: otherWorldItems });
    if (moduleItems.length)     sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.modules"),      items: moduleItems });
    if (systemItems.length)     sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.systems"),      items: systemItems });
    if (assetItems.length)      sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.globalAssets"), items: assetItems });
    if (otherItems.length)      sourceGroups.push({ label: game.i18n.localize("asset-vault.scanLocations.otherFolders"), items: otherItems });

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
