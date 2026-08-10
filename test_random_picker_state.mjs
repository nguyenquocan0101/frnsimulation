import test from "node:test";
import assert from "node:assert/strict";

const modulePath = new URL("./random-picker.mjs", import.meta.url);

const makeScheduler = () => {
  let nextId = 1;
  const frames = [];
  const timers = [];
  const cleared = [];
  return {
    frames,
    timers,
    cleared,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) { cleared.push(id); },
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.push({ id, callback, delay });
      return id;
    },
    clearTimeout(id) { cleared.push(id); },
    runFrame() { frames.shift()?.callback(); },
    runTimerAt(delay) {
      const timer = timers.find((entry) => entry.delay === delay);
      assert.ok(timer, `expected a timer at ${delay} ms`);
      timer.callback();
    },
  };
};

const makeStorage = (initial = new Map()) => ({
  values: initial,
  writes: [],
  removals: [],
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) {
    this.writes.push({ key, value });
    this.values.set(key, value);
  },
  removeItem(key) {
    this.removals.push(key);
    this.values.delete(key);
  },
});

const makeAdapter = ({ fallbackCopy = () => false } = {}) => ({
  events: [],
  setControls(state) { this.events.push(["controls", state]); },
  setBusy(value) { this.events.push(["busy", value]); },
  prepareDraw(payload) { this.events.push(["prepare", payload]); },
  startDraw() { this.events.push(["start"]); },
  settleReel(index, sticker) { this.events.push(["settle", index, sticker.id]); },
  renderResult(stickers) { this.events.push(["result", stickers.map((item) => item.id)]); },
  clearResult() { this.events.push(["clear"]); },
  setStatus(message) { this.events.push(["status", message]); },
  fallbackCopy(text) {
    this.events.push(["fallback-copy", text]);
    return fallbackCopy(text);
  },
});

const ids = ["sticker-01", "sticker-02", "sticker-03", "sticker-04", "sticker-05"];

test("sampleUnique returns known unique manifest IDs for deterministic random values", async () => {
  const { STICKERS, sampleUnique } = await import(modulePath);
  const values = [0, 0, 0, 0, 0];
  const result = sampleUnique(STICKERS, 5, () => values.shift() ?? 0);
  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((item) => item.id)).size, 5);
  for (const item of result) assert.ok(STICKERS.some((sticker) => sticker.id === item.id));
  assert.deepEqual(result.map((item) => item.id), ids);
});

test("sampleUnique rejects invalid requested counts clearly", async () => {
  const { STICKERS, sampleUnique } = await import(modulePath);
  for (const count of [-1, 0, 8, 9, 2.5, "5"]) {
    assert.throws(() => sampleUnique(STICKERS, count), /count/i);
  }
});

test("stored results require current version and exactly five unique known IDs", async () => {
  const { STICKERS, STORAGE_VERSION, isValidStoredResult } = await import(modulePath);
  assert.equal(isValidStoredResult({ version: STORAGE_VERSION, ids }, STICKERS), true);
  for (const value of [
    null,
    "bad",
    { version: STORAGE_VERSION - 1, ids },
    { version: STORAGE_VERSION, ids: ids.slice(0, 4) },
    { version: STORAGE_VERSION, ids: [...ids.slice(0, 4), ids[0]] },
    { version: STORAGE_VERSION, ids: [...ids.slice(0, 4), "sticker-99"] },
  ]) assert.equal(isValidStoredResult(value, STICKERS), false);
});

test("formatResult creates a plain numbered left-to-right list", async () => {
  const { STICKERS, formatResult } = await import(modulePath);
  assert.equal(
    formatResult(STICKERS.slice(0, 5)),
    "1. Sticker 1\n2. Sticker 2\n3. Sticker 3\n4. Sticker 4\n5. Sticker 5",
  );
});

