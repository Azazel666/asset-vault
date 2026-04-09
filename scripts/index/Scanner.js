const { FilePicker } = foundry.applications.apps;

export const SUPPORTED_EXTENSIONS = new Set([
  // image
  ".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg",
  // video
  ".mp4", ".webm",
  // audio
  ".mp3", ".ogg", ".wav", ".flac",
  // pdf
  ".pdf"
]);

/**
 * Recursively scans directories via FilePicker.browse() and collects
 * all files whose extensions are in SUPPORTED_EXTENSIONS.
 *
 * Inaccessible or missing directories are skipped with a console warning.
 */
export class Scanner {
  /** @type {(dirsScanned: number, currentPath: string) => void} */
  #onProgress;

  /** @param {{ onProgress?: (dirsScanned: number, currentPath: string) => void }} [options] */
  constructor({ onProgress } = {}) {
    this.#onProgress = onProgress ?? (() => {});
  }

  /**
   * Scan an array of locations and return a flat list of discovered files.
   * @param {Array<{path: string, sourceKey: string}>} locations
   * @returns {Promise<Array<{filePath: string, sourceKey: string}>>}
   */
  async scan(locations) {
    const results = [];
    let dirsScanned = 0;

    for (const { path, sourceKey } of locations) {
      await this.#scanDir(path, sourceKey, results, (currentDir) => {
        dirsScanned++;
        this.#onProgress(dirsScanned, currentDir);
      });
    }

    return results;
  }

  async #scanDir(path, sourceKey, results, onDir = () => {}) {
    let browseResult;
    try {
      browseResult = await FilePicker.browse("data", path);
    } catch {
      // Directory doesn't exist or is inaccessible — skip silently
      return;
    }

    onDir(path);

    for (const filePath of browseResult.files) {
      const ext = filePath.toLowerCase().match(/(\.[^./]+)$/)?.[1];
      if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
        results.push({ filePath, sourceKey });
      }
    }

    for (const dir of browseResult.dirs) {
      await this.#scanDir(dir, sourceKey, results, onDir);
    }
  }
}
