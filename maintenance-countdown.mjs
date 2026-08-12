export function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function startMaintenanceCountdown({
  output,
  reopenAt,
  now = () => Date.now(),
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  reopen = () => window.location.reload(),
}) {
  if (!output || !Number.isFinite(reopenAt)) return () => {};

  let timerId = null;
  const update = () => {
    const remainingMs = reopenAt - now();
    output.textContent = formatCountdown(remainingMs);
    if (remainingMs <= 0) {
      reopen();
      return;
    }
    timerId = schedule(update, Math.min(1000, remainingMs));
  };

  update();
  return () => {
    if (timerId !== null) window.clearTimeout(timerId);
  };
}

if (typeof window !== "undefined" && window.FR5_MAINTENANCE_MODE === true) {
  startMaintenanceCountdown({
    output: document.getElementById("maintenanceCountdown"),
    reopenAt: Number(window.FR5_MAINTENANCE_REOPEN_AT),
  });
}