test("normal draw samples five final stickers up front, starts together, and settles on the required schedule", async () => {
  const { createPickerController, STORAGE_KEY } = await import(modulePath);
  const scheduler = makeScheduler();
  const storage = makeStorage();
  const adapter = makeAdapter();
  const controller = createPickerController({
    random: () => 0,
    scheduler,
    storage,
    clipboard: null,
    reducedMotion: () => false,
    adapter,
  });

  assert.equal(controller.spin(), true);
  const prepared = adapter.events.find(([type]) => type === "prepare")[1];
  assert.deepEqual(prepared.targets.map((item) => item.id), ids);
  assert.equal(new Set(prepared.targets.map((item) => item.id)).size, 5);
  assert.equal(storage.writes.length, 0, "an in-progress draw must never persist");
  assert.equal(scheduler.frames.length, 1, "all reels share one animation-frame start");
  assert.ok(adapter.events.some((event) => event[0] === "controls" && event[1].spinDisabled && event[1].copyDisabled && event[1].resetDisabled));
  assert.ok(adapter.events.some((event) => event[0] === "busy" && event[1] === true));

  scheduler.runFrame();
  assert.equal(adapter.events.filter(([type]) => type === "start").length, 1);
  assert.deepEqual(scheduler.timers.map(({ delay }) => delay), [1050, 1400, 1750, 2100, 2450]);

  for (const delay of [1050, 1400, 1750, 2100]) scheduler.runTimerAt(delay);
  assert.equal(storage.writes.length, 0, "only the fifth settle may persist");
  scheduler.runTimerAt(2450);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, STORAGE_KEY);
  assert.deepEqual(JSON.parse(storage.writes[0].value).ids, ids);
  assert.deepEqual(adapter.events.filter(([type]) => type === "settle").map((event) => event.slice(1)), ids.map((id, index) => [index, id]));
  assert.ok(adapter.events.some((event) => event[0] === "result" && event[1].join() === ids.join()));
  assert.ok(adapter.events.some((event) => event[0] === "busy" && event[1] === false));
  assert.deepEqual(adapter.events.filter(([type]) => type === "controls").at(-1)[1], {
    spinDisabled: false,
    copyDisabled: false,
    resetDisabled: false,
    primaryLabel: "Spin again",
  });
});

test("spin, copy, and reset requests are ignored while the single draw lifecycle is active", async () => {
  const { createPickerController } = await import(modulePath);
  const scheduler = makeScheduler();
  const storage = makeStorage();
  const adapter = makeAdapter();
  const controller = createPickerController({ random: () => 0, scheduler, storage, clipboard: null, reducedMotion: () => false, adapter });
  assert.equal(controller.spin(), true);
  assert.equal(controller.isSpinning, true);
  assert.equal(controller.spin(), false);
  assert.equal(await controller.copy(), false);
  assert.equal(controller.reset(), false);
  assert.equal(scheduler.frames.length, 1);
  assert.equal(storage.removals.length, 0);
});

test("restore renders valid order without animation and rejects malformed saved state", async () => {
  const { createPickerController, STORAGE_KEY, STORAGE_VERSION } = await import(modulePath);
  const validStorage = makeStorage(new Map([[STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ids })]]));
  const scheduler = makeScheduler();
  const adapter = makeAdapter();
  const controller = createPickerController({ scheduler, storage: validStorage, clipboard: null, reducedMotion: () => false, adapter });
  assert.equal(controller.restore(), true);
  assert.equal(scheduler.frames.length, 0);
  assert.deepEqual(adapter.events.find(([type]) => type === "result")[1], ids);
  assert.deepEqual(adapter.events.filter(([type]) => type === "controls").at(-1)[1], {
    spinDisabled: false,
    copyDisabled: false,
    resetDisabled: false,
    primaryLabel: "Spin again",
  });

  const badStorage = makeStorage(new Map([[STORAGE_KEY, "not json"]]));
  const badAdapter = makeAdapter();
  const badController = createPickerController({ scheduler: makeScheduler(), storage: badStorage, clipboard: null, reducedMotion: () => false, adapter: badAdapter });
  assert.equal(badController.restore(), false);
  assert.deepEqual(badStorage.removals, [STORAGE_KEY]);
  assert.ok(badAdapter.events.some(([type]) => type === "clear"));
});

