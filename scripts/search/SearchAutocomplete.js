/**
 * Inline autocomplete dropdown for the Asset Vault search bar.
 *
 * Lifecycle: created once per hub instance, persists across re-renders.
 * The <ul> element is appended directly to the hub window element and
 * survives Handlebars partial re-renders.  Call attach() each _onRender
 * to re-bind listeners to the fresh <input> element.
 */

const OPERATORS  = ["type", "tag", "source", "ext"];
const TYPE_VALUES = ["image", "video", "audio", "pdf"];

export class SearchAutocomplete {
  /* --- persistent state -------------------------------------------- */
  #getInput;              // () => HTMLInputElement|null
  #onOperatorComplete;    // (key, value) => void
  #onFreeTextChange;      // debounced (text) => void  (provided by hub)

  #dropdown;              // <ul> — lives in hubEl, survives re-renders
  #items     = [];        // Array<{label, insertText, keepOpen}>
  #activeIdx = -1;
  #visible   = false;

  /* --- per-render state (re-bound on each attach) ------------------- */
  #attachedInput = null;
  #boundKeyDown  = null;
  #boundInput    = null;
  #boundClick    = null;
  #boundMousedown = null;

  /* ------------------------------------------------------------------ */

  constructor(hubElement, getInputFn, onOperatorComplete, onFreeTextChange) {
    this.#getInput           = getInputFn;
    this.#onOperatorComplete = onOperatorComplete;
    this.#onFreeTextChange   = onFreeTextChange;

    // Create the dropdown element once; it lives for the hub lifetime
    this.#dropdown = document.createElement("ul");
    this.#dropdown.className = "av-autocomplete";
    this.#dropdown.setAttribute("hidden", "");
    this.#dropdown.setAttribute("role", "listbox");
    hubElement.appendChild(this.#dropdown);

    // Delegated click on list items — use mousedown to fire before blur
    this.#dropdown.addEventListener("mousedown", e => {
      const li = e.target.closest(".av-autocomplete-item");
      if (!li) return;
      e.preventDefault(); // keep input focused
      const idx = parseInt(li.dataset.idx, 10);
      const input = this.#getInput();
      if (input && !isNaN(idx)) this.#applySelection(this.#items[idx], input);
    });

    // Click-outside to dismiss
    this.#boundMousedown = e => {
      if (!this.#visible) return;
      const wrapper = this.#getInput()?.closest(".av-search");
      if (!this.#dropdown.contains(e.target) && !(wrapper?.contains(e.target))) {
        this.hide();
      }
    };
    document.addEventListener("mousedown", this.#boundMousedown);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Re-attach to the freshly-rendered input element.
   * Called from AssetVaultHub._onRender every time the template re-renders.
   * @param {HTMLInputElement} inputEl
   */
  attach(inputEl) {
    // Remove listeners from the previous input (now detached from DOM)
    if (this.#attachedInput && this.#attachedInput !== inputEl) {
      this.#attachedInput.removeEventListener("keydown", this.#boundKeyDown);
      this.#attachedInput.removeEventListener("input",   this.#boundInput);
      this.#attachedInput.removeEventListener("click",   this.#boundClick);
    }
    this.#attachedInput = inputEl;

    this.#boundKeyDown = e  => this.#onKeyDown(e);
    this.#boundInput   = e  => {
      this.#onFreeTextChange(e.target.value);
      this.#update(inputEl);
    };
    this.#boundClick   = () => this.#update(inputEl);

    inputEl.addEventListener("keydown", this.#boundKeyDown);
    inputEl.addEventListener("input",   this.#boundInput);
    inputEl.addEventListener("click",   this.#boundClick);

    this.#reposition(inputEl);
    this.#update(inputEl);
  }

  /** Hide the dropdown without selecting anything. */
  hide() {
    this.#visible   = false;
    this.#activeIdx = -1;
    this.#dropdown.setAttribute("hidden", "");
  }

  /** Remove dropdown from DOM and clean up all listeners. */
  destroy() {
    if (this.#attachedInput) {
      this.#attachedInput.removeEventListener("keydown", this.#boundKeyDown);
      this.#attachedInput.removeEventListener("input",   this.#boundInput);
      this.#attachedInput.removeEventListener("click",   this.#boundClick);
    }
    document.removeEventListener("mousedown", this.#boundMousedown);
    this.#dropdown.remove();
  }

  /* ------------------------------------------------------------------ */
  /*  Fragment parser                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Determine if the cursor is inside an unclosed [...] and what has been
   * typed so far.
   * @param {string} value  Full input value
   * @param {number} cursorPos
   * @returns {{ bracketStart:number, phase:"key"|"value", key:string|null, valuePrefix:string }|null}
   */
  #parseFragment(value, cursorPos) {
    const before   = value.slice(0, cursorPos);
    const lastOpen = before.lastIndexOf("[");
    if (lastOpen === -1) return null;

    const afterOpen = value.slice(lastOpen + 1, cursorPos);
    if (afterOpen.includes("]")) return null; // already closed

    const colonIdx = afterOpen.indexOf(":");
    if (colonIdx === -1) {
      // Still typing the operator key
      return { bracketStart: lastOpen, phase: "key", key: null, valuePrefix: afterOpen };
    }
    const key         = afterOpen.slice(0, colonIdx).trim().toLowerCase();
    const valuePrefix = afterOpen.slice(colonIdx + 1);
    return { bracketStart: lastOpen, phase: "value", key, valuePrefix };
  }

  /* ------------------------------------------------------------------ */
  /*  Suggestion builders                                                */
  /* ------------------------------------------------------------------ */

  #buildSuggestions(frag) {
    if (frag.phase === "key") {
      const p = frag.valuePrefix.toLowerCase();
      return OPERATORS
        .filter(op => op.startsWith(p))
        .map(op => ({ label: op, insertText: op + ":", keepOpen: true }));
    }
    switch (frag.key) {
      case "type":   return this.#typeSuggestions(frag.valuePrefix);
      case "tag":    return this.#tagSuggestions(frag.valuePrefix);
      case "source": return this.#sourceSuggestions(frag.valuePrefix);
      case "ext":    return this.#extSuggestions(frag.valuePrefix);
      default:       return []; // unknown operator — no suggestions
    }
  }

  #typeSuggestions(partial) {
    const p = partial.toLowerCase();
    return TYPE_VALUES
      .filter(t => t.startsWith(p))
      .map(t => ({ label: t, insertText: t, keepOpen: false }));
  }

  #tagSuggestions(partial) {
    const index = game.assetVault?.index;
    if (index?.status !== "ready") return [];
    const freq = new Map();
    for (const entry of index.getEntries()) {
      for (const tag of [...entry.autoTags, ...entry.userTags]) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    const p = partial.toLowerCase();
    return [...freq.entries()]
      .filter(([tag]) => tag.includes(p))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => ({ label: tag, insertText: tag, keepOpen: false }));
  }

