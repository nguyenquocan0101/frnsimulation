import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html", "utf8");
const config = fs.readFileSync("maintenance-config.js", "utf8");
const css = fs.readFileSync("maintenance.css", "utf8");
const countdown = fs.readFileSync("maintenance-countdown.mjs", "utf8");

test("lunch maintenance expires automatically at 13:30 Vietnam time", () => {
  assert.match(config, /2026-08-12T13:30:00\+07:00/);
  assert.match(config, /Date\.now\(\)\s*<\s*LUNCH_REOPEN_AT/);
  assert.match(config, /FR5_MAINTENANCE_REOPEN_AT/);
  assert.match(config, /!isLocalDevelopment\s*&&\s*Date\.now\(\)\s*<\s*LUNCH_REOPEN_AT/);
  assert.match(index, /maintenance-config\.js/);
});

test("maintenance screen comments out the old notice and shows the lunch message", () => {
  assert.match(index, /<!-- Previous maintenance notice[\s\S]*Hệ thống đang tạm thời đóng cửa[\s\S]*-->/);
  assert.match(index, /Mình thật sự rất vui khi thấy mọi người sử dụng/);
  assert.match(index, /Hẹn gặp mọi người vào ngày mai và chúc các bạn ngủ ngoannnn/);
  assert.match(index, /Nghỉ trưa đi mấy đứa/);
  assert.match(index, /class="maintenance-screen"[\s\S]{0,100}lang="vi"/);
  assert.match(index, /id="maintenanceCountdown"/);
  assert.match(index, /role="timer"[\s\S]{0,100}aria-label="Thời gian còn lại đến 13 giờ 30"/);
  assert.match(index, /Thử mở lại ngay/);
});

test("countdown updates once per second and reloads at zero", async () => {
  const { formatCountdown, startMaintenanceCountdown } = await import(
    "./maintenance-countdown.mjs"
  );
  assert.equal(formatCountdown(5_400_000), "01:30:00");
  assert.equal(formatCountdown(-1), "00:00:00");

  const output = { textContent: "" };
  let currentTime = 1_000;
  let scheduledUpdate;
  let reloads = 0;
  startMaintenanceCountdown({
    output,
    reopenAt: 2_500,
    now: () => currentTime,
    schedule: (callback) => {
      scheduledUpdate = callback;
      return 1;
    },
    reopen: () => {
      reloads += 1;
    },
  });
  assert.equal(output.textContent, "00:00:02");
  currentTime = 2_500;
  scheduledUpdate();
  assert.equal(output.textContent, "00:00:00");
  assert.equal(reloads, 1);
  assert.match(countdown, /window\.location\.reload/);
});

test("maintenance gate skips app and OCCT bootstrap when enabled", () => {
  assert.match(index, /if \(window\.FR5_MAINTENANCE_MODE !== true\)/);
  assert.match(index, /await import\("\.\/app\.js"\)/);
  assert.match(index, /if \(!maintenanceEnabled\)/);
  assert.match(index, /maintenance-countdown\.mjs/);
  assert.match(css, /html\[data-maintenance="true"\] \.app-shell/);
});

test("maintenance screen uses responsive IDE styling", () => {
  assert.match(index, /maintenance\.css/);
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /min-height:100dvh/);
  assert.match(css, /font-variant-numeric:tabular-nums/);
});