test("storage exceptions never break restore, completed spin, or reset", async () => {
  const { createPickerController } = await import(modulePath);
  const throwingStorage = {
    getItem() { throw new Error("privacy"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("privacy"); },
  };
  const scheduler = makeScheduler();
  const adapter = makeAdapter();
  const controller = createPickerController({ random: () => 0, scheduler, storage: throwingStorage, clipboard: null, reducedMotion: () => true, adapter });
  assert.doesNotThrow(() => controller.restore());
  assert.doesNotThrow(() => controller.spin());
  assert.doesNotThrow(() => controller.reset());
});

test("copy uses numbered text, falls back safely, and reports selection failure without throwing", async () => {
  const { createPickerController, STORAGE_KEY, STORAGE_VERSION } = await import(modulePath);
  const initial = new Map([[STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ids })]]);
  const successAdapter = makeAdapter({ fallbackCopy: () => true });
  const success = createPickerController({ scheduler: makeScheduler(), storage: makeStorage(new Map(initial)), clipboard: null, reducedMotion: () => false, adapter: successAdapter });
  success.restore();
  assert.equal(await success.copy(), true);
  assert.match(successAdapter.events.find(([type]) => type === "fallback-copy")[1], /^1\. Sticker 1/m);
  assert.match(successAdapter.events.filter(([type]) => type === "status").at(-1)[1], /copied/i);

  const failureAdapter = makeAdapter({ fallbackCopy: () => false });
  const failure = createPickerController({
    scheduler: makeScheduler(),
    storage: makeStorage(new Map(initial)),
    clipboard: { writeText: async () => { throw new Error("denied"); } },
    reducedMotion: () => false,
    adapter: failureAdapter,
  });
  failure.restore();
  await assert.doesNotReject(() => failure.copy());
  assert.match(failureAdapter.events.filter(([type]) => type === "status").at(-1)[1], /could not|failed|unable/i);
});

test("reset clears only a completed result and internal abortDraw cancels pending teardown work", async () => {
  const { createPickerController, STORAGE_KEY, STORAGE_VERSION } = await import(modulePath);
  const storage = makeStorage(new Map([[STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ids })]]));
  const scheduler = makeScheduler();
  const adapter = makeAdapter();
  const controller = createPickerController({ random: () => 0, scheduler, storage, clipboard: null, reducedMotion: () => false, adapter });
  controller.restore();
  assert.equal(controller.reset(), true);
  assert.deepEqual(storage.removals, [STORAGE_KEY]);
  assert.ok(adapter.events.some(([type]) => type === "clear"));
  assert.deepEqual(adapter.events.filter(([type]) => type === "controls").at(-1)[1], {
    spinDisabled: false,
    copyDisabled: true,
    resetDisabled: true,
    primaryLabel: "Spin",
  });

  controller.spin();
  scheduler.runFrame();
  controller.abortDraw();
  assert.equal(controller.isSpinning, false);
  assert.equal(scheduler.cleared.length, 5);
});

test("reduced motion completes immediately with the same unique result contract", async () => {
  const { createPickerController } = await import(modulePath);
  const scheduler = makeScheduler();
  const storage = makeStorage();
  const adapter = makeAdapter();
  const controller = createPickerController({ random: () => 0, scheduler, storage, clipboard: null, reducedMotion: () => true, adapter });
  assert.equal(controller.spin(), true);
  assert.equal(controller.isSpinning, false);
  assert.equal(scheduler.frames.length, 0);
  assert.equal(scheduler.timers.length, 0);
  assert.deepEqual(adapter.events.find(([type]) => type === "result")[1], ids);
  assert.equal(storage.writes.length, 1);
});
