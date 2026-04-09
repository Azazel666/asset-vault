# Asset Vault — Implementation Plan

> **For use with Claude Code.** Each iteration is a self-contained unit of work.
> Complete all verification checks before moving to the next iteration.
> Reference `DESIGN.md` (the design guidelines document) for architectural decisions.

---

## Prerequisites

- Foundry VTT v13 development environment running
- Module development folder accessible at `Data/modules/asset-vault/`
- Browser dev console available for verification
- `@leeoniya/ufuzzy` npm package (bundled, not runtime dependency)

---

## Iteration 0 — Project Scaffolding

**Goal:** Empty module that Foundry recognizes and loads.

### Tasks

1. Create folder structure:
   ```
   asset-vault/
   ├── module.json
   ├── scripts/
   │   └── module.js          # Entry point
   ├── styles/
   │   └── asset-vault.css     # Main stylesheet
   ├── templates/               # Handlebars templates (empty for now)
   ├── languages/
   │   └── en.json             # i18n strings
   └── README.md
   ```

2. Create `module.json`:
   - `id`: `"asset-vault"`
   - `title`: `"Asset Vault"`
   - `compatibility.minimum`: `"13"`
   - `compatibility.verified`: `"13"`
   - `esmodules`: `["scripts/module.js"]`
   - `styles`: `["styles/asset-vault.css"]`
   - `languages`: english with `"asset-vault"` namespace

3. Create `scripts/module.js`:
   - Single `Hooks.once("init", ...)` that logs `"Asset Vault | Initializing"`
   - Single `Hooks.once("ready", ...)` that logs `"Asset Vault | Ready"`

4. Create empty `styles/asset-vault.css` with a header comment.

5. Create `languages/en.json` with basic entries:
   ```json
   {
     "asset-vault.title": "Asset Vault",
     "asset-vault.settings.useDefaultPicker.name": "Use Default File Picker",
     "asset-vault.settings.useDefaultPicker.hint": "Disable Asset Vault and use Foundry's built-in file picker instead."
   }
   ```

### Verification

- [X] Module appears in Foundry's module management list
- [X] Module can be enabled in a world without errors
- [X] Console shows both init and ready log messages
- [X] No errors in console on world load

---

## Iteration 1 — Hub + Picker Classes (Pass-Through)

**Goal:** Create the two-class structure. `AssetVaultPicker` (FilePicker subclass) passes through to Foundry's default behavior for now. `AssetVaultHub` is a standalone ApplicationV2 that opens from a scene UI button. Both are shells at this stage.

### Tasks

1. Create `scripts/hub/AssetVaultHub.js`:
   ```javascript
   const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

   export class AssetVaultHub extends HandlebarsApplicationMixin(ApplicationV2) {
     // mode: "hub" (standalone) or "picker" (file selection)
     constructor(options = {}) {
       super(options);
       this.mode = options.mode || "hub";
       this.pickerOptions = options.pickerOptions || {}; // type, callback, field, button, current
     }

     static DEFAULT_OPTIONS = {
       id: "asset-vault-hub",
       window: {
         title: "Asset Vault",
         icon: "fa-solid fa-vault",
         resizable: true
       },
       position: { width: 900, height: 600 }
     };

     static PARTS = {
       body: { template: "modules/asset-vault/templates/hub.hbs" }
     };

     async _prepareContext(options) {
       return {
         mode: this.mode,
         isPicker: this.mode === "picker"
       };
     }
   }
   ```

2. Create a minimal `templates/hub.hbs`:
   ```handlebars
   <div class="asset-vault" data-mode="{{mode}}">
     <p>Asset Vault — Mode: {{mode}}</p>
     {{#if isPicker}}<button type="button">Select (picker mode)</button>{{/if}}
   </div>
   ```

3. Create `scripts/picker/AssetVaultPicker.js`:
   ```javascript
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
   ```
   - For now, `AssetVaultPicker` inherits all default FilePicker behavior (pass-through).
   - It will delegate to `AssetVaultHub` in a later iteration once the Hub UI is built.

4. Update `scripts/module.js`:
   - Import both classes
   - In `init` hook:
     - Store reference: `game.assetVault = { originalPicker: CONFIG.ux.FilePicker }`
     - Override: `CONFIG.ux.FilePicker = AssetVaultPicker;`
   - Override the existing Tile Controls "Browse" button via `getSceneControlButtons` hook instead of adding a new scene control group. This avoids UI interference and hooks into a natural entry point for a media browser. Re-title and re-icon it to Asset Vault, replace `onChange` to open the Hub, and delete `toolclip` to suppress the help animation (which would demo the wrong thing). Skip the override when `useDefaultPicker` is enabled so the original behaviour is fully restored.
     ```javascript
     Hooks.on("getSceneControlButtons", (controls) => {
       if (game.settings.get("asset-vault", "useDefaultPicker")) return;
       const browse = controls?.tiles?.tools?.browse;
       if (!browse) return;
       browse.title = "asset-vault.title";
       browse.icon = "fa-solid fa-vault";
       browse.onChange = () => new AssetVaultHub({ mode: "hub" }).render(true);
       delete browse.toolclip;
     });
     ```

### Verification

- [X] No console warnings about FilePicker override
- [X] `foundry.applications.apps.FilePicker.implementation === game.assetVault.AssetVaultPicker` returns `true` in console
- [X] Clicking a file picker button (e.g., on a scene background image) opens the picker
- [X] The picker still functions normally (pass-through) — can browse, select, upload
- [X] The selected file is correctly applied (e.g., scene background updates)
- [X] Tile Controls "Browse" button shows vault icon and "Asset Vault" title
- [X] Clicking it opens the Hub window showing "Mode: hub" (no help animation)
- [X] Hub window does NOT show a "Select" button
- [X] `game.assetVault.originalPicker` holds the original FilePicker class
- [X] Enabling `useDefaultPicker` and reloading restores the original Tile Browser button and toolclip

---

## Iteration 2 — Settings Registration

**Goal:** Register all module settings so preferences persist. Include the escape hatch to revert to the default picker.

### Tasks

1. Create `scripts/settings.js`:
   - Export a `registerSettings()` function
   - Register settings:

   | Key | Type | Default | Scope | Config |
   |---|---|---|---|---|
   | `useDefaultPicker` | Boolean | `false` | `user` | `true` |
   | `viewMode` | String (choice: `grid`/`list`) | `grid` | `user` | `true` |
   | `detachedMode` | Boolean | `false` | `user` | `true` |
   | `showAutoTags` | Boolean | `true` | `user` | `true` |
   | `enableForPlayers` | Boolean | `false` | `world` | `true` |
   | `scanLocations` | Object | `{}` | `world` | `false` |

   - Register a settings menu for scan locations (placeholder — UI built in Iteration 13):
     ```javascript
     game.settings.registerMenu("asset-vault", "scanLocationsMenu", {
       name: "asset-vault.settings.scanLocations.name",
       label: "asset-vault.settings.scanLocations.label",
       icon: "fa-solid fa-folder-tree",
       type: ScanLocationsConfig, // placeholder class
       restricted: true
     });
     ```

2. Update `scripts/module.js`:
   - Call `registerSettings()` in `init` hook
   - Wrap the FilePicker override in a check:
     ```javascript
     if (!game.settings.get("asset-vault", "useDefaultPicker")) {
       CONFIG.ux.FilePicker = AssetVaultPicker;
     }
     ```
   - **Note:** Settings with `scope: "user"` are not available during `init` (user not yet loaded). The escape hatch check may need to move to `setup` or `ready` hook. Test and adjust. If `init` doesn't work, use `setup` hook and verify override still takes effect.

3. Add all i18n strings to `languages/en.json`.

4. Create a placeholder `scripts/settings/ScanLocationsConfig.js` (empty ApplicationV2 subclass that just renders a "Coming soon" message).

### Verification

- [X] All settings appear in module settings panel
- [X] `viewMode` shows a dropdown with Grid/List options
- [X] `useDefaultPicker` toggle works:
  - When **off**: Asset Vault picker opens (reload required)
  - When **on**: Default Foundry picker opens (reload required)
