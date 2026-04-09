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
  #fileIndexedHook = null;
  #autocomplete = null;
  #activeMedia = null;
  #popoutWindow = null;
  #isDetaching = false;
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
      uploadFile:         AssetVaultHub.#onUploadFile
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
            const isIcon = entry.type === "icon";
            const isImage = entry.type === "image";
            const isVideo = entry.type === "video";
            const isAudio = entry.type === "audio";
            const isPdf = entry.type === "pdf";
            const fileType = game.i18n.localize(isIcon ? "asset-vault.content.typeIcon" : isImage ? "asset-vault.content.typeImage" : isVideo ? "asset-vault.content.typeVideo" : isAudio ? "asset-vault.content.typeAudio" : isPdf ? "asset-vault.content.typePdf" : "asset-vault.content.typeFile");
            return {
              name: entry.name,
              path: entry.path,
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
        userTags: entry?.userTags ?? [],
        unicode: entry?.meta?.unicode ?? null
      };
    }

    const canUpload = !isSearchMode
      && this.activeSource !== "s3"
      && (game.user.isGM || game.settings.get("asset-vault", "enableForPlayers"));

    return {
      mode: this.mode,
      isPicker: this.mode === "picker",
      isDetached: this.#isDetached,
      canUpload,
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

    // Wire upload file input
    const uploadInput = this.element.querySelector(".av-upload-input");
    if (uploadInput) {
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files);
        e.target.value = ""; // reset so the same file can be re-uploaded
        if (files.length) await this.#doUploadFiles(files);
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

    // Wire dragstart directly on each file item (hub mode only).
    // Direct wiring mirrors Foundry's DragDrop pattern and avoids native-image-drag
    // interference that breaks event delegation.
    if (this.mode === "hub") {
      for (const item of this.element.querySelectorAll(".av-item-file")) {
        item.draggable = true;
        item.addEventListener("dragstart", ev => this.#onDragStart(ev));
      }
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
      isIcon: el.dataset.isIcon === "true",
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
      await game.settings.set("asset-vault", "detachedMode", false);
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

    await game.settings.set("asset-vault", "detachedMode", true);

    // When user closes the popup window with the OS X button
    pop.addEventListener("beforeunload", () => {
      if (this.#isDetaching) return;
      this.#popoutWindow = null;
      // Do NOT clear detachedMode here — the user closed the window but still
      // wants detached mode next time they open the Hub.
      this.close();
    });
  }

  async #closeDetachedWindow() {
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

    await game.settings.set("asset-vault", "detachedMode", false);
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
          const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
          this.navigate(dir, "data");
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
