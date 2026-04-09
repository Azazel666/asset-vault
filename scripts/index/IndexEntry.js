/**
 * @typedef {Object} IndexEntry
 * @property {string}   path       - Full file path relative to Data/
 * @property {string}   name       - Filename without directory path
 * @property {string}   type       - File type: "image"|"video"|"audio"|"pdf"|"other"
 * @property {string}   source     - Source identifier: "world:current", "module:<id>", "system:<id>", "assets", "folder:<name>"
 * @property {string[]} autoTags   - Auto-generated tags derived from path and filename
 * @property {string[]} userTags   - User-defined tags
 * @property {number}   indexedAt  - Unix timestamp (ms) of when this entry was indexed
 * @property {Object}   [meta]     - Optional metadata: { width, height, size, duration }
 */

/**
 * Create a new IndexEntry with safe defaults.
 * @param {string} path
 * @param {Partial<IndexEntry>} overrides
 * @returns {IndexEntry}
 */
export function createEntry(path, overrides = {}) {
  return {
    path,
    name: decodeURIComponent(path.split("/").pop()),
    type: "other",
    source: "",
    autoTags: [],
    userTags: [],
    indexedAt: Date.now(),
    ...overrides
  };
}

/**
 * Derive the type category from a file path.
 * @param {string} path
 * @returns {IndexEntry["type"]}
 */
export function typeFromPath(path) {
  if (foundry.helpers.media.ImageHelper.hasImageExtension(path)) return "image";
  if (foundry.helpers.media.VideoHelper.hasVideoExtension(path)) return "video";
  if (foundry.audio.AudioHelper.hasAudioExtension(path)) return "audio";
  if (path.toLowerCase().endsWith(".pdf")) return "pdf";
  return "other";
}