- [X] Settings values persist after page reload
- [X] "Scan Locations" button appears in settings and opens the placeholder dialog
- [X] No errors in console

---

## Iteration 3 — Hub UI: Layout Shell

**Goal:** Build the Asset Vault Hub layout. Both the scene UI button and the file picker open this same UI (with mode-dependent differences). The layout renders correctly but has no functional content yet.

### Tasks

1. Create Handlebars templates in `templates/`:
   - `hub.hbs` — main layout (search bar, toolbar, sidebar, content area, detail panel)
   - `parts/toolbar.hbs` — search input, view toggle, settings button
   - `parts/sidebar.hbs` — placeholder for folder tree / filter panel
   - `parts/content.hbs` — placeholder for file grid/list
   - `parts/detail-panel.hbs` — placeholder for file preview/metadata

2. Template structure for `hub.hbs`:
   ```handlebars
   <div class="asset-vault" data-mode="{{mode}}">
     <div class="av-toolbar">
       {{> "modules/asset-vault/templates/parts/toolbar.hbs"}}
     </div>
     <div class="av-body">
       <aside class="av-sidebar">
         {{> "modules/asset-vault/templates/parts/sidebar.hbs"}}
       </aside>
       <div class="av-main">
         <div class="av-content">
           {{> "modules/asset-vault/templates/parts/content.hbs"}}
         </div>
         <div class="av-detail" hidden>
           {{> "modules/asset-vault/templates/parts/detail-panel.hbs"}}
         </div>
       </div>
     </div>
     {{#if isPicker}}
     <footer class="av-footer">
       <button type="button" data-action="confirmSelection" class="av-select-btn">
         <i class="fa-solid fa-check"></i> {{localize "asset-vault.actions.select"}}
       </button>
     </footer>
     {{/if}}
   </div>
   ```

3. Update `AssetVaultHub`:
   - Set `static PARTS` to reference the new templates
   - Update `_prepareContext` to pass mode, isPicker, etc.
   - Override `_onRender` for any post-render setup

4. Update `AssetVaultPicker` to delegate to Hub:
   - Override `render()` to create and render an `AssetVaultHub` instance in picker mode instead of rendering itself:
     ```javascript
     async render(force, options) {
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
       hub.render(true);
       return this;
     }
     ```
   - The picker itself never renders — it's a bridge class.

5. Create base CSS in `styles/asset-vault.css`:
   - Use CSS Grid for the main layout
   - Sidebar: 250px fixed width, collapsible
   - Content: flex-grow
   - Detail panel: 200px bottom section, hidden by default
   - Footer with "Select" button: only present in picker mode
   - Use Foundry's CSS variables where possible for theme consistency
   - Minimum dialog size: 800x500px

### Verification

- [X] Scene UI button opens the Hub with the custom layout (not "Mode: hub" placeholder)
- [X] Clicking a file picker button in Foundry opens the same layout in picker mode
- [X] Picker mode shows the "Select" footer button
- [X] Hub mode does NOT show the "Select" footer button
- [X] Search bar visible in toolbar
- [X] Sidebar area visible on the left
- [X] Content area takes up remaining space
- [X] Detail panel is hidden (no file selected)
- [X] Layout is responsive — resizing the dialog reflows correctly
- [X] No template rendering errors in console
- [X] Close button works on both hub and picker

---

## Iteration 4 — Browse Mode: Directory Navigation

**Goal:** Content area shows folders and files for the current directory. Clicking folders navigates into them. Breadcrumb shows current path.

### Tasks

1. Implement directory browsing in `AssetVaultHub`:
   - On render, call `FilePicker.browse("data", target)` to get directory contents
   - Parse response: `dirs` (subdirectories) and `files` (file paths)
   - Filter files by `this.type` / `this.extensions` (from calling context)
   - Pass results to template context

2. Update `parts/content.hbs`:
   - Render folders as clickable items (folder icon + name)
   - Render files as items (type-appropriate icon or image thumbnail + filename)
   - Empty state message when no files match

3. Add breadcrumb to toolbar area:
   - Parse current path into clickable segments
   - Clicking a segment navigates to that directory level
   - Root shows source name (e.g., "User Data")

4. Implement navigation actions:
   - `pickDirectory` action: click folder → call `browse()` with new target → re-render content
   - `backTraverse` action: go up one directory level
   - Breadcrumb segment click: navigate to that path

5. Support Foundry's source tabs (data, public, s3 if configured):
   - Show source tabs in sidebar or toolbar
   - Switching source calls `browse()` on the new source

### Verification

- [X] Opening the picker shows the root directory contents (folders + files)
- [X] Clicking a folder navigates into it and shows its contents
- [X] Breadcrumb updates to show the current path
- [X] Clicking a breadcrumb segment navigates to that level
- [X] Back button / back navigation goes up one level
- [X] Files are filtered by the calling context type (e.g., only images when opened for an image field)
- [X] Source tabs work — can switch between User Data and other sources
- [X] Empty directories show an appropriate message
- [X] No errors when navigating deeply nested paths

---

## Iteration 5 — Browse Mode: Grid/List Views

**Goal:** Files display in either grid (thumbnail cards) or list (table rows) view, togglable and persisted.

### Tasks

1. Implement **grid view** in content area:
   - Cards with CSS-scaled `<img>` for images (`object-fit: cover`, fixed dimensions ~120x120px)
   - `loading="lazy"` on all images
   - Folder cards with folder icon
   - Non-image files show type-specific Font Awesome icons:
     - Audio: `fa-solid fa-file-audio`
     - Video: `fa-solid fa-file-video`
     - PDF: `fa-solid fa-file-pdf`
     - Other: `fa-solid fa-file`
   - Filename below/over thumbnail (truncated with tooltip)

2. Implement **list view** in content area:
   - Table rows: small thumbnail (40x40), filename, file type, file size (if available from browse result)
   - Folders listed first, then files
   - Same icon logic for non-image types

3. Implement view toggle:
   - Toolbar buttons for grid/list (icon buttons, active state)
   - Read `viewMode` setting on render
   - Toggle updates setting and re-renders content area only
   - Setting stored via `game.settings.set("asset-vault", "viewMode", mode)`

4. CSS for both views:
   - Grid: CSS Grid with `auto-fill`, `minmax(120px, 1fr)`
   - List: standard table layout
   - Hover state for items
   - Selected state for items (highlight)

### Verification

- [X] Grid view shows image thumbnails at correct size
- [X] Grid view shows type icons for non-image files
- [X] List view shows tabular data with small thumbnails
- [X] View toggle switches between grid and list
- [X] View preference persists after closing and reopening the picker
- [X] `loading="lazy"` is present on image elements (check in Elements inspector)
- [X] Folders appear before files in both views
- [X] Long filenames are truncated with tooltips

---

## Iteration 6 — Browse Mode: File Selection & Detail Panel

**Goal:** Clicking a file shows its preview and metadata in the detail panel. Double-clicking or clicking "Select" confirms the selection and calls the callback.

### Tasks

1. Implement file selection:
   - Single click on a file item:
     - Add `selected` class to the item
     - Remove `selected` from any previously selected item
     - Populate and show the detail panel
   - Track selected file path in component state

2. Implement detail panel (`parts/detail-panel.hbs`):
   - **Preview area:** 
     - Images: full-size `<img>` with `object-fit: contain`
     - Video: `<video>` element with controls (no autoplay)
     - Audio: `<audio>` element with controls
     - PDF: type icon (full preview is Phase 2)
     - Other: type icon
   - **Metadata:**
     - Filename
     - Full path
     - File type
     - Dimensions (for images, if obtainable)
   - **Actions:**
     - "Copy URL" button — copies the file path to clipboard (both modes)
     - "Select" button — confirms selection (picker mode only, also in footer)
   - Panel slides up / becomes visible when a file is selected

