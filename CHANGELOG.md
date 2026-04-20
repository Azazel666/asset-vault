# Changelog

## 1.1.0 — 2026-04-20

### New features

- **Image zoom/pan viewer** — image previews in the detail panel now support interactive viewing: scroll wheel zooms in/out centered on the cursor, click-drag pans, double-click resets to fit-in-panel
- **Drag-and-drop upload** — the content area is now a drop zone; drag one or more files from your OS onto the browser to upload them directly to the current folder (same as the toolbar upload button, but supports multi-file drops)
- **Pre-select current file on picker open** — when the picker is opened from a field that already has a value (e.g. actor portrait), the browser now navigates to the correct folder, scrolls to the file, highlights it, and shows it in the detail panel automatically
- **Thumbnail shrink-to-fit** — grid and list thumbnails now scale to fit within their cell instead of cropping; no part of an image is hidden

### Bug fixes

- Fixed a scroll glitch in grid view where an item would jump from one row to another when scrolling slowly (VirtualScroller row height was estimated before the browser had completed layout; it is now measured from actual rendered elements)
- Fixed scroll overshoot when the picker opens with a pre-selected file deep in the list (items-per-row was computed before the container had a real width; `scrollToIndex` now re-measures from the DOM at call time)
- Fixed image viewer not responding to zoom/pan when a file was pre-selected on picker open (viewer was only wired through the click path, not the initial template render path)
- Fixed image viewer bounds allowing the image to be panned fully out of view against the top/left edges

---

## 1.0.0 — 2026-04-12

First feature-complete release. Asset Vault is a media asset browser for Foundry VTT that replaces the built-in FilePicker with a searchable, taggable hub for managing all media assets across a Foundry installation.

### Core features

- **Asset Hub** — full-screen browser with browse and search modes, grid and list views, and a resizable detail panel for previewing images, video, and audio
- **Full-text fuzzy search** — searches filenames, tags, and source paths using uFuzzy; structured operators (`type:`, `tag:`, `source:`, `ext:`) combine with free text; results update as you type
- **Filter panel** — collapsible sidebar facets for file type, source, and top tags; clicking a facet adds it as a search chip
- **Background indexing** — GM login triggers a background rebuild; all connected clients show a live status banner and automatically reload the fresh index when the rebuild completes
- **Auto-tagging** — every indexed file is tagged from its path, filename, source type, and media category without any manual setup
- **User tags** — right-click any file to add custom tags; tags persist across index rebuilds
- **Favorites** — right-click any folder to bookmark it; favorites appear at the top of the sidebar and persist per-user via Foundry user flags
- **Drag to canvas** — drag any image onto the canvas to place it as a Tile at the current scene's grid size
- **Upload** — GMs can upload files directly from the toolbar; new files are indexed immediately
- **Detached window** — pop the browser into a separate resizable OS window; default behavior is configurable per GM
- **Player access** — GMs can enable the browser for players and configure which specific folder paths each player is permitted to browse and search
- **Scan Locations config** — per-world configuration for which systems, modules, worlds, and root folders are included in the index; Font Awesome Free icons (~1,970) can be indexed as a searchable icon library
- **Localization** — full English and Swedish translations
