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

- [ ] Scan Locations dialog opens from module settings
- [ ] Current world is shown and locked on
- [ ] All installed systems are listed with correct active-system default
- [ ] Module toggle is present and defaults to on
- [ ] Global assets toggle is present and defaults to on
- [ ] Other worlds are listed (excluding current), all defaulting to off
- [ ] Other Data root folders are discovered and listed
- [ ] Saving settings persists — reopening shows same state
- [ ] "Rebuild Index" button triggers a rebuild
- [ ] Rebuild respects the saved configuration (only scans enabled locations)
- [ ] First-run defaults are applied when setting is empty
- [ ] No errors when a scan location has no files

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

- [ ] All file picker entry points work with Asset Vault in picker mode
- [ ] Hub opens from scene UI button and works independently
- [ ] Browse → select → apply works for all file types (picker mode)
- [ ] Search → select → apply works for all file types (picker mode)
- [ ] Browse and search work in hub mode without select/callback behavior
- [ ] Hub and picker can coexist (open simultaneously as separate instances)
- [ ] Escape hatch correctly toggles picker without affecting hub
- [ ] No console errors during normal usage
- [ ] No memory leaks (check after opening/closing hub and picker 10 times each)
- [ ] Search latency under 100ms for typical queries
- [ ] Grid view renders smoothly with 200+ files visible
- [ ] Layout looks correct at various dialog sizes
- [ ] All text is localized via i18n keys (no hardcoded strings in templates)

---

## Post-Phase 1 — What Comes Next

Once all 14 iterations pass verification, Phase 1 (MVP) is complete. The module is a functional media hub and FilePicker replacement with browse and search capabilities.

**Phase 2 priorities** (in suggested order):
1. User-defined tags (add/remove in detail panel)
2. Advanced search syntax (`[type:image] [tag:npc] dragon`)
3. Filter panel in sidebar (search mode facets)
4. Audio/video playback in detail panel
5. Font Awesome icon search
6. Detached window mode
7. Right-click context menu
8. Incremental index updates via upload hooks
9. Drag-and-drop from Hub to journals, rich text editors, and canvas

**Phase 3 priorities:**
1. Player access with restricted mode
2. Cross-world scanning
3. Virtual scrolling for large result sets
4. Extensibility API

---

*Plan version: 1.1*
*Companion document: DESIGN.md (Asset Vault Design Guidelines v1.1)*