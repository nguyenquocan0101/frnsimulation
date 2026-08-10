export const STICKERS = Object.freeze([
  { id: "sticker-01", label: "Sticker 1", src: "/assets/random-picker/sticker-01.webp" },
  { id: "sticker-02", label: "Sticker 2", src: "/assets/random-picker/sticker-02.webp" },
  { id: "sticker-03", label: "Sticker 3", src: "/assets/random-picker/sticker-03.webp" },
  { id: "sticker-04", label: "Sticker 4", src: "/assets/random-picker/sticker-04.webp" },
  { id: "sticker-05", label: "Sticker 5", src: "/assets/random-picker/sticker-05.webp" },
  { id: "sticker-06", label: "Sticker 6", src: "/assets/random-picker/sticker-06.webp" },
  { id: "sticker-07", label: "Sticker 7", src: "/assets/random-picker/sticker-07.webp" },
  { id: "sticker-08", label: "Sticker 8", src: "/assets/random-picker/sticker-08.webp" },
]);

export const STORAGE_KEY = "techx-random-picker-v1";
export const STORAGE_VERSION = 1;
export const SETTLE_DELAYS = Object.freeze([1050, 1400, 1750, 2100, 2450]);

export const sampleUnique = (items, count, random = Math.random) => {
  if (!Number.isInteger(count) || count < 1 || count >= items.length) throw new RangeError("count must be an integer between 1 and item length - 1");
  const pool = [...items];
  for (let index = 0; index < count; index += 1) {
    const value = Number(random());
    const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0;
    const choice = index + Math.floor(normalized * (pool.length - index));
    [pool[index], pool[choice]] = [pool[choice], pool[index]];
  }
  return pool.slice(0, count);
};

export const isValidStoredResult = (value, stickers = STICKERS) => {
  if (!value || typeof value !== "object" || value.version !== STORAGE_VERSION || !Array.isArray(value.ids) || value.ids.length !== 5) return false;
  const known = new Set(stickers.map((sticker) => sticker.id));
  return new Set(value.ids).size === 5 && value.ids.every((id) => typeof id === "string" && known.has(id));
};

export const formatResult = (stickers) => stickers.map((sticker, index) => `${index + 1}. ${sticker.label}`).join("\n");

const readyControls = Object.freeze({ spinDisabled: false, copyDisabled: true, resetDisabled: true, primaryLabel: "Spin" });
const completeControls = Object.freeze({ spinDisabled: false, copyDisabled: false, resetDisabled: false, primaryLabel: "Spin again" });
const spinningControls = Object.freeze({ spinDisabled: true, copyDisabled: true, resetDisabled: true, primaryLabel: "Spinning…" });

const browserScheduler = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
};

const nullAdapter = {
  setControls() {}, setBusy() {}, prepareDraw() {}, startDraw() {}, settleReel() {},
  renderResult() {}, clearResult() {}, setStatus() {}, fallbackCopy() { return false; },
};

export const createPickerController = ({
  stickers = STICKERS,
  random = Math.random,
  scheduler = browserScheduler,
  storage = null,
  clipboard = null,
  reducedMotion = () => false,
  adapter = nullAdapter,
} = {}) => {
  let selection = [];
  let spinning = false;
  let generation = 0;
  let frameId = null;
  let timerIds = [];

  const setReady = () => {
    adapter.setBusy(false);
    adapter.setControls(readyControls);
  };

  const persist = () => {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ids: selection.map((item) => item.id) })); } catch {}
  };

  const finish = () => {
    if (!spinning) return;
    spinning = false;
    frameId = null;
    timerIds = [];
    persist();
    adapter.renderResult(selection);
    adapter.setBusy(false);
    adapter.setControls(completeControls);
    adapter.setStatus("Draw complete. Five unique stickers are ready.");
  };

  const spin = () => {
    if (spinning) return false;
    selection = sampleUnique(stickers, 5, random);
    spinning = true;
    generation += 1;
    const activeGeneration = generation;
    adapter.setControls(spinningControls);
    adapter.setBusy(true);
    adapter.setStatus("Spinning five reels…");
    adapter.prepareDraw({ targets: selection, stickers });

    if (reducedMotion()) {
      selection.forEach((sticker, index) => adapter.settleReel(index, sticker));
      finish();
      return true;
    }

    frameId = scheduler.requestAnimationFrame(() => {
      frameId = null;
      if (!spinning || activeGeneration !== generation) return;
      adapter.startDraw();
      timerIds = SETTLE_DELAYS.map((delay, index) => scheduler.setTimeout(() => {
        if (!spinning || activeGeneration !== generation) return;
        adapter.settleReel(index, selection[index]);
        if (index === selection.length - 1) finish();
      }, delay));
    });
    return true;
  };

  const restore = () => {
    let parsed = null;
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (!saved) { adapter.clearResult(); setReady(); return false; }
      parsed = JSON.parse(saved);
    } catch {
      try { storage?.removeItem(STORAGE_KEY); } catch {}
      adapter.clearResult();
      setReady();
      return false;
    }
    if (!isValidStoredResult(parsed, stickers)) {
      try { storage?.removeItem(STORAGE_KEY); } catch {}
      adapter.clearResult();
      setReady();
      adapter.setStatus("Saved result was invalid. Ready for a new draw.");
      return false;
    }
    const byId = new Map(stickers.map((sticker) => [sticker.id, sticker]));
    selection = parsed.ids.map((id) => byId.get(id));
    adapter.renderResult(selection);
    adapter.setBusy(false);
    adapter.setControls(completeControls);
    adapter.setStatus("Previous result restored.");
    return true;
  };

  const copy = async () => {
    if (spinning || selection.length !== 5) return false;
    const text = formatResult(selection);
    try {
      if (clipboard?.writeText) await clipboard.writeText(text);
      else if (!adapter.fallbackCopy(text)) throw new Error("fallback unavailable");
      adapter.setStatus("Result copied.");
      return true;
    } catch {
      try {
        if (clipboard?.writeText && adapter.fallbackCopy(text)) {
          adapter.setStatus("Result copied.");
          return true;
        }
      } catch {}
      adapter.setStatus("Could not copy the result.");
      return false;
    }
  };

  const reset = () => {
    if (spinning) return false;
    selection = [];
    try { storage?.removeItem(STORAGE_KEY); } catch {}
    adapter.clearResult();
    setReady();
    adapter.setStatus("Reset complete. Ready to spin.");
    return true;
  };

  const abortDraw = () => {
    generation += 1;
    if (frameId !== null) scheduler.cancelAnimationFrame(frameId);
    timerIds.forEach((id) => scheduler.clearTimeout(id));
    frameId = null;
    timerIds = [];
    spinning = false;
    adapter.setBusy(false);
    adapter.setControls(selection.length === 5 ? completeControls : readyControls);
  };

  return {
    spin, restore, copy, reset, abortDraw,
    get isSpinning() { return spinning; },
  };
};

