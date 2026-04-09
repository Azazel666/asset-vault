import { typeFromPath } from "./IndexEntry.js";

/**
 * Path-segment prefixes whose immediate child is a module/system/world id.
 * That id is already captured in the source key so we skip it as a tag.
 */
const ID_PARENTS = new Set(["modules", "systems", "worlds"]);

/**
 * Directory-level words that carry no tagging value.
 */
const NOISE_WORDS = new Set([
  "data", "modules", "systems", "worlds", "assets",
  "images", "image", "img", "src"
]);

/**
 * Derive a flat, deduplicated array of tags for one file.
 *
 * Tag sources (in order):
 *  1. Non-noise directory segments (skipping the id segment after modules/systems/worlds)
 *  2. Filename tokens (split on separators and camelCase)
 *  3. sourceKey as-is  (e.g. "module:pf2e", "world:current")
 *  4. File type category  (e.g. "image", "audio")
 *
 * All tags are lowercased and deduplicated.
 *
 * @param {string} filePath  - Full path relative to Data/ (forward slashes)
 * @param {string} sourceKey - Source identifier stored on the IndexEntry
 * @returns {string[]}
 */
export function generateTags(filePath, sourceKey) {
  const tags = new Set();

  const parts = filePath.split("/");
  const filename = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);

  // Determine the id-segment to suppress (it's already in sourceKey)
  let skipId = null;
  if (dirParts.length >= 2 && ID_PARENTS.has(dirParts[0].toLowerCase())) {
    skipId = dirParts[1].toLowerCase();
  }

  // 1. Directory segment tags
  for (const part of dirParts) {
    const lower = part.toLowerCase();
    if (!lower || NOISE_WORDS.has(lower)) continue;
    if (skipId && lower === skipId) continue;
    tags.add(lower);
  }

  // 2. Filename token tags (strip extension first)
  const stem = filename.replace(/\.[^.]+$/, "");
  for (const token of stemToTokens(stem)) {
    tags.add(token);  // stemToTokens already lowercases
  }

  // 3. Source tag
  if (sourceKey) tags.add(sourceKey);

  // 4. File type tag
  const type = typeFromPath(filePath);
  if (type && type !== "other") tags.add(type);

  return Array.from(tags);
}

/**
 * Convert a filename stem into a list of lowercase tag tokens.
 *
 * Two-phase approach:
 *  1. Split on explicit separators (-, _, ., space) → each piece is intentional
 *  2. Further split each piece on camelCase and letter↔digit boundaries
 *  3. Filter: all tokens need length ≥ 3 and must not be purely numeric.
 *     camelCase-derived short tokens (< 4 chars) additionally need a vowel —
 *     this drops gibberish fragments like "Qgl"/"Gst" from generated IDs
 *     while keeping real short words like "war", "elf", "orc".
 *
 * Examples:
 *   "QuMoQglP8V5GstPr-thumb" → ["thumb"]
 *   "GoblinWarrior"          → ["goblin", "warrior"]
 *   "goblin-warrior-01"      → ["goblin", "warrior"]
 *   "level2"                 → ["level"]
 *   "WarElf"                 → ["war", "elf"]
 *
 * @param {string} stem  - Filename without extension
 * @returns {string[]}
 */
function stemToTokens(stem) {
  const tokens = [];
  for (const piece of stem.split(/[-_.\s]+/).filter(Boolean)) {
    const subPieces = splitCamelAndDigit(piece);
    const fromCamelSplit = subPieces.length > 1;
    for (const sub of subPieces) {
      if (isUsefulToken(sub, fromCamelSplit)) tokens.push(sub.toLowerCase());
    }
  }
  return tokens;
}

/**
 * Split a string on camelCase and letter↔digit boundaries.
 * @param {string} str
 * @returns {string[]}
 */
function splitCamelAndDigit(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")          // fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")    // ABCDef → ABC Def
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")           // level2 → level 2
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")           // 2nd → 2 nd
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Returns true if a token is worth keeping as a tag.
 * @param {string} token
 * @param {boolean} fromCamelSplit - true when token came from camelCase/digit splitting
 * @returns {boolean}
 */
function isUsefulToken(token, fromCamelSplit = false) {
  if (token.length < 3) return false;
  if (/^\d+$/.test(token)) return false;
  // Short camelCase fragments with no vowels are generated-ID noise (Qgl, Gst, Pr…)
  // Real short words (war, elf, orc, npc) always contain at least one vowel.
  if (fromCamelSplit && token.length < 4 && !/[aeiou]/i.test(token)) return false;
  return true;
}
