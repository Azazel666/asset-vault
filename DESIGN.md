# Asset Vault — Design Guidelines

**Module ID:** `asset-vault`
**Compatibility:** Foundry VTT v13 (v14 migration will be a breaking upgrade — no dual-version support)
**System Agnostic:** Yes

---

## 1. Vision

Asset Vault is a media asset management hub for Foundry VTT, inspired by Adobe Bridge. It operates in two contexts:

**As a standalone Hub** — Opened from a button on the scene UI controls. A full media browser for organizing, previewing, tagging, and managing assets. Files can be dragged from the Hub into journals, item descriptions, character sheet notes, and other rich text editors. There is no "select" action — it is a workspace, not a dialog.

**As a File Picker replacement** — When Foundry (or a system/module) requests a file picker, Asset Vault opens with the same Hub UI but adds a "Select" action to confirm a file choice and return the path to the calling context. Once a file is selected, the dialog closes.

Both contexts share the same UI, index, search, and browsing capabilities. The only difference is whether a "Select" button and callback are present.

---

## 2. Core Architecture

### 2.1 Operating Modes

Asset Vault has a single core application class (`AssetVaultHub`) that operates in two modes:

**Hub mode** (`mode: "hub"`):
- Opened via a button on the scene UI controls (left sidebar).
- No file type filter — shows all supported file types.
- No "Select" button in the detail panel.
- Files can be dragged out of the Hub into rich text editors (journals, item descriptions, character notes, etc.) and onto the canvas.
- Focus is on browsing, searching, previewing, and tagging.
- Can remain open while doing other work in Foundry (non-modal).

**Picker mode** (`mode: "picker"`):
- Opened automatically when Foundry requests a file picker (via `CONFIG.ux.FilePicker` override).
- File type filter applied based on calling context (`type`, `extensions`).
- "Select" button visible in detail panel and footer.
- Double-click confirms selection.
- Calls `callback(selectedPath)` on confirm, then closes.
- Modal behavior (blocks interaction with the triggering form until a file is selected or the picker is closed).

### 2.2 Class Structure

```
AssetVaultHub (extends ApplicationV2 + HandlebarsApplicationMixin)
  ├── Core browsing, search, preview, tagging UI
  ├── Drag-and-drop source for files
  └── mode: "hub" | "picker"

AssetVaultPicker (extends FilePicker)
  ├── Thin wrapper — creates/opens AssetVaultHub in picker mode
  ├── Passes constructor options (type, callback, field, button, current)
  ├── Satisfies Foundry's subclass validation
  └── Delegates all UI to AssetVaultHub
```

`AssetVaultPicker` is registered on `CONFIG.ux.FilePicker`. It does not render its own UI — it delegates to `AssetVaultHub` with `mode: "picker"` and the calling context options. This keeps the Hub as the single source of truth for UI and behavior.

### 2.3 FilePicker Override

`AssetVaultPicker` is the FilePicker subclass registered globally.

**Override mechanism (v13):**

In v13, `FilePicker` extends `ApplicationV2` via `HandlebarsApplicationMixin` and exposes a static getter `FilePicker.implementation` that returns the configured FilePicker class. The override point is:

```javascript
Hooks.once("init", () => {
  CONFIG.ux.FilePicker = AssetVaultPicker;
});
```

**Validation:** The `implementation` getter checks that the configured class is a proper subclass of `FilePicker`. If not, it logs a warning and resets to the default:
```javascript
if ( !foundry.utils.isSubclass(CONFIG.ux.FilePicker, FilePicker) ) {
  console.warn("Configured FilePicker override must be a subclass of FilePicker.");
  CONFIG.ux.FilePicker = FilePicker;
}
```

This means `AssetVaultPicker` **must** extend `foundry.applications.apps.FilePicker`.

**Calling context contract:**

When Foundry (or a system/module) opens a FilePicker, it passes these options to the constructor:

| Property | Type | Purpose |
|---|---|---|
| `type` | `string` | File type filter: `"image"`, `"audio"`, `"video"`, `"imagevideo"`, `"font"`, `"graphics"`, `"text"`, `"any"` |
| `current` | `string` | The currently selected file path (pre-populate) |
| `callback` | `Function` | Called with the selected file path string when user confirms |
| `field` | `HTMLElement` | The input element to update with the selected path |
| `button` | `HTMLElement` | The button that triggered the picker (has `data-target` and `data-type` attributes) |

