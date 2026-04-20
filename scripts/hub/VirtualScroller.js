/**
 * Lightweight virtual scroller for the Asset Vault content area.
 *
 * Items are rendered only for the visible viewport + a small buffer.
 * The items container's padding-top / padding-bottom simulates the full
 * scroll height so the native scrollbar looks correct.
 *
 * Works for both grid view (multi-column) and list view (single column).
 */

const BUFFER_ROWS = 2;
const GRID_ITEM_MIN_WIDTH = 120; // matches CSS minmax(120px, 1fr)
const GRID_ROW_HEIGHT = 160;     // px — thumbnail + label + gap (approximate)
const LIST_ROW_HEIGHT = 42;      // px — list row height

export class VirtualScroller {
  /** @type {HTMLElement} */   #container;
  /** @type {HTMLElement} */   #grid;
  /** @type {Array}       */   #items = [];
  /** @type {string}      */   #viewMode;
  /** @type {Function}    */   #renderItem;  // (item, index) => HTMLElement
  /** @type {Function}    */   #wireItems;   // (HTMLElement[]) => void

  #itemsPerRow = 1;
  #rowHeight = LIST_ROW_HEIGHT;
  #rowHeightCalibrated = false;

  #rafId = null;
  #scrollHandler;
  #resizeObserver;

  constructor({ container, grid, items, viewMode, renderItem, wireItems }) {
    this.#container = container;
    this.#grid      = grid;
    this.#items     = items;
    this.#viewMode  = viewMode;
    this.#renderItem = renderItem;
    this.#wireItems  = wireItems;

    this.#scrollHandler = () => {
      if (this.#rafId) return;
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = null;
        this.#render();
      });
    };

    container.addEventListener("scroll", this.#scrollHandler, { passive: true });

    this.#resizeObserver = new ResizeObserver(() => {
      this.#measure();
      this.#invalidate();
      this.#render();
    });
    this.#resizeObserver.observe(container);

    this.#measure();
    this.#render();
  }

  /** Tear down all listeners — call before discarding. */
  destroy() {
    this.#container.removeEventListener("scroll", this.#scrollHandler);
    this.#resizeObserver.disconnect();
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  /**
   * Replace the item list and reset scroll to top.
   * @param {Array}  items
   * @param {string} [viewMode]  — if provided, switches grid/list mode
   */
  update(items, viewMode) {
    this.#items = items;
    if (viewMode) this.#viewMode = viewMode;
    this.#container.scrollTop = 0;
    this.#measure();
    this.#invalidate();
    this.#render();
  }

  /**
   * Scroll so that the item at `index` is visible.
   * @param {number} index
   */
  scrollToIndex(index) {
    // Re-measure both itemsPerRow and rowHeight directly from the DOM at call time.
    // clientWidth may have been 0 when the scroller was first constructed (before
    // the browser completed layout), so we can't rely on the stored values.
    const availW = Math.max(1, this.#container.clientWidth - 16);
    if (this.#viewMode === "grid") {
      this.#itemsPerRow = Math.max(1, Math.floor(availW / GRID_ITEM_MIN_WIDTH));
      const firstItem = this.#grid.firstElementChild;
      if (firstItem) {
        const h = firstItem.getBoundingClientRect().height;
        const gap = parseFloat(getComputedStyle(this.#grid).rowGap) || 0;
        if (h > 0) this.#rowHeight = Math.round(h + gap);
      }
    }
    const row = Math.floor(index / this.#itemsPerRow);
    this.#container.scrollTop = row * this.#rowHeight;
  }

  /* -------------------------------------------- */
  /*  Private helpers                             */
  /* -------------------------------------------- */

  /** Recalculate items-per-row and row height from current container size. */
  #measure() {
    this.#rowHeightCalibrated = false;
    // Subtract 1rem (16px) for the container's left+right padding
    const availW = Math.max(1, this.#container.clientWidth - 16);
    if (this.#viewMode === "grid") {
      this.#itemsPerRow = Math.max(1, Math.floor(availW / GRID_ITEM_MIN_WIDTH));
      this.#rowHeight   = GRID_ROW_HEIGHT;
    } else {
      this.#itemsPerRow = 1;
      this.#rowHeight   = LIST_ROW_HEIGHT;
    }
  }

  /** Clear the cached render range so the next #render() always repaints. */
  #invalidate() {
    delete this.#grid.dataset.vsStart;
    delete this.#grid.dataset.vsEnd;
  }

  #render() {
    const scrollTop     = this.#container.scrollTop;
    const viewportH     = this.#container.clientHeight;
    const count         = this.#items.length;
    const totalRows     = Math.ceil(count / this.#itemsPerRow);

    const visStartRow   = Math.floor(scrollTop / this.#rowHeight);
    const visEndRow     = Math.ceil((scrollTop + viewportH) / this.#rowHeight);
    const startRow      = Math.max(0, visStartRow - BUFFER_ROWS);
    const endRow        = Math.min(totalRows - 1, visEndRow + BUFFER_ROWS);

    const startIdx = startRow * this.#itemsPerRow;
    const endIdx   = Math.min(count, (endRow + 1) * this.#itemsPerRow);

    // Skip DOM work if visible range hasn't changed
    const prevStart = this.#grid.dataset.vsStart;
    const prevEnd   = this.#grid.dataset.vsEnd;
    if (prevStart === String(startIdx) && prevEnd === String(endIdx)) return;

    this.#grid.dataset.vsStart = startIdx;
    this.#grid.dataset.vsEnd   = endIdx;

    // Padding simulates the full scroll height
    const padTop    = startRow * this.#rowHeight;
    const padBottom = Math.max(0, (totalRows - endRow - 1) * this.#rowHeight);
    this.#grid.style.paddingTop    = padTop    ? `${padTop}px`    : "";
    this.#grid.style.paddingBottom = padBottom ? `${padBottom}px` : "";

    // Rebuild only the visible slice
    const fragment = document.createDocumentFragment();
    const newEls   = [];
    for (let i = startIdx; i < endIdx; i++) {
      const el = this.#renderItem(this.#items[i], i);
      fragment.appendChild(el);
      newEls.push(el);
    }
    this.#grid.replaceChildren(fragment);
    this.#wireItems(newEls);

    // Calibrate row height from actual rendered items once per view/resize.
    // The hardcoded GRID_ROW_HEIGHT estimate can differ from the real height
    // (font size, Foundry theme, OS scaling), causing padTop jumps on slow scroll.
    if (this.#viewMode === "grid" && !this.#rowHeightCalibrated && newEls.length > 0) {
      this.#rowHeightCalibrated = true;
      const sample = newEls[0];
      requestAnimationFrame(() => {
        if (!sample.isConnected) return;
        const h = sample.getBoundingClientRect().height;
        if (h <= 0) return;
        const gap = parseFloat(getComputedStyle(this.#grid).rowGap) || 0;
        const measured = Math.round(h + gap);
        if (Math.abs(measured - this.#rowHeight) > 0.5) {
          this.#rowHeight = measured;
          this.#invalidate();
          this.#render();
        }
      });
    }
  }
}
