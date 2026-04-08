# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Asset Vault** is a Foundry VTT v13 module (`id: asset-vault`) that replaces the built-in `FilePicker` with a searchable, taggable media asset browser. It is a client-side browser module — no build step, no bundler. Files are served directly by Foundry's static file server.

## Development Workflow

There is no build step. Edit files directly; reload Foundry VTT (F5) to see changes. To reload just the module scripts without a full page reload, use the `devMode` module's hot-reload feature if installed, or run in the browser console:
```javascript
location.reload();
```

To verify module state in the browser console:
```javascript
game.assetVault              // Module's global namespace
game.assetVault.index        // IndexManager singleton
game.assetVault.index.status // "none" | "building" | "ready" | "error"
CONFIG.ux.FilePicker         // Should be AssetVaultPicker when module is active
```

## Architecture

### Two-Class UI Model

The module uses two UI classes:

- **`AssetVaultPicker`** (`scripts/picker/AssetVaultPicker.js`) — Subclass of Foundry's `FilePicker`. Registered as `CONFIG.ux.FilePicker` during `init` hook. Does not render its own UI; instead, its `render()` method instantiates `AssetVaultHub` in `"picker"` mode and delegates to it. It acts as a bridge only.

- **`AssetVaultHub`** (`scripts/hub/AssetVaultHub.js`) — `HandlebarsApplicationMixin(ApplicationV2)`. The actual UI. Operates in two modes:
  - `"hub"` — standalone browser opened from the scene controls toolbar
  - `"picker"` — file selection mode, opened when `AssetVaultPicker.render()` is called. Shows a "Select" footer button and calls the picker callback on selection.

### Index Subsystem

Lives in `scripts/index/`. Three classes:

- **`IndexEntry`** — Data schema (typedef): `{path, name, type, source, autoTags, userTags, indexedAt, meta}`
- **`IndexStore`** — Reads/writes `worlds/<worldId>/asset-vault/index.json` using `FilePicker.browse()`, `FilePicker.upload()`, and Foundry's fetch API.
- **`IndexManager`** — Singleton at `game.assetVault.index`. Orchestrates scanning, auto-tagging, and exposes `search(query)`. Status lifecycle: `none → building → ready`.

### Search

**`SearchEngine`** (`scripts/search/SearchEngine.js`) wraps `@leeoniya/ufuzzy` (vendored at `scripts/vendor/uFuzzy.esm.js` — not a runtime npm dep). The haystack is one string per entry: `"filename tag1 tag2 ..."`. uFuzzy config: `{ intraMode: 1 }`.

Search is debounced 150ms using `foundry.utils.debounce`. The Hub switches between `"browse"` and `"search"` content modes without a full re-render.

### Auto-Tagging

**`AutoTagger`** (`scripts/index/AutoTagger.js`) generates tags from file path segments, filename (split on `-_. ` and camelCase), source type (`module:id`, `world:current`, etc.), and MIME category (`image`, `audio`, `video`). Noise words (`data`, `modules`, `systems`, `worlds`, `assets`, `images`, `img`, `src`) are excluded.

### Settings

Registered in `scripts/settings.js` via `registerSettings()` called during `init`:

| Key | Scope | Notes |
|---|---|---|
| `useDefaultPicker` | user | Escape hatch — bypasses module |
| `viewMode` | user | `"grid"` or `"list"` |
| `detachedMode` | user | Detached window behavior |
| `showAutoTags` | user | Show auto-generated tags in UI |
| `enableForPlayers` | world | Expose picker to non-GM users |
| `scanLocations` | world | JSON object of enabled scan paths |

`useDefaultPicker` check must run in `setup` hook (not `init`) because user-scoped settings aren't available in `init`.

### Templates

Handlebars templates in `templates/`:
- `hub.hbs` — main layout (toolbar, sidebar, content area, detail panel, optional footer)
- `parts/toolbar.hbs`, `parts/sidebar.hbs`, `parts/content.hbs`, `parts/detail-panel.hbs`
- `scan-locations.hbs` — settings dialog for scan configuration

### Foundry API Conventions

- Use `foundry.applications.api.HandlebarsApplicationMixin` and `ApplicationV2` (not legacy `Application`)
- Use `foundry.utils.mergeObject` for option merging
- `FilePicker.browse(source, path)` for directory listing — returns `{ dirs, files }`
- `FilePicker.upload(source, path, file)` for writing files back to disk
- `FilePicker.createDirectory(source, path)` for creating directories
- i18n namespace: `"asset-vault"`, localized via `game.i18n.localize("asset-vault.key")`
- Scene control button registered via `Hooks.on("getSceneControlButtons", ...)`

## Implementation Plan

`implementation-plan.md` describes the full iterative build plan (Iterations 0–14). Each iteration has explicit verification checklists. The plan is the authoritative source for what to build and in what order. Always check off verification items before moving to the next iteration.

## File Type Support

```javascript
const SUPPORTED_EXTENSIONS = {
  image: [".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"],
  video: [".mp4", ".webm", ".ogg"],
  audio: [".mp3", ".ogg", ".wav", ".flac", ".webm"],
  pdf:   [".pdf"]
};
```

## Module Entry Point

`scripts/module.js` is the sole `esmodules` entry. It:
1. Imports all classes
2. In `init` hook: calls `registerSettings()`, stores `game.assetVault.originalPicker`, conditionally sets `CONFIG.ux.FilePicker = AssetVaultPicker`
3. In `ready` hook: initializes `IndexManager` (loads existing index or triggers rebuild)
4. Registers scene controls button via `getSceneControlButtons` hook