**Escape hatch:**
- Provide a module setting to disable the override and revert to the default FilePicker.
- Store a reference to the original FilePicker class at init time for fallback.

### 2.4 Standalone Hub Launch

A button is added to the scene UI controls (left sidebar) via the `getSceneControlButtons` hook:

```javascript
Hooks.on("getSceneControlButtons", (controls) => {
  controls.push({
    name: "asset-vault",
    title: "asset-vault.title",
    icon: "fa-solid fa-vault",
    button: true,
    onClick: () => {
      new AssetVaultHub({ mode: "hub" }).render(true);
    }
  });
});
```

This opens the Hub in standalone mode — no callback, no file type filter, no select action.

### 2.5 Application Shell

**Two display modes** (orthogonal to operating mode):
- **Dialog mode** — Standard Foundry dialog, embedded in the Foundry window. Default.
- **Detached mode** — Pops out into a standalone browser window (for multi-monitor setups). v13's `ApplicationV2` natively supports `detachWindow()` and `attachWindow()`.

The selected display mode is stored per-user via `game.settings.register()` with `scope: "user"`.

### 2.6 Data Layer

**Index database:** A single JSON file stored in the world directory.

- Location: `worlds/<world>/asset-vault/index.json`
- Contains: file paths, auto-generated tags, user tags, last-indexed timestamp, file metadata (dimensions, duration, size, type).
- Rebuilt on world startup (full scan), then maintained incrementally during the session (watch for upload events via hooks).
- Single file is sufficient given default scope is one world + system/modules/assets. If performance degrades at very high file counts, sharding can be revisited.

**No thumbnail caching:** Previews use the original files rendered at reduced size via CSS (`object-fit: cover` in grid, native `<img>` / `<video>` / `<audio>` elements). This eliminates an entire caching layer and works on all hosting platforms (self-hosted, The Forge, Molten, etc.). Type-specific icons are used for non-previewable formats (audio gets a waveform icon, PDF gets a document icon).

**Tag storage:** Part of the index database. Each file entry carries an array of tags (both auto and user-defined).

**Settings storage:** Foundry's native `game.settings.register()` for module configuration (permissions, scan locations, UI preferences).

---

## 3. Indexing & Scanning

### 3.1 Data Root Structure

Foundry's `Data/` root contains several standard directories and potentially additional folders created by modules:

```
Data/
├── assets/          ← Foundry's default global asset folder
├── worlds/          ← One subfolder per world
├── modules/         ← One subfolder per installed module
├── systems/         ← One subfolder per installed system
├── tokenizer/       ← Example: created by the Tokenizer module
├── uploaded-media/  ← Example: user-created asset folder
└── ...              ← Other module-created or user-created folders
```

### 3.2 Scan Location Settings

Each category is configured separately in a settings menu (see §6.3). These settings only control what gets **indexed for search**. Browse mode can always navigate to any location via `FilePicker.browse()` regardless of index settings — a GM is never locked out of any folder.

**Current world** — Always indexed. Cannot be disabled (the toggle is visible but locked on). This is the primary asset scope.

**Systems** (`systems/`):
- Multi-select list showing each installed system by name.
- Default: only the active system for the current world is enabled.
- GM can enable additional systems if they have cross-system assets.

**Modules** (`modules/`):
- Single toggle: **Index active modules** (on/off).
- When **on**: all modules currently activated in the world are indexed for search.
- When **off**: no modules are indexed.
- Default: **on**.
- This only affects indexing/search scope. Browse mode can always navigate into `modules/` and any specific module folder regardless of this setting or whether the module is active.

**Global Assets** (`assets/`):
- Single toggle: **Index global assets folder** (on/off).
- This is Foundry's default shared asset directory, commonly used for assets that span multiple worlds.
- Default: **on**.

**Other worlds** (`worlds/`):
- List shows every world except the current one (which is always on).
- All default to **off**.
- GM can selectively enable worlds to include their assets in the index.