  #sourceSuggestions(partial) {
    const index = game.assetVault?.index;
    if (index?.status !== "ready") return [];
    const sources = [...new Set(index.getEntries().map(e => e.source))].sort();
    const p = partial.toLowerCase();
    return sources
      .filter(s => s.toLowerCase().includes(p))
      .slice(0, 50)
      .map(s => ({ label: s, insertText: s, keepOpen: false }));
  }

  #extSuggestions(partial) {
    const index = game.assetVault?.index;
    if (index?.status !== "ready") return [];
    const exts = [...new Set(
      index.getEntries()
        .map(e => e.path.split(".").pop()?.toLowerCase())
        .filter(Boolean)
    )].sort();
    const p = partial.toLowerCase();
    return exts
      .filter(x => x.startsWith(p))
      .map(x => ({ label: x, insertText: x, keepOpen: false }));
  }

  /* ------------------------------------------------------------------ */
  /*  Dropdown rendering                                                 */
  /* ------------------------------------------------------------------ */

  #update(inputEl) {
    const cursor = inputEl.selectionStart ?? 0;
    const frag   = this.#parseFragment(inputEl.value, cursor);
    if (!frag) { this.hide(); return; }

    const suggestions = this.#buildSuggestions(frag);
    if (suggestions.length === 0) { this.hide(); return; }

    this.#items     = suggestions;
    this.#activeIdx = -1;
    this.#renderList();
    this.#reposition(inputEl);
  }

  #renderList() {
    this.#dropdown.innerHTML = this.#items
      .map((item, i) =>
        `<li class="av-autocomplete-item" role="option" data-idx="${i}">${item.label}</li>`
      )
      .join("");
    this.#dropdown.removeAttribute("hidden");
    this.#visible = true;
  }

  #highlightActive() {
    this.#dropdown.querySelectorAll(".av-autocomplete-item").forEach((li, i) => {
      li.classList.toggle("av-autocomplete-item--active", i === this.#activeIdx);
    });
    if (this.#activeIdx >= 0) {
      this.#dropdown.children[this.#activeIdx]?.scrollIntoView({ block: "nearest" });
    }
  }

  #reposition(inputEl) {
    const wrapper = inputEl.closest(".av-search");
    if (!wrapper) return;
    const rowRect = wrapper.getBoundingClientRect();
    this.#dropdown.style.top   = `${rowRect.bottom + 4}px`;
    this.#dropdown.style.left  = `${rowRect.left}px`;
    this.#dropdown.style.width = `${rowRect.width}px`;
  }

  /* ------------------------------------------------------------------ */
  /*  Selection                                                          */
  /* ------------------------------------------------------------------ */

  #applySelection(item, inputEl) {
    const val    = inputEl.value;
    const cursor = inputEl.selectionStart ?? 0;
    const frag   = this.#parseFragment(val, cursor);
    if (!frag) return;

    const before = val.slice(0, frag.bracketStart);
    const after  = val.slice(cursor);

    if (frag.phase === "key") {
      // Complete the key, leave bracket open for value entry
      const newInner  = "[" + item.insertText;
      const newValue  = before + newInner + after;
      const newCursor = before.length + newInner.length;
      inputEl.value = newValue;
      inputEl.setSelectionRange(newCursor, newCursor);
      // Re-evaluate to immediately show value suggestions
      this.#update(inputEl);
    } else {
      // Complete the value — remove fragment from input, create chip
      const newValue  = (before + after.replace(/^\s*/, "")).trim();
      const newCursor = before.length;
      inputEl.value = newValue;
      inputEl.setSelectionRange(newCursor, newCursor);
      this.hide();
      this.#onOperatorComplete(frag.key, item.insertText);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  #onKeyDown(e) {
    if (!this.#visible) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.#activeIdx = Math.min(this.#activeIdx + 1, this.#items.length - 1);
        this.#highlightActive();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.#activeIdx = Math.max(this.#activeIdx - 1, -1);
        this.#highlightActive();
        break;
      case "Enter":
      case "Tab":
        if (this.#activeIdx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          const input = this.#getInput();
          if (input) this.#applySelection(this.#items[this.#activeIdx], input);
        }
        break;
      case "Escape":
        e.preventDefault();
        this.hide();
        break;
    }
  }
}
