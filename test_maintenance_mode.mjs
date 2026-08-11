import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html", "utf8");
const config = fs.readFileSync("maintenance-config.js", "utf8");
const css = fs.readFileSync("maintenance.css", "utf8");

test("maintenance switch defaults on and is reversible in one file", () => {
  assert.match(config, /const MAINTENANCE_MODE\s*=\s*true/);
  assert.match(config, /const LOCAL_MAINTENANCE_MODE\s*=\s*false/);
  assert.match(config, /localHost/);
  assert.match(index, /maintenance-config\.js/);
});

test("maintenance screen contains the approved workshop notice", () => {
  assert.match(index, /Sau <span>00:00 tối nay<\/span>, hệ thống Simulation FR5/);
  assert.match(index, /Mình thật sự rất vui khi thấy mọi người sử dụng/);
  assert.match(index, /Hẹn gặp mọi người vào ngày mai và chúc các bạn ngủ ngoannnn/);
  assert.match(index, /Thử tải lại trang/);
});

test("maintenance gate skips app and OCCT bootstrap when enabled", () => {
  assert.match(index, /if \(window\.FR5_MAINTENANCE_MODE !== true\)/);
  assert.match(index, /await import\("\.\/app\.js"\)/);
  assert.match(index, /if \(!maintenanceEnabled\)/);
  assert.match(css, /html\[data-maintenance="true"\] \.app-shell/);
});

test("maintenance screen uses responsive IDE styling", () => {
  assert.match(index, /maintenance\.css/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /min-height:100dvh/);
});