**Other Data root folders:**
- On startup (or settings open), Asset Vault scans the `Data/` root for folders that are **not** `assets/`, `worlds/`, `modules/`, or `systems/`.
- These are listed as additional scan locations (e.g., `tokenizer/`, `uploaded-media/`, etc.).
- Each has an individual on/off toggle.
- Default: **off** — GM opts in to whichever are relevant.
- New folders appearing between sessions are detected and added to the list (defaulting to off).

**Font Awesome (Free):**
- Separate toggle, default **on**.
- Indexes the icon set bundled with Foundry for search via `[type:icon]`.

### 3.3 Supported File Types

| Type | Extensions | Preview |
|---|---|---|
| Image | `.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webm` (animated) | CSS-scaled original + full preview |
| Video | `.mp4`, `.webm`, `.ogg` | Type icon + playback preview on select |
| Audio | `.mp3`, `.ogg`, `.wav`, `.flac`, `.webm` | Type icon + playback controls on select |
| PDF | `.pdf` | Type icon + page preview on select |
| Font Awesome | Icon set | Icon glyph preview with class/unicode info |

### 3.3 Indexing Strategy

- **Full index** runs on world load (background, non-blocking).
- **Incremental updates** via Foundry hooks (`createFile`, upload hooks, etc.) during a session.
- **Stale detection** via last-modified timestamps; re-index changed files only.
- **Progress indicator** shown during initial indexing (especially first run).

### 3.4 Auto-Tagging

Tags are generated automatically from file context:

| Source | Example Tags |
|---|---|
| File path segments | `maps`, `tokens`, `portraits` (from `/assets/tokens/portraits/`) |
| File name (split on delimiters) | `goblin`, `warrior` (from `goblin-warrior.png`) |
| Source location | `module:pf2e`, `system:alienrpg`, `world:current` |
| File type | `image`, `audio`, `video`, `pdf`, `icon` |
| Image dimensions (if applicable) | `square`, `portrait`, `landscape`, `token-size`, `map-size` |

Auto-tags are visually distinct from user tags and can be hidden/filtered but not deleted (they regenerate on re-index).

---

## 4. User Interface

### 4.1 Two UI Modes

The UI operates in two distinct modes:

**Browse Mode (default):**
- Traditional file browser navigation — folder tree, directory listing, click to enter folders, back button.
- Powered by `FilePicker.browse()` calls directly — no index required.
- Works immediately on first install, before any indexing has occurred.
- Filter panel shows folder tree for the current source (data, modules, systems, etc.).
- This is the fallback experience and must always be fully functional.

**Search Mode (activated when user types in search bar):**
- Replaces the folder-based navigation with a flat search results view.
- Powered by uFuzzy against a pre-built haystack array.
- Results ranked by relevance, grouped or sorted as configured.
- Filter panel switches from folder tree to faceted filters (type, tags, source, size).
- Clearing the search bar returns to Browse Mode at the last-navigated directory.

**Index status awareness:**
- If the index has not been built yet (first run, or index was cleared), show a persistent warning banner: *"Index not built — search is unavailable. Browse mode is fully functional. Build index in settings or wait for automatic indexing to complete."*
- If indexing is in progress, show a progress indicator and warning: *"Indexing in progress (X%) — search results may be incomplete."*
- Search bar should be visually disabled or show a tooltip when index is unavailable.
- Browse mode is never affected by index state.

