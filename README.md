# Asset Vault

A media asset management hub for Foundry VTT, replacing the built-in FilePicker with a powerful, searchable, taggable browser. Gives GMs — and optionally players — fast, organized access to all media assets across their Foundry installation.

**Requires Foundry VTT v13+**

---

## Overview

Asset Vault replaces Foundry's default file picker with a full-featured asset browser. It automatically indexes your media files, lets you search and filter across all configured locations, tag assets, bookmark folders, and drag images directly onto the canvas — all from one interface.

The browser opens wherever the normal file picker would: character portraits, tile images, ambient audio, journal illustrations, and so on. It can also be launched standalone from the scene controls toolbar.

---

## Features

### Asset Browser

The Hub is the main UI. It operates in two modes:

- **Browse mode** — navigate your folder tree, see thumbnails or a list, preview selected assets in the detail panel
- **Search mode** — full-text fuzzy search across every indexed file, with structured filter operators

Switch between grid and list view with the toolbar buttons. Your last-used view is remembered per session.

### Full-Text & Structured Search

Type anything in the search bar to fuzzy-search across filenames, tags, and source paths. Combine free text with structured operators:

| Operator | Example | Effect |
|---|---|---|
| `type:` | `type:image` | Filter by media type |
| `tag:` | `tag:npc` | Match a specific tag |
| `source:` | `source:module:dnd5e` | Filter by source module or world |
| `ext:` | `ext:webp` | Filter by file extension |

Multiple terms or comma-separated values apply as OR logic. Structured filters appear as chips in the search bar and can be removed individually.

### Filter Panel

A collapsible sidebar panel exposes faceted filters built from the live index: file types, sources, and the most-used tags. Clicking a filter value adds it to the active search.

### Indexing

Asset Vault builds a searchable index of your media files in the background when the GM logs in. The index is stored in `worlds/<world-id>/asset-vault/index.json` and shared with all connected users.

While a rebuild is running, all connected clients show a "building" status banner. When the rebuild completes, all clients automatically reload the fresh index — no page reload required.

The index covers:
- The current world's asset folder (always)
- The active game system
- All active modules (single toggle)
- The global `assets/` folder
- Other worlds and custom root folders (opt-in)
- Font Awesome Free icons (opt-in, ~1,970 icons)

### Auto-Tagging

Every indexed file is automatically tagged based on its path segments, filename (split on separators and camelCase), source type, and media category. Noise words are excluded. Auto-tags power search and the filter panel without any manual work.

### User Tags

Right-click any file to open its context menu and add custom tags. Tags are stored in the index and persist across rebuilds. You can add as many tags as you like per file.

### Favorites

Right-click any folder to add it to your Favorites list, which appears at the top of the sidebar for one-click navigation. Favorites are stored per-user as Foundry user flags and persist across sessions and devices.

Right-click a favorite in the sidebar to rename or remove it.

### Detail Panel

Selecting a file opens a detail panel on the right showing:
- A preview (image, video player, audio player)
- File path, type, dimensions or duration
- Auto-tags and user-defined tags
- Quick-copy buttons for URL, CSS class, and filename

### Drag to Canvas

Drag any image from the browser onto the canvas to place it as a Tile. The tile size defaults to the current scene's grid size.

### Upload

GMs can upload files directly from the toolbar. Uploaded files are immediately added to the index without requiring a full rebuild.

### Detached Window

GMs can pop the browser out into a separate, resizable OS window using the toolbar button. Useful on multi-monitor setups. The default open behavior (attached or detached) is configurable per-GM in module settings.

---

## Player Access

When **Enable for Players** is turned on in module settings, non-GM players get access to the Asset Vault file picker. A GM must also configure which folder paths players are allowed to browse by opening **Player Access** in module settings and adding the specific paths.

Players can navigate through parent folders to reach their allowed paths, but cannot browse or search outside them.

---

## Settings

| Setting | Scope | Description |
|---|---|---|
| Use Default File Picker | World (GM) | Disable Asset Vault and fall back to Foundry's built-in picker |
| Default View Mode | World (GM) | Initial view mode (grid or list) when the browser opens |
| Detached Window | Per user | Open the Hub in a detached window by default |
| Show Auto-Generated Tags | World (GM) | Show auto-tags alongside user tags in the browser |
| Enable for Players | World (GM) | Allow non-GM players to use Asset Vault |
| Scan Locations | World (GM) | Configure which folders are indexed |
| Player Access | World (GM) | Folder paths players are permitted to browse and search |

---

## Scan Locations

Open **Scan Locations** in module settings to control what gets indexed:

- **Current World** — always included, cannot be disabled
- **Systems** — index your game system's assets (active system is pre-checked)
- **Modules** — a single toggle indexes all currently active modules
- **Global Assets** — the top-level `assets/` folder
- **Font Awesome Icons** — makes all Font Awesome Free icons searchable by name and keywords
- **Other Worlds** — opt-in to index assets from other worlds on the same server
- **Other Root Folders** — any custom top-level folders detected on your server

After changing scan locations, click **Save** to persist the configuration, or **Rebuild Index** to scan immediately with the new settings.

---

## Localization

Asset Vault ships with full English and Swedish translations. Additional languages can be contributed by adding a language file under `languages/` and registering it in `module.json`.

---

## Compatibility

- **Foundry VTT**: v13 and above
- **Game systems**: system-agnostic
- **No dependencies**: no other modules required

---

## Author

Mattias Jöraas
