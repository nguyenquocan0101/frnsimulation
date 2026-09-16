import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { initTeacherPortal } from "./teacher-submissions.mjs";

const html = readFileSync(new URL("./teacher.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./teacher.css", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("./teacher-submissions.mjs", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");

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

function treeFind(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const match = treeFind(child, predicate);
    if (match) return match;
  }
  return null;
}

test("teacher entry is public and has no auth/account/expiry controls", () => {
  assert.doesNotMatch(html, /signInTeacher|resolveTeacherRedirect|teacherSignInBtn/i);
  assert.doesNotMatch(html, /Sign in|Signed out|Sign out|token|expired|expiry/i);
  assert.match(html, /id=["']teacherPublicStatus["']/);
  assert.match(html, /Public workshop/i);
});

test("teacher shortcut requires four logo clicks and password 0909", () => {
  assert.match(appSource, /clicks === 4/);
  assert.match(appSource, /password\.value === "0909"/);
  assert.doesNotMatch(appSource, /090909|stemtechx/);
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
  assert.match(html, /preview/i);
  assert.match(html, /Source SHA-256/);
  assert.match(html, /This controls the physical robot/);
});

test("public submissions table uses the exact desktop column order", () => {
  const submissionsTable = html.match(/<table[^>]*id=["']submissionTable["'][\s\S]*?<\/table>/i)?.[0] ?? "";
  const headers = [...submissionsTable.matchAll(/<th[^>]*>([^<]+)<\/th>/gi)].map((match) => match[1].trim());
  assert.deepEqual(headers, ["No.", "Group", "File", "Submitted", "Actions"]);
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

test("teacher dispatches the selected submission to the selected real robot", async () => {
  await withFakeDom(async () => {
    const statusNode = new FakeElement("output");
    const rowsNode = new FakeElement("tbody");
    const filterInput = new FakeElement("input");
    const refreshButton = new FakeElement("button");
    const calls = { create: null, confirm: null, grade: 0 };
    const controller = initTeacherPortal({
      list: async () => [{
        id: "submission-1234567890",
        groupName: "RobotX",
        source: "from techcamp_api import TechCamp\n",
        model: { status: "present", size: 12 },
      }],
      listModels: async () => ({ models: [{ submissionId: "submission-1234567890", size: 12 }] }),
      listJobs: async () => ({ jobs: [] }),
      statusNode,
      rowsNode,
      filterInput,
      refreshButton,
      grade: async () => { calls.grade += 1; return { ok: true, score: 100, steps: 1 }; },
      createRealJob: async (payload) => { calls.create = payload; return { jobId: "job-1234567890", status: "queued" }; },
      confirmRealJob: async (jobId) => { calls.confirm = jobId; return { jobId, status: "queued" }; },
      getAgentStatus: async () => ({ online: true }),
      getJob: async () => ({ jobId: "job-1234567890", status: "succeeded", logs: [{ message: "cleanup complete" }] }),
      confirmRun: async () => true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const rendered = rowsNode.children[0];
    const select = treeFind(rendered, (node) => node.tagName === "select");
    const runButton = treeFind(rendered, (node) => node.className.includes("real-run-button"));
    assert.ok(select);
    assert.ok(runButton);
    select.value = "FR3";
    await runButton.emit("click");
    assert.equal(calls.create.submissionId, "submission-1234567890");
    assert.equal(calls.create.source, "from techcamp_api import TechCamp\n");
    assert.equal(calls.create.robotModel, "FR3");
    assert.equal(calls.create.modelAvailable, true);
    assert.equal(calls.confirm, "job-1234567890");
    assert.match(rendered.children[4].children.find((node) => node.className === "runtime-status").textContent, /succeeded/);
    controller.dispose();
  });
});

test("teacher does not create a physical job while the Local Agent is offline", async () => {
  await withFakeDom(async () => {
    const statusNode = new FakeElement("output");
    const rowsNode = new FakeElement("tbody");
    const filterInput = new FakeElement("input");
    const refreshButton = new FakeElement("button");
    let createCalls = 0;
    const controller = initTeacherPortal({
      list: async () => [{ id: "submission-1234567890", groupName: "RobotX", source: "print('safe')\n" }],
      listJobs: async () => ({ jobs: [] }),
      statusNode,
      rowsNode,
      filterInput,
      refreshButton,
      listModels: async () => ({ models: [] }),
      createRealJob: async () => { createCalls += 1; return { jobId: "job-1234567890" }; },
      confirmRealJob: async () => { throw new Error("must not confirm"); },
      getAgentStatus: async () => ({ online: false }),
      confirmRun: async () => true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const rendered = rowsNode.children[0];
    const runButton = treeFind(rendered, (node) => node.className.includes("real-run-button"));
    assert.ok(runButton);
    await runButton.emit("click");
    assert.equal(createCalls, 0);
    assert.match(rendered.children[4].children.find((node) => node.className === "runtime-status").textContent, /offline/);
    controller.dispose();
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
