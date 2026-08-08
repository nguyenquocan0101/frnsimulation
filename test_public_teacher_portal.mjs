import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { initTeacherPortal } from "./teacher-submissions.mjs";

const html = readFileSync(new URL("./teacher.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./teacher.css", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("./teacher-submissions.mjs", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.className = "";
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
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

async function withFakeDom(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = new FakeDocument();
  try {
    return await callback();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function treeHasLiteral(node, value) {
  if (!node) return false;
  if (node.textContent === value) return true;
  return node.children?.some((child) => treeHasLiteral(child, value)) ?? false;
}

test("teacher entry is public and has no auth/account/expiry controls", () => {
  assert.doesNotMatch(html, /signInTeacher|resolveTeacherRedirect|firebase\/auth|teacherSignInBtn/i);
  assert.doesNotMatch(html, /Đăng nhập|Chưa đăng nhập|Đăng xuất|token|hết hạn|expiry/i);
  assert.match(html, /id=["']teacherPublicStatus["']/);
  assert.match(html, /Workshop công khai/i);
});

test("public page exposes refresh, filter, table, empty/error, and preview selectors", () => {
  for (const id of [
    "teacherRefreshBtn",
    "teacherFilter",
    "submissionTable",
    "submissionEmpty",
    "submissionError",
    "previewDialog",
    "previewCode",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /aria-live=["']polite["']/);
  assert.match(html, /Xem trước/);
});

test("public submissions table uses the exact desktop column order", () => {
  const headers = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/gi)].map((match) => match[1].trim());
  assert.deepEqual(headers, ["STT", "Tên nhóm", "Tên file", "Nộp lúc", "Thao tác"]);
});

test("teacher rendering never assigns untrusted submission content as HTML", () => {
  assert.doesNotMatch(moduleSource, /\.innerHTML\s*=/, "submission values must use text nodes");
  assert.match(moduleSource, /textContent\s*=/);
  assert.match(moduleSource, /createElement\(/);
});

test("portal automatically loads one public snapshot on entry", async () => {
  await withFakeDom(async () => {
    const statusNode = new FakeElement("output");
    const rowsNode = new FakeElement("tbody");
    const filterInput = new FakeElement("input");
    const refreshButton = new FakeElement("button");
    let listCalls = 0;
    const controller = initTeacherPortal({
      list: async () => {
        listCalls += 1;
        return [{
          groupName: "RobotX",
          groupKey: "robotx",
          filename: "TechX_RobotX.py",
          submittedAt: new Date("2026-08-08T10:00:00Z"),
          source: "print('safe')\n",
        }];
      },
      statusNode,
      rowsNode,
      filterInput,
      refreshButton,
    });

    assert.ok(controller, "portal controller should initialize without a sign-in callback");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(listCalls, 1);
    assert.equal(statusNode.dataset.status, "ready");
    assert.match(statusNode.textContent, /1/);
    assert.equal(rowsNode.children.length, 1);
  });
});

test("untrusted group, filename, and source are rendered as literal text", async () => {
  await withFakeDom(async () => {
    const statusNode = new FakeElement("output");
    const rowsNode = new FakeElement("tbody");
    const filterInput = new FakeElement("input");
    const refreshButton = new FakeElement("button");
    const controller = initTeacherPortal({
      list: async () => [{
        groupName: "<img src=x onerror=alert(1)>",
        groupKey: "unsafe",
        filename: "<script>alert(1)</script>",
        source: "<b>print('literal')</b>",
      }],
      statusNode,
      rowsNode,
      filterInput,
      refreshButton,
    });
    assert.ok(controller);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rendered = rowsNode.children[0];
    assert.ok(rendered);
    assert.equal(treeHasLiteral(rendered, "<img src=x onerror=alert(1)>"), true);
    assert.equal(treeHasLiteral(rendered, "<script>alert(1)</script>"), true);
  });
});

test("responsive contract keeps desktop table and stacks rows below 640px without horizontal overflow", () => {
  assert.match(css, /\.submission-table/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /overflow-x\s*:\s*(?:hidden|auto)/);
  assert.match(css, /submission-card|submission-row/);
  assert.match(css, /min-height\s*:\s*44px/);
});

test("loading, ready, empty, and error state selectors have accessible copy", () => {
  for (const state of ["loading", "ready", "empty", "error"]) {
    assert.match(html, new RegExp(`data-status=["']${state}["']|data-state=["']${state}["']`));
  }
  assert.match(html, /aria-live=["']polite["']/);
  assert.match(html, /aria-label=["'][^"']*(?:Làm mới|refresh)[^"']*["']/i);
});