const createImage = (sticker) => {
  const image = document.createElement("img");
  image.src = sticker.src;
  image.alt = sticker.label;
  image.width = 360;
  image.height = 360;
  return image;
};

const createDomAdapter = () => {
  const group = document.querySelector("[data-reel-group]");
  const windows = [...document.querySelectorAll("[data-reel-window]")];
  const reels = [...document.querySelectorAll("[data-reel]")];
  const spinButton = document.querySelector("[data-spin]");
  const copyButton = document.querySelector("[data-copy]");
  const resetButton = document.querySelector("[data-reset]");
  const status = document.querySelector("[data-status]");
  const results = document.querySelector("[data-results]");

  const showPlaceholder = (windowNode) => {
    const placeholder = document.createElement("span");
    placeholder.className = "reel-placeholder";
    placeholder.textContent = "Ready";
    windowNode.replaceChildren(placeholder);
  };

  return {
    nodes: { spinButton, copyButton, resetButton },
    setControls(state) {
      spinButton.disabled = state.spinDisabled;
      copyButton.disabled = state.copyDisabled;
      resetButton.disabled = state.resetDisabled;
      spinButton.textContent = state.primaryLabel;
    },
    setBusy(value) { group.setAttribute("aria-busy", String(value)); },
    prepareDraw({ targets, stickers }) {
      windows.forEach((windowNode, index) => {
        const track = document.createElement("div");
        track.className = "reel-track";
        const sequence = [...stickers, ...stickers, targets[index]];
        sequence.forEach((sticker) => track.append(createImage(sticker)));
        windowNode.replaceChildren(track);
        reels[index].classList.remove("is-settled");
      });
      results.replaceChildren();
    },
    startDraw() { group.classList.add("is-spinning"); },
    settleReel(index, sticker) {
      windows[index].replaceChildren(createImage(sticker));
      reels[index].classList.add("is-settled");
      if (index === windows.length - 1) group.classList.remove("is-spinning");
    },
    renderResult(stickers) {
      stickers.forEach((sticker, index) => {
        windows[index].replaceChildren(createImage(sticker));
        reels[index].classList.add("is-settled");
      });
      results.replaceChildren(...stickers.map((sticker) => {
        const item = document.createElement("li");
        item.textContent = sticker.label;
        return item;
      }));
    },
    clearResult() {
      group.classList.remove("is-spinning");
      reels.forEach((reel) => reel.classList.remove("is-settled"));
      windows.forEach(showPlaceholder);
      results.replaceChildren();
    },
    setStatus(message) { status.textContent = message; },
    fallbackCopy(text) {
      try {
        const field = document.createElement("textarea");
        field.value = text;
        field.readOnly = true;
        field.className = "clipboard-field";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        return copied;
      } catch { return false; }
    },
  };
};

if (typeof document !== "undefined") {
  const adapter = createDomAdapter();
  let storage = null;
  try { storage = window.localStorage; } catch {}
  const controller = createPickerController({
    storage,
    clipboard: navigator.clipboard,
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    adapter,
  });
  adapter.nodes.spinButton.addEventListener("click", controller.spin);
  adapter.nodes.copyButton.addEventListener("click", controller.copy);
  adapter.nodes.resetButton.addEventListener("click", controller.reset);
  window.addEventListener("pagehide", controller.abortDraw, { once: true });
  controller.restore();
}
