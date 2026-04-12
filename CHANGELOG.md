# Changelog

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
