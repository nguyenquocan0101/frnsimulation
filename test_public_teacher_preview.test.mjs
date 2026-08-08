import test from "node:test";
import assert from "node:assert/strict";

import { initTeacherPortal } from "./teacher-submissions.mjs";

const activeControllers = new Set();

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.textContent = "";
    this.className = "";
    this.type = "";
    this.clicked = false;
    this.focused = false;
    this.attributes = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type, event = { target: this }) {
    const handlers = this.listeners.get(type) ?? [];
    return Promise.all(handlers.map((handler) => handler(event)));
  }

  click() {
    this.clicked = true;
    if (this.throwOnClick) throw new Error("click failed");
    return this.emit("click", { target: this, currentTarget: this });
  }

  focus() {
    this.focused = true;
    if (globalThis.document) globalThis.document.activeElement = this;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  querySelector(selector) {
    const normalized = String(selector).replace(/^[.#]/, "");
    if (this.tagName === normalized || this.className.split(/\s+/).includes(normalized)) return this;
    for (const child of this.children) {
      const match = child.querySelector?.(selector);
      if (match) return match;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  dispatchEvent(event) {
    return this.emit(event.type, event);
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("document");
    this.activeElement = null;
    this.lastAnchor = null;
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    if (tagName === "a") {
      this.lastAnchor = element;
      element.throwOnClick = this.throwOnAnchorClick === true;
    }
    return element;
  }
}

async function withFakeDom(callback) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;
  globalThis.window = fakeDocument;
  try {
    return await callback(fakeDocument);
  } finally {
    for (const controller of activeControllers) controller?.dispose?.();
    activeControllers.clear();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function createHarness(options = {}) {
  const statusNode = new FakeElement("output");
  const rowsNode = new FakeElement("tbody");
  const filterInput = new FakeElement("input");
  const refreshButton = new FakeElement("button");
  const previewDialog = new FakeElement("dialog");
  const previewCode = new FakeElement("code");
  const previewMeta = new FakeElement("p");
  const previewCloseButton = new FakeElement("button");
  previewDialog.append(previewMeta, previewCode, previewCloseButton);
  const controller = initTeacherPortal({
    list: options.list ?? (async () => []),
    download: options.download,
    statusNode,
    rowsNode,
    filterInput,
    refreshButton,
    previewDialog,
    previewCode,
    previewMeta,
    previewCloseButton,
    emptyNode: new FakeElement("p"),
    errorNode: new FakeElement("p"),
  });
  activeControllers.add(controller);
  return {
    statusNode,
    rowsNode,
    filterInput,
    refreshButton,
    previewDialog,
    previewCode,
    previewMeta,
    previewCloseButton,
    controller,
  };
}

const oneRow = {
  id: "submission-1",
  groupName: "RobotX",
  groupKey: "robotx",
  filename: "TechX_RobotX.py",
  source: "# exact source\nprint('hello')\n",
  submittedAt: new Date("2026-08-08T10:00:00.000Z"),
};

test("preview opens exact source and metadata without another list call", async () => {
  await withFakeDom(async () => {
    let listCalls = 0;
    const harness = createHarness({
      list: async () => {
        listCalls += 1;
        return [oneRow];
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const previewButton = harness.rowsNode.children[0]?.querySelector("preview-button");
    assert.ok(previewButton, "row should expose a preview action");
    await previewButton.emit("click", { target: previewButton });
    assert.equal(listCalls, 1);
    assert.equal(harness.previewDialog.open, true);
    assert.equal(harness.previewCode.textContent, oneRow.source);
    assert.match(harness.previewMeta.textContent, /TechX_RobotX\.py/);
    assert.match(harness.previewMeta.textContent, /RobotX/);
  });
});

test("preview closes from close button, Escape, and backdrop and restores trigger focus", async () => {
  await withFakeDom(async (document) => {
    const harness = createHarness({ list: async () => [oneRow] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = harness.rowsNode.children[0].querySelector("preview-button");
    await trigger.emit("click", { target: trigger });
    assert.equal(harness.previewDialog.open, true);

    await harness.previewCloseButton.emit("click", { target: harness.previewCloseButton });
    assert.equal(harness.previewDialog.open, false);
    assert.equal(document.activeElement, trigger);

    await trigger.emit("click", { target: trigger });
    await document.emit("keydown", { key: "Escape", target: document });
    assert.equal(harness.previewDialog.open, false);
    assert.equal(document.activeElement, trigger);

    await trigger.emit("click", { target: trigger });
    await harness.previewDialog.emit("click", { target: harness.previewDialog });
    assert.equal(harness.previewDialog.open, false);
    assert.equal(document.activeElement, trigger);
  });
});

test("missing source shows a safe unavailable preview and never calls download with undefined", async () => {
  await withFakeDom(async () => {
    let downloadCalls = 0;
    const harness = createHarness({
      list: async () => [{ ...oneRow, source: undefined }],
      download: async () => { downloadCalls += 1; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const previewButton = harness.rowsNode.children[0].querySelector("preview-button");
    await previewButton.emit("click", { target: previewButton });
    assert.equal(harness.previewDialog.open, true);
    assert.match(harness.previewCode.textContent, /không khả dụng|unavailable/i);
    const downloadButton = harness.rowsNode.children[0].querySelector("download-button");
    await downloadButton.emit("click", { target: downloadButton });
    assert.equal(downloadCalls, 0);
  });
});

test("download preserves exact source bytes, canonical filename, one click, and URL cleanup", async () => {
  await withFakeDom(async (document) => {
    const source = oneRow.source;
    const revoked = [];
    const previousURL = globalThis.URL;
    globalThis.URL = {
      createObjectURL(blob) {
        assert.equal(blob.type, "text/x-python;charset=utf-8");
        assert.equal(blob.size, new Blob([source]).size);
        return "blob:teacher-source";
      },
      revokeObjectURL(url) { revoked.push(url); },
    };
    try {
      let downloadArgs;
      const harness = createHarness({
        list: async () => [oneRow],
        download: async (receivedSource, filename) => {
          downloadArgs = [receivedSource, filename];
          return new Blob([receivedSource], { type: "text/x-python;charset=utf-8" });
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const downloadButton = harness.rowsNode.children[0].querySelector("download-button");
      await downloadButton.emit("click", { target: downloadButton });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(downloadArgs, [source, "TechX_RobotX.py"]);
      assert.equal(document.lastAnchor.href, "blob:teacher-source");
      assert.equal(document.lastAnchor.download, "TechX_RobotX.py");
      assert.equal(document.lastAnchor.clicked, true);
      assert.deepEqual(revoked, ["blob:teacher-source"]);
    } finally {
      globalThis.URL = previousURL;
    }
  });
});

test("download revokes object URL even when the browser click fails", async () => {
  await withFakeDom(async (document) => {
    document.throwOnAnchorClick = true;
    const revoked = [];
    const previousURL = globalThis.URL;
    globalThis.URL = {
      createObjectURL() { return "blob:failed-click"; },
      revokeObjectURL(url) { revoked.push(url); },
    };
    try {
      const harness = createHarness({
        list: async () => [oneRow],
        download: async (source) => new Blob([source], { type: "text/x-python;charset=utf-8" }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const downloadButton = harness.rowsNode.children[0].querySelector("download-button");
      await downloadButton.emit("click", { target: downloadButton });
      assert.deepEqual(revoked, ["blob:failed-click"]);
      assert.equal(harness.statusNode.dataset.status, "error");
    } finally {
      globalThis.URL = previousURL;
    }
  });
});

test("filter is case-insensitive, preserves order, and clearing restores all loaded rows", async () => {
  await withFakeDom(async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      ...oneRow,
      id: `submission-${index}`,
      groupName: index === 41 ? "RobotX" : `Nhom${index}`,
      groupKey: index === 41 ? "robotx" : `nhom${index}`,
    }));
    const harness = createHarness({ list: async () => rows });
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.filterInput.value = "  ROBOTX ";
    await harness.filterInput.emit("input", { target: harness.filterInput });
    assert.equal(harness.rowsNode.children.length, 1);
    assert.equal(harness.rowsNode.children[0].dataset.submissionId, "submission-41");
    harness.filterInput.value = "";
    await harness.filterInput.emit("input", { target: harness.filterInput });
    assert.equal(harness.rowsNode.children.length, 100);
    assert.equal(harness.controller.rows.length, 100);
  });
});

test("refresh failure preserves previous rows and retry replaces snapshot", async () => {
  await withFakeDom(async () => {
    let shouldFail = false;
    let nextRows = [oneRow];
    const replacement = { ...oneRow, id: "submission-2", groupName: "Nhom2" };
    const harness = createHarness({
      list: async () => {
        if (shouldFail) throw new Error("temporary unavailable");
        return nextRows;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    shouldFail = true;
    await harness.controller.refresh();
    assert.equal(harness.statusNode.dataset.status, "error");
    assert.equal(harness.rowsNode.children.length, 1);
    shouldFail = false;
    nextRows = [replacement];
    await harness.controller.refresh();
    assert.equal(harness.rowsNode.children[0].querySelector("strong").textContent, "Nhom2");
  });
});

test("pending refresh disables only the refresh control and keeps filtering available", async () => {
  await withFakeDom(async () => {
    let resolveList;
    const harness = createHarness({
      list: () => new Promise((resolve) => { resolveList = resolve; }),
    });
    await Promise.resolve();
    assert.equal(harness.refreshButton.disabled, true);
    assert.equal(harness.filterInput.disabled, false);
    resolveList([oneRow]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(harness.refreshButton.disabled, false);
  });
});

test("polling uses one three-second timer, skips overlap, and is cleared on dispose", async () => {
  await withFakeDom(async () => {
    const previousSetInterval = globalThis.setInterval;
    const previousClearInterval = globalThis.clearInterval;
    const timers = [];
    const cleared = [];
    globalThis.setInterval = (handler, delay) => {
      timers.push({ handler, delay });
      return timers.length;
    };
    globalThis.clearInterval = (id) => cleared.push(id);
    try {
      let resolvePending;
      let listCalls = 0;
      const harness = createHarness({
        list: () => {
          listCalls += 1;
          if (listCalls === 1) return Promise.resolve([oneRow]);
          return new Promise((resolve) => { resolvePending = resolve; });
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(timers.length, 1);
      assert.equal(timers[0].delay, 3000);
      const poll = timers[0].handler;
      const firstPoll = poll();
      const secondPoll = poll();
      await Promise.resolve();
      assert.equal(listCalls, 2, "overlapping poll must not issue another query");
      resolvePending([oneRow]);
      await Promise.all([firstPoll, secondPoll]);
      assert.equal(typeof harness.controller.dispose, "function");
      harness.controller.dispose();
      assert.deepEqual(cleared, [1]);
    } finally {
      globalThis.setInterval = previousSetInterval;
      globalThis.clearInterval = previousClearInterval;
    }
  });
});