3. Implement file confirmation (picker mode only):
   - Double-click on file item → confirm selection
   - "Select" button click (detail panel or footer) → confirm selection
   - Confirmation logic:
     ```javascript
     if (this.mode === "picker") {
       const { callback, field } = this.pickerOptions;
       if (callback) callback(selectedPath);
       if (field) field.value = selectedPath;
       this.close();
     }
     ```
   - In hub mode, double-click does nothing special (or opens expanded preview)

4. Implement "Copy URL" action:
   - `navigator.clipboard.writeText(path)`
   - Show brief notification (Foundry's `ui.notifications.info`)

### Verification

- [X] Clicking a file highlights it and shows the detail panel
- [X] Detail panel shows correct preview for images (rendered, not just icon)
- [X] Detail panel shows type icon for non-image files
- [X] Filename and full path are displayed correctly
- [X] "Copy URL" copies the file path (paste to verify) — works in both modes
- [X] **Picker mode:** Double-clicking a file closes the picker and applies the selection
- [X] **Picker mode:** "Select" button closes the picker and applies the selection
- [X] **Picker mode:** The field that triggered the picker is updated with the correct file path
- [X] **Picker mode:** The callback function is called with the correct path
- [X] **Hub mode:** Double-click does NOT close the hub or trigger a callback
- [X] **Hub mode:** No "Select" button visible
- [X] Test picker with: scene background image, actor portrait, tile image, audio playlist track

---

## Iteration 7 — Browse Mode: Sidebar

**Goal:** Sidebar shows source navigation tabs and a folder tree for quick navigation.

### Tasks

1. Implement source tabs in sidebar:
   - List available sources from `this.sources` (data, public, s3 if configured)
   - Active source highlighted
   - Clicking a source switches the browse target

2. Implement folder tree (simplified — not full recursive tree):
   - Show top-level folders for the current source
   - Clicking a folder in the sidebar navigates to it in the content area
   - Highlight the folder matching the current browsed path
   - Consider: lazy-load subfolder expansion on click (expand arrow)

3. Add a "Favorites" section (placeholder for future):
   - Empty section with header, no functionality yet
   - This prepares the sidebar structure for later features

4. Sidebar collapse toggle:
   - Button to collapse/expand sidebar
   - When collapsed, sidebar is hidden and content area takes full width
   - Collapse state persisted in memory (not setting — resets on reload is fine)

### Verification

- [X] Sidebar shows source tabs for available storage backends
- [X] Clicking a source tab changes the content area
- [X] Top-level folder tree shows root directories
- [X] Clicking a folder in the tree navigates to it in content area
- [X] Current folder is highlighted in the tree
- [X] Sidebar collapse button hides the sidebar
- [X] Sidebar expand button restores it
- [X] Layout adjusts when sidebar is toggled

---

## Iteration 8 — Index: Data Model & Storage

**Goal:** Define the index entry schema and implement read/write to the world directory.

### Tasks

1. Create `scripts/index/IndexEntry.js`:
   - Define the schema for a single indexed file:
     ```javascript
     /**
      * @typedef {Object} IndexEntry
      * @property {string} path - Full file path relative to Data/
      * @property {string} name - Filename without path
      * @property {string} type - File type category: image|video|audio|pdf|other
      * @property {string} source - Source identifier: world:current, module:<id>, system:<id>, assets, folder:<name>
      * @property {string[]} autoTags - Auto-generated tags
      * @property {string[]} userTags - User-defined tags
      * @property {number} indexedAt - Timestamp of when this entry was indexed
      * @property {Object} [meta] - Optional metadata (dimensions, size, duration)
      */
     ```

2. Create `scripts/index/IndexStore.js`:
   - Class that manages reading/writing the index file
   - Methods:
     - `async load()` — Read `asset-vault/index.json` from the world folder. Return empty index if not found.
     - `async save(entries)` — Write the index JSON to the world folder.
     - `getHaystack()` — Build flat string array for uFuzzy from current entries.
     - `getEntries()` — Return all entries.
     - `getEntry(path)` — Lookup single entry by path.
     - `addEntries(entries)` — Merge new entries into index.
     - `removeEntries(paths)` — Remove entries by path.
   - Storage path: Use `FilePicker.browse("data", "worlds/<worldId>/asset-vault")` to check if folder exists, `FilePicker.createDirectory()` if not.
   - Use Foundry's fetch API or `foundry.utils.fetchJsonWithTimeout` to read JSON.
   - Use `FilePicker.upload()` to write JSON back (upload a Blob as a file).

3. Create `scripts/index/IndexManager.js`:
   - Singleton (attached to `game.assetVault.index`)
   - Properties:
     - `status`: `"none"` | `"building"` | `"ready"` | `"error"`
     - `progress`: `0-100` (percentage during build)
     - `entries`: Map of path → IndexEntry
     - `haystack`: string[] for uFuzzy
   - Methods:
     - `async initialize()` — Load existing index from disk
     - `async rebuild()` — Full rescan (Iteration 9)
     - `async update(paths)` — Incremental update (Phase 2)

### Verification

- [X] No console errors on world load (no 404 noise — directory checked via FilePicker.browse before fetch)
- [X] `game.assetVault.index` exists in console after world load
- [X] `game.assetVault.index.status === "none"` when no index file exists yet
- [X] Run in console: `game.assetVault.index.addEntries([{path:"test/foo.png",name:"foo.png",type:"image",source:"world:current",autoTags:[],userTags:[],indexedAt:Date.now()}]); await game.assetVault.index.save()` — no errors
- [X] File `worlds/<worldId>/asset-vault/index.json` visible in Foundry file browser
- [X] Reload world — `game.assetVault.index.status === "ready"` and `game.assetVault.index.size === 1`
- [X] `game.assetVault.index.getEntry("test/foo.png")` returns the entry
- [X] `game.assetVault.index.getHaystack()` returns `["foo.png"]`

---

## Iteration 9 — Index: Directory Scanner

**Goal:** Recursively scan configured locations and populate the index with file entries.

### Tasks

1. Create `scripts/index/Scanner.js`:
   - `async scan(locations)` — Takes array of `{source, path}` objects to scan
   - For each location, recursively call `FilePicker.browse()`:
     - Collect all files matching supported extensions
     - Track progress: count directories scanned vs. estimated total
     - Yield/emit progress updates for UI consumption
   - Return flat array of discovered file paths with metadata

2. Implement scan location resolution in `IndexManager`:
   - Read `scanLocations` setting
   - Build location list based on settings:
     - Always: current world path (`worlds/<worldId>`)
     - If modules enabled: iterate `game.modules` where `active === true`, build paths like `modules/<moduleId>`
     - If system enabled: `systems/<systemId>` for each enabled system
     - If global assets enabled: `assets/`
     - If other worlds enabled: `worlds/<worldId>` for each
     - If other folders enabled: each folder path
   - Default scan locations when setting is empty (first run):
     - Current world: on
     - Active system: on
     - Active modules: on
     - Global assets: on
     - Everything else: off

3. Integrate scanner with `IndexManager.rebuild()`:
   - Set `status = "building"`, `progress = 0`
   - Run scanner across all enabled locations
   - Generate auto-tags for each entry (calls to auto-tagger, built in Iteration 10)
   - Save completed index via `IndexStore`
   - Set `status = "ready"`, `progress = 100`

4. Trigger rebuild on world ready:
   - In `ready` hook: if no index exists, start `rebuild()`
   - If index exists, load it and set status to ready
   - Rebuild runs asynchronously — does not block world loading

5. Add extension filtering:
   - Define supported extensions constant:
     ```javascript
     const SUPPORTED_EXTENSIONS = {
       image: [".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"],
       video: [".mp4", ".webm", ".ogg"],
       audio: [".mp3", ".ogg", ".wav", ".flac", ".webm"],
       pdf: [".pdf"]
     };
     ```
   - Scanner only indexes files with supported extensions

### Verification

- [X] Console shows "Starting background index rebuild..." on every world load
- [X] Console shows per-directory scan log lines with actual subdirectory paths (not just root)
- [X] Console shows "Rebuild complete: N entries indexed" when done
- [X] `game.assetVault.index.status === "ready"` after rebuild finishes
- [X] `game.assetVault.index.size > 0` — files were found
- [X] Scanner discovers files in the current world directory
- [X] Scanner discovers files in active module directories
- [X] Scanner discovers files in the active system directory
- [X] Scanner discovers files in the global assets folder (if it exists)
- [X] Files with unsupported extensions (`.js`, `.json`, `.css`) are not in the index
- [X] Scan does not block world loading (Foundry UI appears before scan finishes)
- [X] `game.assetVault.index.rebuild()` — manually triggered rebuild works from console
- [X] Inaccessible/missing directories are skipped without crashing (assets/ if absent: no error thrown)

---

## Iteration 10 — Index: Auto-Tagging

**Goal:** Generate meaningful tags from file path, name, source, and type.

### Tasks

1. Create `scripts/index/AutoTagger.js`:
   - `generateTags(filePath, source)` → returns `string[]`
   - Tag generation rules:

   | Rule | Input | Output Tags |
   |---|---|---|
   | Path segments | `modules/pf2e/assets/tokens/goblin.webp` | `assets`, `tokens` |
   | Filename split | `goblin-warrior-elite.webp` | `goblin`, `warrior`, `elite` |
   | Source | module `pf2e` | `module:pf2e` |
   | Source | current world | `world:current` |
   | Source | system `pf2e` | `system:pf2e` |
   | Source | global assets | `assets:global` |
   | File type | `.webp` → image | `image` |
   | File type | `.mp3` → audio | `audio` |

   - Filename splitting: split on `-`, `_`, `.` (except extension), spaces, camelCase boundaries
   - Exclude common noise words from path segments: `data`, `modules`, `systems`, `worlds`, `assets`, `images`, `img`, `src`
   - Lowercase all tags
   - Deduplicate

2. Integrate with `IndexManager.rebuild()`:
   - After scanner returns file paths, run `AutoTagger.generateTags()` on each
   - Store result in `IndexEntry.autoTags`

3. Build haystack strings for uFuzzy:
   - After index is built, generate haystack:
     ```javascript
     // One string per entry: "filename tag1 tag2 tag3 ..."
     haystack = entries.map(e => `${e.name} ${e.autoTags.join(" ")} ${e.userTags.join(" ")}`);
     ```
   - Store on `IndexManager.haystack`

### Verification

Verify via browser console after a rebuild:
```javascript
// Inspect a specific entry's auto-tags
game.assetVault.index.getEntries().find(e => e.path.includes("goblin"))?.autoTags

// Quick spot-check helper
game.assetVault.index.getEntries().slice(0, 5).map(e => ({ name: e.name, tags: e.autoTags }))

// Verify haystack length matches entry count
game.assetVault.index.getHaystack().length === game.assetVault.index.size
```

- [X] A file at `modules/<id>/art/tokens/goblin-warrior.webp` gets tags including: `art`, `tokens`, `goblin`, `warrior`, `module:<id>`, `image` (no `modules` noise word, no bare module id)
- [X] A file at `worlds/<worldId>/scenes/cave-map.jpg` gets tags including: `scenes`, `cave`, `map`, `world:current`, `image`
- [X] Audio files include `audio` tag, video files include `video` tag
- [X] Noise words (`modules`, `data`, `systems`, `worlds`, `images`, `img`, `src`) absent from tags
- [X] Module/system/world id is not duplicated as a bare tag (already in `module:id` form)
- [X] All tags are lowercase
- [X] No duplicate tags within a single entry
- [X] `game.assetVault.index.getHaystack().length === game.assetVault.index.size`
- [X] Haystack strings contain filename and tags (e.g. `"goblin-warrior.webp art tokens goblin warrior module:pf2e image"`)

---

## Iteration 11 — Search: uFuzzy Integration

**Goal:** Wire up uFuzzy to search the index and return ranked results.

### Tasks

1. Add uFuzzy to the project:
   - Download `@leeoniya/ufuzzy` and place in `scripts/vendor/uFuzzy.iife.min.js`
   - Or use the ESM build: `scripts/vendor/uFuzzy.esm.js`
   - Import in the search module

2. Create `scripts/search/SearchEngine.js`:
   - Wraps uFuzzy with our configuration
   - Constructor takes the haystack array and entries array
   - Methods:
     - `search(query)` → returns `IndexEntry[]` sorted by relevance
     - `updateHaystack(haystack, entries)` — refresh after index changes
   - uFuzzy pipeline:
     ```javascript
     const uf = new uFuzzy({ intraMode: 1 });
     const [idxs, info, order] = uf.search(haystack, query);
     // Map ordered indexes back to IndexEntry objects
     ```
   - Handle edge cases: empty query (return all), no results, very short queries

3. Implement debounced search input:
   - Create utility: `debounce(fn, delay)` or use `foundry.utils.debounce`
   - 150ms debounce on search input keyup
   - On trigger: run `SearchEngine.search(query)`, render results

4. Expose search via `IndexManager`:
   - `IndexManager.search(query)` — delegates to `SearchEngine`
   - Returns empty array if index not ready

### Verification

Verify via browser console (wait for rebuild to finish first):
```javascript
// Basic search
game.assetVault.index.search("goblin")

// Fuzzy search
game.assetVault.index.search("gblin")

// Empty query — should return []
game.assetVault.index.search("")

// Performance check
console.time("search"); game.assetVault.index.search("warrior"); console.timeEnd("search")
```

- [X] `game.assetVault.index.search("goblin")` returns entries whose name or tags contain "goblin"
- [X] Fuzzy matching: `search("gblin")` returns goblin entries (uFuzzy intraMode: 1)
- [X] Results are sorted by relevance (exact name match appears before tag-only match)
- [X] `search("")` returns `[]` (empty query → empty result, not all entries)
- ~~[ ] `search("anything")` returns `[]` when `index.status !== "ready"`~~
- [X] Search over full index completes in under 50ms (console.time)
- [X] No console errors on any search call

Note: debounce wiring is part of Iteration 12 (UI integration).

---

## Iteration 12 — Search Mode: UI Integration

**Goal:** Typing in the search bar switches the picker to search mode. Clearing returns to browse mode.

### Tasks

1. Implement mode switching in `AssetVaultHub`:
   - Track `this.mode`: `"browse"` or `"search"`
   - Search bar `input` event (debounced):
     - If query is non-empty and index is ready → switch to `"search"` mode
     - If query is cleared → switch back to `"browse"` mode
   - Mode switch triggers content area re-render (not full app re-render)

2. Implement index status banner:
   - Check `game.assetVault.index.status` on render
   - If `"none"`: show warning banner above content — "Index not built. Search unavailable. Use Scan Locations in settings to build the index."
   - If `"building"`: show progress banner — "Indexing... (X%)" with progress bar
   - If `"ready"`: no banner
   - If `"error"`: show error banner with retry option
   - Search bar is `disabled` when index is not `"ready"`

3. Implement search results rendering:
   - Reuse grid/list view components from browse mode
   - Search results are a flat list (no folders)
   - Pass search results through the same rendering logic as browse files
   - Show result count in toolbar: "X results for 'query'"

4. Sidebar in search mode:
   - For MVP: hide sidebar during search (or show a message "Filters available in a future update")
   - Sidebar filter panel is Phase 2

5. Implement "clear search" action:
   - X button in search bar to clear
   - Restores browse mode at the last-browsed directory
   - Store `lastBrowsedPath` before entering search mode

### Verification

- [X] Typing in search bar switches content area from directory listing to search results
- [X] Search results display in grid/list view (same as browse mode)
- [X] Result count shown in toolbar breadcrumb area: "N result(s) for 'query'"
- [X] Sidebar is hidden during search (collapses automatically)
- [X] × (clear) button appears in search bar while typing; disappears when empty
- [X] Clicking × restores browse mode at the directory that was active before searching
- [X] Typing focus is not lost between keystrokes (input stays focused after re-render)
- [X] Fuzzy search works: "goblin" finds goblin files; "gblin" still finds them
- [X] Index status banner appears when `index.status` is `"none"` or `"building"`; absent when `"ready"`
- [X] Clicking a search result selects it and opens the detail panel
- [X] **Picker mode:** double-clicking a search result confirms selection and closes the hub
- [X] **Picker mode:** "Select" footer button works with a search result selected
- [X] No results state: "No results found" message shown instead of empty grid

---

## Iteration 13 — Scan Location Settings UI

**Goal:** Build the scan locations configuration dialog accessible from module settings.

### Tasks

1. Implement `scripts/settings/ScanLocationsConfig.js` (replace placeholder from Iteration 2):
   - Extends `HandlebarsApplicationMixin(ApplicationV2)`
   - Template: `templates/scan-locations.hbs`
   - On open, dynamically build the location lists:

   **Current world:**
   - Display world name, always checked, checkbox disabled

   **Systems:**
   - Iterate `game.systems` or scan `systems/` via `FilePicker.browse()`
   - Mark the active system (`game.system.id`) as default checked
   - Each system has a checkbox

   **Modules:**
   - Single checkbox: "Index active modules"
   - Default: checked

   **Global Assets:**
   - Single checkbox: "Index global assets folder (assets/)"
   - Default: checked

   **Other Worlds:**
   - Iterate worlds via `FilePicker.browse("data", "worlds")`
   - Exclude current world
   - Each world has a checkbox, default unchecked

   **Other Data Root Folders:**
   - `FilePicker.browse("data", "")` to get root listing
   - Filter out `worlds`, `modules`, `systems`, `assets`
   - List remaining folders with checkboxes, default unchecked

   **Font Awesome:**
   - Single checkbox: "Index Font Awesome icons"
   - Default: checked

2. Implement save/load:
   - On open: read `scanLocations` setting, populate checkboxes
   - On save: serialize checkbox states to JSON object, write to setting
   - Schema:
     ```javascript
     {
       systems: { "pf2e": true, "alienrpg": false },
       indexActiveModules: true,
       indexGlobalAssets: true,
       otherWorlds: { "alien-campaign": false },
       otherFolders: { "tokenizer": false },
       indexFontAwesome: true
     }
     ```

3. Implement "Rebuild Index" button:
   - Triggers `game.assetVault.index.rebuild()`
   - Disables button during rebuild
   - Shows progress inline or via notification

4. Handle first-run defaults:
   - If `scanLocations` setting is empty `{}`:
     - Apply defaults (active system on, active modules on, global assets on, rest off)
     - Save defaults immediately so subsequent opens show correct state

### Verification

- [X] Dialog opens from Module Settings → Scan Locations → Configure
- [X] Current world shown with locked "Always" badge, checkbox disabled
- [X] Installed systems listed; active system has "Active" badge and defaults to checked
- [X] "Index all active modules" toggle present and defaults to on
- [X] "Index assets/ folder" toggle present and defaults to on
- [X] Other worlds listed (excluding current world), all unchecked by default
- [X] Other root folders discovered and listed (any folders in Data/ besides worlds/modules/systems/assets)
- [X] Index size shown in footer (e.g. "Indexed files: 1234")
- [X] Save button persists settings — reopen dialog and checkboxes reflect saved state
- [X] Rebuild button triggers a rebuild; button shows spinner while building
- [X] After rebuild, index reflects only enabled locations (e.g. disable a system → its files gone from index)
- [X] No console errors opening the dialog

---

## Iteration 14 — Integration Testing & Polish

**Goal:** End-to-end verification of the complete Phase 1 feature set across both hub and picker modes. Fix bugs, polish rough edges.

### Tasks

1. **Picker mode** — full workflow testing:
   - Test every file picker entry point in Foundry:
     - Scene background/foreground image
     - Actor/token portrait
     - Item image
     - Tile image
     - Audio playlist track
     - Journal entry image (if applicable)
     - Module settings with `filePicker: true`
   - For each: browse to a file, select it, verify it applies
   - For each: search for a file, select it, verify it applies
   - Verify file type filtering is correct for each entry point

2. **Hub mode** — standalone workflow testing:
   - Open Hub from scene UI button
   - Browse directories, preview files
   - Use search to find files
   - Copy URL from detail panel
   - Verify no "Select" button or callback behavior
   - Verify Hub stays open while interacting with other Foundry UI
   - Open Hub, then trigger a picker — verify both coexist (picker is separate instance)

3. Edge case testing:
   - Empty world (no uploaded files)
   - World with many files (500+)
   - Deeply nested directories (5+ levels)
   - Files with special characters in names
   - Files with very long names
   - S3 storage (if available to test)
   - Multiple pickers open simultaneously
   - Hub open + picker open simultaneously
   - Opening picker while Hub is already open (should be independent instances)

4. Escape hatch testing:
   - Enable "Use Default File Picker" → verify default picker works for file picker buttons
   - Verify Hub scene UI button still works (escape hatch only affects picker, not hub)
   - Disable escape hatch → verify Asset Vault picker returns

5. Performance audit:
   - Check memory usage after index build (DevTools Memory tab)
   - Check search latency with console.time for various dataset sizes
   - Check UI rendering speed with many files (grid view)
   - Verify `loading="lazy"` is working (Network tab)

6. CSS polish:
   - Verify theme compatibility (default Foundry theme)
   - Check scrollbar behavior in all panels
   - Verify no layout overflow/clipping issues
   - Hover and focus states on all interactive elements
   - Verify picker footer "Select" button styling

### Verification

**Picker mode**
- [X] Scene background image picker → browse to file → applies correctly
- [X] Actor portrait picker → search for file → applies correctly
- [X] Tile image picker → browse + double-click → applies correctly
- [X] Audio playlist track picker → file type filter shows only audio
- [X] File type filtering correct per entry point (image picker doesn't show audio files)

**Hub mode**
- [X] Hub opens from Tile Controls → Browse button (vault icon)
- [X] Hub open + trigger a file picker → both windows coexist with separate DOM ids
- [X] No "Select" footer button or callback behavior in hub mode
- [X] Copy URL copies path to clipboard

**Escape hatch**
- [X] Enable "Use Default Picker" → file picker buttons use Foundry's default picker
- [X] With escape hatch on → Tile Controls Browse button reverts to default behaviour
- [X] Disable escape hatch → file picker buttons use Asset Vault again

**Polish**
- [X] File type labels (Image, Video, Audio, PDF, File, Folder) display correctly in list view
- [X] Scan Locations → Rebuild button saves settings, fires rebuild, stays open showing spinner
- [X] Index status banner auto-shows when rebuild starts, disappears when done (hub open)
- [X] No console errors during typical browse, search, and picker workflows
- [X] Search latency: `console.time("s"); game.assetVault.index.search("goblin"); console.timeEnd("s")` — under 100ms

---

## Phase 2 — Full Feature Set

---

## Iteration 15 — User-Defined Tags

**Goal:** GMs can add and remove custom tags on any indexed file via the detail panel. User tags are persisted in the index and searchable.

### Tasks

1. Add tag editing UI to the detail panel:
   - Below the auto-tags display, add a "User Tags" section
   - Show existing user tags as dismissible chips (click × to remove)
   - Add an input field + "Add" button (or Enter key) to add new tags
   - Visually distinguish user tags from auto-tags (different color/style)
   - Auto-tags section: respect the `showAutoTags` user setting (hide if off)

2. Implement tag persistence:
   - On add/remove, update the `IndexEntry.userTags` array in `IndexManager`
   - Immediately save the updated index to disk via `IndexStore.save()`
   - Rebuild the haystack string for the modified entry (update in-place, don't rebuild entire haystack)

3. Tag input UX:
   - Lowercase and trim input
   - Prevent duplicate tags (show notification if tag already exists)
   - Prevent empty tags
   - Support comma-separated input for adding multiple tags at once: `"npc, boss, dragon"` → 3 tags
   - Max tag length: 50 characters

4. Update haystack on tag change:
   - After modifying `userTags`, rebuild that entry's haystack string:
     ```javascript
     haystack[entryIndex] = `${entry.name} ${entry.autoTags.join(" ")} ${entry.userTags.join(" ")}`;
     ```
   - No need to reinstantiate uFuzzy — it searches the haystack array directly

### Verification

- [X] Detail panel shows "User Tags" section below auto-tags when a file is selected
- [X] Adding a tag via the input field creates a chip in the user tags section
- [X] Removing a tag (× on chip) removes it immediately
- [X] Tags persist after closing and reopening the Hub
- [X] Tags persist after world reload (check `index.json` file)
- [X] Searching for a user tag returns the tagged file
- [X] Comma-separated input creates multiple tags
- [X] Duplicate tags are rejected with notification
- [X] Empty input is ignored
- [X] Auto-tags are hidden when `showAutoTags` setting is off, user tags still visible
- [X] Tag changes on one file do not affect other files' tags

---

## Iteration 16 — Advanced Search Syntax

**Goal:** Support structured query operators alongside free-text fuzzy search. Operators pre-filter results before uFuzzy runs on the free-text portion.

### Tasks

1. Create `scripts/search/QueryParser.js`:
   - Parse a query string into structured parts:
     ```javascript
     // Input: "[type:image] [tag:npc] dragon cave"
     // Output: { filters: [ {key:"type", value:"image"}, {key:"tag", value:"npc"} ], freeText: "dragon cave" }
     ```
   - Regex to extract `[key:value]` operators
   - Remaining text after operator extraction = free text for uFuzzy
   - Supported operators:

   | Operator | Matches against | Example |
   |---|---|---|
   | `[type:<filetype>]` | `IndexEntry.type` | `[type:audio]` |
   | `[tag:<value>]` | `autoTags` + `userTags` | `[tag:boss]` |
   | `[source:<value>]` | `IndexEntry.source` | `[source:module:pf2e]` |
   | `[ext:<value>]` | File extension | `[ext:webp]` |

   - Case-insensitive matching
   - Multiple operators are AND-combined

2. Update `SearchEngine.search()`:
   - Parse query via `QueryParser`
   - Apply filters first: iterate entries, keep only those matching ALL filter operators
   - If free text remains, build a temporary haystack from the filtered set and run uFuzzy on it
   - If no free text (only operators), return filtered results sorted alphabetically
   - If no operators (only free text), existing behavior unchanged

3. Add search syntax hint:
   - Tooltip or small helper text below the search bar (collapsible)
   - Show available operators on focus or via a `?` icon button
   - Content: `"Operators: [type:image] [tag:npc] [source:module:pf2e] [ext:webp] — combine with free text"`

4. Add i18n strings for the syntax hint.

### Verification

- [X] `[type:image]` returns only image files
- [X] `[type:audio]` returns only audio files
- [X] `[tag:npc]` returns files with "npc" in either autoTags or userTags
- [X] `[source:module:pf2e]` returns only files from the pf2e module
- [X] `[ext:webp]` returns only .webp files
- [X] `[type:image] [tag:boss] dragon` returns image files tagged "boss" with "dragon" in name/tags
- [X] Multiple filters are AND-combined: `[type:image] [type:audio]` returns nothing (a file can't be both)
- [X] Operators are case-insensitive: `[Type:Image]` works
- [X] Free text alone (no operators) works as before (fuzzy search)
- [X] Operators alone (no free text) return filtered results sorted alphabetically
- [X] Unknown operators (e.g., `[foo:bar]`) are treated as free text, not errors
- [X] Syntax hint is visible near search bar

### Enhancement (added during implementation)

Autocomplete dropdown + inline filter chips were added on top of the core search syntax:

- **`scripts/search/SearchAutocomplete.js`** (new): Dropdown attached to the hub window, positioned with `position: fixed`. Typing `[` shows available operators; selecting one shows contextual value completions from the live index. Arrow keys navigate, Enter/Tab confirm, Escape dismisses. Click-outside closes.
- **Filter chips in search bar**: Confirmed operators render as dismissible `×` chips inside `.av-search` to the left of the free-text input. Raw `[operator:value]` syntax never appears in the input field. Hub state split into `#searchFilters[]` + `#searchFreeText`; `get #searchQuery()` assembles the full query for `SearchEngine`.

### Verification (enhancement)

- [X] Typing `[` shows operator suggestions: `type`, `tag`, `source`, `ext`
- [X] Selecting an operator key immediately shows value completions
- [X] `[type:]` completions are `image`, `video`, `audio`, `pdf` (no "other")
- [X] `[tag:]` completions come from the live index, sorted by frequency
- [X] `[source:]` and `[ext:]` completions come from the live index
- [X] Selecting a value creates a chip in the search bar; raw text is cleared from the input
- [X] Clicking × on a chip removes that filter and re-runs search
- [X] Clear button removes all chips and free text
- [X] Arrow keys navigate dropdown without triggering a search

---

## Iteration 17 — Filter Panel (Search Mode Sidebar)

**Goal:** When in search mode, the sidebar shows faceted filters for narrowing results by type, tags, and source. Clicking a filter applies it without typing.

### Tasks

1. Implement filter panel template `parts/filter-panel.hbs`:
   - **File type section:** Checkboxes for each type (Image, Video, Audio, PDF). Counts next to each showing how many index entries match.
   - **Source section:** Collapsible groups — current world, modules (list active), systems, assets. Checkboxes per source with counts.
   - **Tags section:** Show most-used tags (top 20–30) as clickable chips. Clicking a tag adds `[tag:value]` to the search bar.
   - "Clear all filters" button at top

2. Implement sidebar mode switching:
   - In browse mode: sidebar shows folder tree (existing)
   - In search mode: sidebar shows filter panel (new)
   - Transition occurs automatically when switching browse↔search

3. Wire filters to search:
   - Checking/unchecking a type filter → update the search bar with `[type:...]` operators and re-run search
   - Checking/unchecking a source filter → same with `[source:...]`
   - Clicking a tag chip → append `[tag:value]` to search bar and re-run
   - The search bar is always the source of truth — filters write to it, search reads from it
   - Active filters shown as dismissible chips above content area (read from search bar operators)

4. Compute facet counts:
   - After search results are computed, count how many results per type/source/tag
   - Update filter panel counts dynamically
   - Types/sources with 0 results are greyed out but still visible

### Verification

- [ ] Switching to search mode replaces folder tree with filter panel in sidebar
- [ ] Switching back to browse mode restores folder tree
- [ ] File type checkboxes show counts matching the full index
- [ ] Checking "Image" filter adds `[type:image]` to search bar and narrows results
- [ ] Unchecking removes the operator and broadens results
- [ ] Source section lists active modules, systems, world, assets
- [ ] Clicking a tag chip adds `[tag:value]` to search bar
- [ ] "Clear all filters" removes all operators from search bar
- [X] Active filters display as dismissible chips (inline in the search bar, added in Iteration 16 enhancement)
- [X] Dismissing a chip removes the corresponding operator and re-runs search
- [ ] Facet counts update dynamically after each search
- [ ] Zero-count types/sources are greyed out
- [ ] Combining filter panel clicks with typed free text works correctly

---

## Iteration 18 — Audio/Video Playback in Detail Panel

**Goal:** Selecting an audio or video file shows playback controls in the detail panel with play/pause/seek functionality.

### Tasks

1. Update detail panel preview rendering:
   - **Audio files:** Render a styled `<audio>` element with native controls. Add:
     - Play/pause button (large, centered)
     - Seek bar (native or custom)
     - Duration display
     - Volume control
     - File type icon above controls as visual placeholder
   - **Video files:** Render a `<video>` element with native controls. Add:
     - `preload="metadata"` to load duration/dimensions without downloading full file
     - Poster frame: first frame rendered by browser
     - Play/pause, seek, volume, fullscreen controls (native)
     - Constrain video to detail panel dimensions with `object-fit: contain`

2. Handle media lifecycle:
   - Stop playback when selecting a different file
   - Stop playback when closing the Hub/picker
   - Stop playback when switching from search to browse mode (or vice versa)
   - Clean up media elements on `_tearDown` or `close`

3. Display media metadata in detail panel:
   - Audio: duration, file size
   - Video: duration, dimensions, file size
   - Read from `<audio>`/`<video>` element's `loadedmetadata` event

4. CSS for media controls:
   - Audio player: centered in preview area, full width
   - Video player: aspect-ratio-preserving container
   - Consistent styling with the rest of the detail panel

### Verification

- [ ] Selecting an audio file shows an audio player in the detail panel
- [ ] Audio plays, pauses, seeks correctly
- [ ] Selecting a video file shows a video player in the detail panel
- [ ] Video plays inline with controls
- [ ] Switching to a different file stops the previous playback
- [ ] Closing the Hub stops any active playback
- [ ] Duration and file metadata display in the detail panel
- [ ] Video respects aspect ratio within the panel bounds
- [ ] No errors with unsupported formats (graceful fallback to type icon)
- [ ] Media elements are cleaned up properly (no orphaned audio playing after close)

---

## Iteration 19 — Font Awesome Icon Search

**Goal:** Font Awesome Free icons are searchable and selectable. Integrates with the index and search engine.

### Tasks

1. Prepare Font Awesome metadata:
   - Download `@fortawesome/fontawesome-free` npm package
   - Extract `metadata/icons.json`
   - Create a trimmed version at `data/fa-icons.json` containing only:
     ```javascript
     {
       "<icon-name>": {
         "search": { "terms": ["alias1", "alias2", ...] },
         "styles": ["solid", "regular"],  // which styles are free
         "unicode": "f0e7"
       }
     }
     ```
   - Include this file in the module (ship with module, ~100-150KB trimmed)

2. Build Font Awesome index entries:
   - In `IndexManager`, when `indexFontAwesome` is enabled:
     - Load `fa-icons.json`
     - Create `IndexEntry` objects for each icon:
       ```javascript
       {
         path: "fa-solid fa-<name>",  // CSS class string as "path"
         name: "<name>",
         type: "icon",
         source: "fontawesome",
         autoTags: ["icon", "fontawesome", ...searchTerms],
         userTags: [],
         indexedAt: Date.now()
       }
       ```
   - Add to index alongside file entries
   - Add to haystack

3. Update display for icon entries:
   - In grid view: render the icon glyph at large size (use the FA class directly)
   - In list view: render icon glyph in the thumbnail column
   - Detail panel preview: large centered icon glyph + icon name + CSS class + unicode value
   - "Copy Class" button instead of "Copy URL" for icon entries

4. Update picker selection for icons:
   - When confirming an icon selection in picker mode:
     - Return the CSS class string (e.g., `"fa-solid fa-dragon"`) as the selected path
     - This works for icon picker fields but may not work for image fields — test and handle gracefully
   - In hub mode: "Copy Class" copies the CSS class string

5. Add `[type:icon]` filter support:
   - Already handled by Iteration 16's type filter — just need icon entries in the index

### Verification

- [ ] With Font Awesome indexing enabled, icons appear in search results for relevant queries
- [ ] `[type:icon]` filter returns only Font Awesome icons
- [ ] Searching "dragon" returns the `fa-dragon` icon (among other results)
- [ ] Searching "arrow" returns multiple arrow-related icons
- [ ] Icon grid view shows the actual icon glyphs (not broken images)
- [ ] Icon detail panel shows large glyph, name, CSS class, and unicode value
- [ ] "Copy Class" button copies `"fa-solid fa-dragon"` to clipboard
- [ ] In picker mode, selecting an icon returns the CSS class string
- [ ] Icons don't appear when `indexFontAwesome` is disabled in scan locations
- [ ] Icon entries don't break file-based searches or filters
- [ ] FA metadata file loads without errors

---

## Iteration 20 — Detached Window Mode

**Goal:** The Hub can be popped out into a separate browser window for multi-monitor setups, using ApplicationV2's native `detachWindow()` / `attachWindow()`.

### Tasks

1. Add detach/attach button to the toolbar:
   - Icon button: `fa-solid fa-up-right-from-square` (detach) / `fa-solid fa-down-left-and-up-right-to-center` (attach)
   - Clicking toggles between detached and attached state
   - Uses `this.detachWindow()` and `this.attachWindow()` from ApplicationV2

2. Persist detached preference:
   - Read `detachedMode` setting on Hub open
   - If `true`, auto-detach after initial render
   - On manual detach/attach, update the setting

3. Handle detach lifecycle:
   - Detaching should preserve:
     - Current browse path
     - Search query and results
     - Selected file and detail panel state
     - View mode (grid/list)
   - After detach, the Hub renders in a new browser window
   - After attach, it returns to the main Foundry window

4. CSS considerations:
   - Ensure styles are loaded in the detached window
   - Foundry's CSS variables may not be available in a detached window — provide fallbacks
   - Test scrolling, resizing, and layout in detached state

5. Handle picker mode:
   - Picker mode should NOT auto-detach (it's modal and needs to return a value)
   - Detach button can still be available in picker mode for manual use
   - Confirm selection in detached picker should close the detached window and call the callback

### Verification

- [ ] Detach button visible in toolbar
- [ ] Clicking detach opens the Hub in a new browser window
- [ ] Hub content is fully functional in the detached window (browse, search, preview)
- [ ] Clicking attach returns the Hub to the main Foundry window
- [ ] State is preserved across detach/attach (browse path, search query, selected file)
- [ ] `detachedMode` setting auto-detaches on Hub open when enabled
- [ ] Picker mode does NOT auto-detach
- [ ] File selection in detached picker mode calls the callback and closes correctly
- [ ] CSS renders correctly in detached window (no broken layout or missing styles)
- [ ] Closing the detached window (browser close/X) properly cleans up the application

---

## Iteration 21 — Right-Click Context Menu

**Goal:** Right-clicking a file in the content area shows a context menu with common actions.

### Tasks

1. Implement context menu using Foundry's `ContextMenu` class:
   - Register on file items in both grid and list views
   - Menu items:

   | Action | Icon | Available | Description |
   |---|---|---|---|
   | Copy URL | `fa-solid fa-link` | Always | Copy file path to clipboard |
   | Copy Filename | `fa-solid fa-copy` | Always | Copy just the filename |
   | Open in New Tab | `fa-solid fa-arrow-up-right-from-square` | Always | Open file URL in new browser tab |
   | Show in Folder | `fa-solid fa-folder-open` | Search mode | Switch to browse mode at the file's directory |
   | Add Tag | `fa-solid fa-tag` | Hub mode (GM) | Open tag input dialog |
   | Select | `fa-solid fa-check` | Picker mode | Confirm selection |

2. Implement "Show in Folder":
   - Only shown when in search mode
   - Extracts directory path from the file's full path
   - Clears search, switches to browse mode, navigates to that directory
   - Highlights the file in the directory listing

3. Implement "Add Tag" quick action:
   - Opens a small dialog (DialogV2) with a text input for tag(s)
   - Adds tags to the file's userTags (same logic as detail panel)
   - Shortcut for tagging without opening the detail panel

4. Implement "Open in New Tab":
   - `window.open(filePath, "_blank")`
   - Only for file entries, not Font Awesome icons

5. Context menu for folders:
   - Simplified menu: only "Open" (navigate into) and "Copy Path"

### Verification

- [ ] Right-clicking a file in grid view shows the context menu
- [ ] Right-clicking a file in list view shows the context menu
- [ ] "Copy URL" copies the full path to clipboard
- [ ] "Copy Filename" copies just the filename
- [ ] "Open in New Tab" opens the file in a new browser tab
- [ ] "Show in Folder" switches from search to browse and navigates to the file's directory
- [ ] "Add Tag" opens a dialog and successfully adds tags
- [ ] "Select" appears only in picker mode and confirms selection
- [ ] Context menu on a folder shows reduced options
- [ ] Context menu on a Font Awesome icon shows "Copy Class" instead of "Copy URL"
- [ ] Menu closes on click outside or Escape key
- [ ] No errors when right-clicking various file types

---

## Iteration 22 — Incremental Index Updates

**Goal:** When files are uploaded or deleted during a session, the index updates automatically without requiring a full rebuild.

### Tasks

1. Hook into Foundry upload events:
   - Listen for file upload completion. Possible hooks/events:
     - `FilePicker.upload()` returns a promise — can we hook after it resolves?
     - Check for a `"uploadFile"` or similar hook in v13
     - If no direct hook exists, monkey-patch `FilePicker.upload()` to emit a custom hook after success
   - On upload detected:
     - Create an `IndexEntry` for the new file
     - Run `AutoTagger.generateTags()` on it
     - Add to index via `IndexManager.addEntries()`
     - Update haystack in-place
     - Save index to disk (debounced — batch rapid uploads)

2. Handle file deletion:
   - Foundry doesn't have a file deletion API in FilePicker — files are managed at the OS level
   - Stale detection: during browse, if a previously indexed file is not found in `FilePicker.browse()` results, mark it for removal
   - Lazy cleanup: periodically (or on next rebuild) remove entries for files that no longer exist
   - Don't block on this — stale entries in search results are a minor inconvenience, not a blocker

3. Handle directory creation:
   - When `FilePicker.createDirectory()` is called, no index action needed (directories aren't indexed)
   - But the sidebar folder tree should update — trigger a sidebar re-render if the tree is visible

4. Debounced save:
   - Multiple rapid uploads (e.g., batch upload) should not trigger individual saves
   - Debounce `IndexStore.save()` with a 2-second delay
   - Ensure save fires on window unload if there are unsaved changes

5. Update UI reactively:
   - If the Hub is open during an upload, the new file should appear in:
     - Browse mode (if viewing the upload directory) — re-browse the current directory
     - Search results (if the file matches the current query) — re-run search

### Verification

- [ ] Upload a file via Foundry's upload button → file appears in the index within seconds
- [ ] `game.assetVault.index.getEntry("path/to/uploaded/file.webp")` returns the new entry
- [ ] New file has auto-tags generated correctly
- [ ] Search finds the newly uploaded file immediately
- [ ] Batch upload (multiple files) only triggers one index save (debounced)
- [ ] If the Hub is open in browse mode at the upload directory, new file appears after upload
- [ ] If the Hub is open in search mode, re-searching finds the new file
- [ ] No errors during upload process
- [ ] Index file on disk reflects the new entries after save
- [ ] Stale entries (deleted files) don't cause errors in search or browse

---

## Iteration 23 — Drag-and-Drop from Hub

**Goal:** Files can be dragged from the Hub's content area into Foundry's rich text editors (journals, item descriptions, character notes) and onto the canvas.

### Tasks

1. Make file items draggable:
   - Add `draggable="true"` to file items in grid and list views
   - Only in hub mode (not picker mode — picker uses click-to-select)
   - Set up `dragstart` event handler on file items

2. Implement drag data format:
   - For images dropped onto **rich text editors** (ProseMirror/TinyMCE):
     ```javascript
     event.dataTransfer.setData("text/plain", filePath);
     event.dataTransfer.setData("text/html", `<img src="${filePath}" />`);
     ```
   - For images dropped onto the **canvas** (creates a Tile):
     ```javascript
     event.dataTransfer.setData("application/json", JSON.stringify({
       type: "Tile",
       texture: { src: filePath }
     }));
     ```
   - For audio dropped onto the **canvas** (creates an AmbientSound):
     ```javascript
     event.dataTransfer.setData("application/json", JSON.stringify({
       type: "AmbientSound",
       path: filePath
     }));
     ```
   - Set all applicable formats simultaneously — the drop target picks the one it understands

3. Implement drag preview:
   - For images: use the thumbnail as the drag ghost image
   - For non-images: use the type icon
   - `event.dataTransfer.setDragImage(element, offsetX, offsetY)`

4. Handle drop targets:
   - Foundry's ProseMirror editor should accept `text/html` drops natively
   - Canvas drop: Foundry's canvas drop handler reads `application/json` — verify the data format matches what Foundry expects for Tile and AmbientSound creation
   - Test with: Journal page editor, Item description editor, Actor biography field

5. Disable drag in picker mode:
   - Picker mode files should NOT be draggable (prevents confusion with click-to-select)
   - Remove `draggable` attribute when `mode === "picker"`

6. Visual feedback:
   - Add drag-active CSS class on the file item during drag
   - Add a subtle "drag hint" indicator on hover in hub mode (e.g., grip icon)

### Verification

- [ ] Files in hub mode are draggable (cursor changes on hover)
- [ ] Files in picker mode are NOT draggable
- [ ] Dragging an image into a Journal page editor inserts the image
- [ ] Dragging an image into an Item description field inserts the image
- [ ] Dragging an image onto the canvas creates a Tile at the drop position
- [ ] Dragging an audio file onto the canvas creates an AmbientSound
- [ ] Drag ghost image shows the file thumbnail (or type icon for non-images)
- [ ] Drag does not interfere with click-to-select or detail panel behavior
- [ ] Dragging a Font Awesome icon does not crash (graceful no-op or copies class string)
- [ ] Multiple rapid drags don't cause errors
- [ ] Drop into ProseMirror editors works (Foundry v13's default rich text editor)

---

## Iteration 24 — Phase 2 Integration Testing & Polish

**Goal:** End-to-end verification of all Phase 2 features. Fix bugs, ensure features work together.

### Tasks

1. **Tag workflow testing:**
   - Add tags to files → search by tags → verify results
   - Remove tags → verify they disappear from search
   - Add tags via detail panel and via right-click context menu
   - Verify tags persist across world reloads

2. **Advanced search + filter panel integration:**
   - Use filter panel to set type → verify search bar updates with operator
   - Type free text while filters are active → verify combined results
   - Click tag chip in filter panel → verify added to search bar
   - Clear all filters → verify everything resets
   - Dismiss individual filter chips → verify correct operator removed

3. **Media playback testing:**
   - Play audio → select different file → verify first audio stops
   - Play video → close Hub → verify video stops
   - Play audio in detached window → verify works

4. **Font Awesome integration:**
   - Search for icons alongside files → mixed results display correctly
   - Filter to `[type:icon]` → only icons shown
   - Select icon in picker mode where calling context expects an icon → works
   - Select icon in picker mode where calling context expects an image → verify graceful handling

5. **Drag-and-drop integration:**
   - Drag from Hub while picker is also open → verify no interference
   - Drag image into journal → verify inline image renders
   - Drag into different journal page types (text, image)

6. **Incremental index testing:**
   - Upload file while Hub is open in search mode → re-search finds it
   - Upload while Hub is closed → reopen, search finds it
   - Upload batch of files → index updated, single save

7. **Detached window testing:**
   - All features work in detached mode: browse, search, filter, tags, playback, drag
   - Detach with search active → search persists
   - Attach back → state preserved

### Verification

- [ ] Tags: add → search → find → remove → search → not found — full cycle works
- [ ] Advanced search: `[type:image] [tag:boss] dragon` returns correct filtered fuzzy results
- [ ] Filter panel and search bar stay in sync bidirectionally
- [ ] Audio/video playback stops on file change, Hub close, and mode switch
- [ ] Font Awesome icons display correctly in grid, list, and detail panel
- [ ] Drag-and-drop inserts images into journals and creates tiles on canvas
- [ ] Incremental uploads appear in index without full rebuild
- [ ] Detached window mode preserves all functionality
- [ ] Right-click context menu works on all item types (files, folders, icons)
- [ ] No console errors across all Phase 2 features
- [ ] Performance: search with filters still under 100ms for typical queries

---

## Post-Phase 2 — What Comes Next

Once all Phase 2 iterations pass verification, the module is a full-featured media hub.

**Phase 3 priorities:**
1. Player access with restricted mode
2. Cross-world scanning
3. Virtual scrolling for large result sets (10,000+ files)
4. Extensibility API (custom search providers, tag API for other modules)
5. Localization support

---

*Plan version: 2.0*
*Companion document: DESIGN.md (Asset Vault Design Guidelines v1.1)*