### 4.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [Search Bar]  [View Toggle: Grid/List]  [Detach]  [Settings] │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  Sidebar   │              Content Area                       │
│            │         (Grid or List view)                     │
│            │                                                 │
│ BROWSE:    │  BROWSE: directory listing                      │
│ ┌────────┐ │  SEARCH: flat results ranked by relevance       │
│ │Folder  │ │                                                 │
│ │Tree    │ │                                                 │
│ └────────┘ │                                                 │
│            │                                                 │
│ SEARCH:    ├─────────────────────────────────────────────────┤
│ ┌────────┐ │         Detail / Preview Panel                   │
│ │Type    │ │  (preview, metadata, tags, path, actions)        │
│ │Tags    │ │                                                  │
│ │Source  │ │  Visible when a file is selected.                │
│ │Size    │ │                                                  │
│ └────────┘ │                                                  │
└────────────┴─────────────────────────────────────────────────┘
```

- **Sidebar (left):** Collapsible. Content changes based on active mode:
  - *Browse:* Folder tree / source tabs (data, modules, system). Breadcrumb path above content area.
  - *Search:* Faceted filters — file type checkboxes, tag cloud/list, source toggles, size range. Active filters shown as dismissible chips above results.
- **Content area (center):** Grid or list view. In Browse mode shows current directory contents (folders + files). In Search mode shows flat ranked results.
- **Detail panel (bottom or right):** Shows selected file's preview, metadata, tags (add/remove), full path, copy-URL button. In **picker mode**, also shows "Select" button. Hidden until a file is selected.

### 4.3 Hub vs. Picker UI Differences

| Element | Hub Mode | Picker Mode |
|---|---|---|
| "Select" button | Hidden | Visible in detail panel + footer |
| Double-click file | Opens full preview | Confirms selection and closes |
| File type filter | None (all types shown) | Applied from calling context |
| Drag-and-drop out | Enabled — drag files to journals, editors, canvas | Disabled (selection is the primary action) |
| Close behavior | Just closes | Returns no selection to the calling context |
| Window modality | Non-modal (stays open while working) | Modal (blocks triggering form) |
| Scene UI button | This is how it opens | N/A (opened by Foundry automatically) |

### 4.3 View Modes

- **Grid:** Thumbnail-forward, card-based layout. Hover shows filename tooltip.
- **List:** Table rows with small thumbnail, filename, type, dimensions/duration, tags, path.
- Preference stored per-user via `scope: "user"` setting.

### 4.5 Interaction

- **Single click:** Select file, populate detail panel.
- **Double click:**
  - *Picker mode:* Confirm selection (calls callback, closes dialog).
  - *Hub mode:* Open expanded preview / no special action.
- **Right click:** Context menu (copy URL, add/remove tags, open in new tab, show in folder).
- **Drag (Hub mode):** Drag file items out of the Hub into:
  - Rich text editors (journals, item descriptions, character sheet notes) — inserts as an image/link.
  - Canvas — drops as a tile (images) or ambient sound (audio).
  - Drag data format: Foundry-compatible `{ type: "File", src: "path/to/file.webp" }` or appropriate format for the drop target.

---

## 5. Search

Search activates when the user types in the search bar, switching the UI from Browse Mode to Search Mode (see §4.1). Clearing the search bar returns to Browse Mode.

**Index dependency:** All search features below require the index to be built. If the index is unavailable or incomplete, the search bar is disabled/greyed with an explanatory tooltip. Browse mode remains fully functional regardless.

### 5.1 Basic Search

Fuzzy matching against filename and tags. Powered by uFuzzy (`@leeoniya/ufuzzy`) — a tiny (~6KB), high-performance fuzzy search library that handles 100K+ entries without pre-built indexes.

Each indexed file gets a flat searchable string combining filename, path segments, and tags (e.g., `"goblin-warrior.png tokens portraits module:pf2e image npc"`). uFuzzy searches this haystack array directly. The advanced query operators (`[type:image]`, `[tag:npc]`) are parsed and pre-filtered before the fuzzy match runs, so uFuzzy only handles the free-text portion.

### 5.2 Advanced Search Syntax

Structured queries using bracket notation for tag-based filtering, combined with free-text for fuzzy matching.

**Draft syntax:**

```
[type:image] [tag:npc] dragon
```

| Operator | Meaning | Example |
|---|---|---|
| `[type:<filetype>]` | Filter by file type | `[type:audio]` |
| `[tag:<value>]` | Filter by tag (user or auto) | `[tag:boss]` |
| `[source:<location>]` | Filter by origin | `[source:module:pf2e]` |
| `[size:>1mb]` | Filter by file size | `[size:<500kb]` |
| `[dim:>1920]` | Filter by dimension (longest edge) | `[dim:>4096]` |
| Free text | Fuzzy match on name + tags | `goblin cave` |

Operators are combinable: `[type:image] [tag:map] underwater temple`

### 5.3 Font Awesome Search

Separate search mode or integrated with a `[type:icon]` filter. Searches icon names and aliases from the Font Awesome metadata. Returns the icon class string (e.g., `fa-solid fa-dragon`) as the "file path" equivalent.

---

## 6. Permissions & Access Control

### 6.1 Defaults

- **GM:** Full access to all features (browse, search, tag, configure).
- **Players:** No access by default.

### 6.2 Player Access

When Foundry's own permission system allows a player to modify a document field (e.g., change a character portrait), Asset Vault respects that and opens for the player in a restricted mode.

**Restricted mode for players:**
- Browse and search only within GM-configured allowed locations.
- Cannot add/edit tags.
- Cannot access settings.
- Can only select files (no batch operations).

### 6.3 Settings (GM-Configurable)

Registered via `game.settings.register()` under the module's namespace. Complex settings (scan locations) use `game.settings.registerMenu()` to open a dedicated configuration UI.

**General settings** (shown in module settings panel):

| Setting | Type | Default | Scope |
|---|---|---|---|
| Enable for players | Boolean | `false` | World |
| Player-visible locations | Multi-select | `[]` | World |
| Default view mode | Choice (grid/list) | `grid` | User |
| Detached mode | Boolean | `false` | User |
| Show auto-tags | Boolean | `true` | User |
| Use default FilePicker | Boolean | `false` | User |

> **Note:** `scope: "user"` (v13+) stores per-user and syncs across devices, unlike `scope: "client"` which is device-local. This means a GM's view preference follows them across machines.

**Scan Location settings** (via `registerMenu` → dedicated ApplicationV2 dialog):

This opens a dedicated configuration panel with sections for each category (see §3.2 for details):

```
┌─ Scan Locations ─────────────────────────────────────────────┐
│                                                              │
│  CURRENT WORLD                                               │
│  ☑ My Campaign (always on, locked)                           │
│                                                              │
│  SYSTEMS                                                     │
│  ☑ Pathfinder 2e  (active)                                   │
│  ☐ Alien RPG                                                 │
│                                                              │
│  MODULES                                                     │
│  ☑ Index active modules                                      │
│                                                              │
│  GLOBAL ASSETS                                               │
│  ☑ Index global assets folder (assets/)                      │
│                                                              │
│  OTHER WORLDS                                                │
│  ☐ Alien Campaign                                            │
│  ☐ Test World                                                │
│                                                              │
│  OTHER DATA FOLDERS                                          │
│  ☐ tokenizer/                                                │
│  ☐ uploaded-media/                                           │
│                                                              │
│  FONT AWESOME                                                │
│  ☑ Index Font Awesome icons                                  │
│                                                              │
│                              [Rebuild Index]  [Save] [Close] │
└──────────────────────────────────────────────────────────────┘
```

The configuration is stored as a single world-scoped setting (JSON object) containing the enabled/disabled state for each location. Changing scan locations triggers an index rebuild prompt.

---

## 7. Technical Considerations

### 7.1 Performance

- **Virtualized rendering** for results (only render visible items). Consider a virtual scroll library or manual implementation.
- **CSS-scaled previews:** Use original files in `<img>` tags with `object-fit: cover` and fixed dimensions. Browser handles scaling; no thumbnail generation needed. Use `loading="lazy"` for off-screen images.
- **Debounced search:** Input triggers search after a short debounce (150-200ms).
- **Lazy preview loading:** Detail panel loads full preview only when a file is selected.
- **Web Workers:** Consider offloading index building and fuzzy search to a Web Worker to avoid blocking the UI thread.
- **uFuzzy** for fuzzy search (tiny, no pre-built index needed, handles 100K+ entries, excellent result ordering).

### 7.2 Foundry API Integration

- Hook into upload events to update index incrementally.
- Use `FilePicker.browse()` internally to list directories (respects Foundry's storage adapters).
- Return values must match what the calling Foundry UI expects (file path string).

### 7.3 Font Awesome Integration

- Parse Font Awesome's metadata JSON (bundled with Foundry or shipped with module) to build a searchable icon index.
- Return format for icons: the CSS class string, not a file path. The calling context must support this (works for icon fields, may not work for image fields — handle gracefully).

### 7.4 Extensibility (Future)

- **Custom search providers:** API for other modules to register additional search locations or asset sources.
- **S3 / external storage:** If Foundry's storage adapter is S3, Asset Vault should still work via `FilePicker.browse()` abstraction.
- **Tagging API:** Allow other modules to read/write tags programmatically.

---

## 8. Development Phases

### Phase 1 — MVP

**Core (hub + picker shared):**
- [ ] `AssetVaultHub` — core ApplicationV2 class with hub/picker mode flag
- [ ] `AssetVaultPicker` — thin FilePicker subclass, delegates to AssetVaultHub in picker mode
- [ ] FilePicker override registered globally via `CONFIG.ux.FilePicker`
- [ ] Scene UI button to launch Hub in standalone mode (via `getSceneControlButtons` hook)
- [ ] ApplicationV2 UI with grid/list toggle
- [ ] Per-user view preference persistence (`scope: "user"`)
- [ ] Escape hatch setting to revert to default FilePicker

**Browse mode (works without index):**
- [ ] Browse mode: folder tree navigation via `FilePicker.browse()`
- [ ] Breadcrumb path navigation
- [ ] Image preview in detail panel (CSS-scaled originals)
- [ ] Copy URL action

**Picker mode specifics:**
- [ ] "Select" button visible only in picker mode
- [ ] Single-file selection flow (respects calling context `type`, `callback`, `extensions`)
- [ ] Double-click to confirm selection (picker mode only)

**Search mode (requires index):**
- [ ] Background directory scanning and JSON index build on world startup
- [ ] Index status banner (not built / in progress with % / complete)
- [ ] Search bar disabled when index unavailable, with tooltip explanation
- [ ] Basic uFuzzy fuzzy search (filename + auto-tags)
- [ ] Auto-tagging from path/filename/type
- [ ] Mode switch: typing in search bar → search results view, clearing → back to browse

### Phase 2 — Full Feature Set

- [ ] User-defined tags (add/remove/edit)
- [ ] Advanced search syntax with operators
- [ ] Filter panel with tag/type/source facets
- [ ] Audio/video preview with playback controls
- [ ] PDF first-page preview
- [ ] Font Awesome icon search
- [ ] Detached/pop-out window mode (via `detachWindow()` / `attachWindow()`)
- [ ] Right-click context menu
- [ ] Incremental index updates via hooks
- [ ] Drag-and-drop from Hub to journals, rich text editors, and canvas

### Phase 3 — Polish & Extensibility

- [ ] Player access with restricted mode
- [ ] GM permission settings for player visibility
- [ ] Cross-world scanning (opt-in)
- [ ] Performance: Web Worker for search, virtual scrolling
- [ ] Extensibility API (custom providers, tag API)
- [ ] Custom scan locations (future-proofed)
- [ ] Localization support

---

## 9. Resolved Decisions

| Decision | Resolution |
|---|---|
| Index format | Single `index.json` — sufficient for single-world + system/modules scope |
| Thumbnail generation | None — CSS-scaled originals, type icons for non-previewable formats |
| Search library | uFuzzy (`@leeoniya/ufuzzy`) — ~6KB, no pre-built index, benchmarked at 162K entries. Flat haystack array approach with manual search→info→sort pipeline. |
| Multi-select | Not part of native FilePicker contract (always single callback). Future Asset Vault extension only. |
| Version target | Build for v13 only. When migrating to v14, drop v13 support — no dual-version maintenance. |
| Tag/index scope | Per-world. Each world builds its own index and treats it as source of truth. No cross-world index merging. |
| Non-world asset index location | Per-world. Even though system/module assets are shared, each world may index different modules, so a global index would be incomplete or misleading. Each world's `index.json` includes its own view of system/module assets. |

| FilePicker override | `CONFIG.ux.FilePicker` — must be a subclass of `FilePicker`, validated by the `implementation` getter at runtime. |

| Font Awesome metadata | Not bundled by Foundry. Ship a trimmed version of `@fortawesome/fontawesome-free`'s `metadata/icons.json` with the module (~200KB full, trim to name/aliases/search terms/style for search index). |

## 10. Open Questions

*No open questions remaining. All architectural decisions are resolved.*

---

*Document version: 1.1 — Hub/Picker dual-mode architecture, scene UI launch button, drag-and-drop design*
*Last updated: 2026-04-08*