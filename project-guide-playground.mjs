import {
  createGuideCommandMessage,
  isAllowedGuideCommand,
  isSnapshotPayloadAllowed,
  isTrustedEmbedMessage,
  validateEmbedEvent,
} from "./guide-embed-protocol.mjs";

const ORIGIN = window.location.origin;
const VIEW_NAMES = ["home", "front", "right", "back", "left"];

function loadPlaygroundStyles() {
  if (document.querySelector('link[data-playground-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/project-guide-playground.css";
  link.dataset.playgroundStyles = "true";
  document.head.append(link);
}

function text(node, value) {
  if (node) node.textContent = String(value ?? "");
}

export function initProjectGuidePlayground(root = document) {
  const card = root.querySelector("[data-playground='project-guide-playground']");
  if (!card) return { destroy() {} };
  loadPlaygroundStyles();
  const preload = card.querySelector("[data-playground-preload]");
  const openButton = card.querySelector("[data-playground-open]");
  const toolbar = card.querySelector("[data-playground-toolbar]");
  const viewport = card.querySelector("[data-playground-viewport]");
  const fallback = card.querySelector("[data-playground-fallback]");
  const status = card.querySelector("#playground-status");
  const log = card.querySelector("[data-playground-step-log]");
  const snapshots = card.querySelector("[data-playground-snapshots]");
  const profile = card.querySelector("[data-playground-profile]");
  const zoom = card.querySelector("[data-playground-zoom]");
  const zoomOutput = card.querySelector("[data-playground-zoom-output]");
  const retry = card.querySelector("[data-playground-retry]");
  let iframe = null;
  let readyTimer = null;
  let messageHandler = null;
  let lastTrigger = null;
  let selectedView = "home";
  let sampleRunning = false;
  let destroyed = false;

  const setStatus = (value) => text(status, value);
  const send = (message) => {
    if (!iframe?.contentWindow || destroyed) return false;
    iframe.contentWindow.postMessage(message, ORIGIN);
    return true;
  };
  const clearTimer = () => {
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    readyTimer = null;
  };
  const showFallback = (message = "Unable to load the 3D simulator.") => {
    clearTimer();
    if (fallback) fallback.hidden = false;
    setStatus(message);
  };
  const appendStep = (value) => {
    if (!log) return;
    const item = document.createElement("li");
    item.textContent = value;
    log.append(item);
  };
  const setBusy = (busy) => {
    sampleRunning = Boolean(busy);
    card.querySelectorAll("[data-playground-action]").forEach((button) => {
      const action = button.dataset.playgroundAction;
      button.disabled = sampleRunning && action !== "stop";
    });
  };
  const handleEvent = (event) => {
    if (!event.origin || !event.source) return; // reject missing origin/source
    if (event.origin !== ORIGIN || event.source !== iframe?.contentWindow) return;
    if (!iframe || !isTrustedEmbedMessage(event, ORIGIN, iframe.contentWindow)) return;
    const valid = validateEmbedEvent(event.data);
    if (!valid) return;
    const payload = event.data;
    if (payload.type === "guide:ready") {
      clearTimer();
      if (toolbar) toolbar.hidden = false;
      if (preload) preload.hidden = true;
      setStatus("Simulator ready.");
    } else if (payload.type === "guide:state") {
      if (profile && payload.profile) profile.value = payload.profile;
      setStatus(`Robot ${payload.profile || "FR3"} · View ${payload.view || "Home"} · Zoom ${payload.zoom || 100}%`);
    } else if (payload.type === "guide:running") {
      setBusy(true);
      setStatus("Running example…");
    } else if (payload.type === "guide:step") {
      appendStep(payload.label || payload.command || `Step ${payload.index ?? ""}`);
      setStatus(payload.label || "Executing a step.");
    } else if (payload.type === "guide:command") {
      appendStep(payload.message || payload.command || "Command completed.");
      setStatus(payload.message || "Command completed.");
    } else if (payload.type === "guide:complete") {
      setBusy(false);
      setStatus("Example complete.");
    } else if (payload.type === "guide:reset") {
      if (log) log.replaceChildren();
      snapshots?.replaceChildren();
      setBusy(false);
      setStatus("Simulator reset.");
    } else if (payload.type === "guide:error") {
      setBusy(false);
      setStatus(payload.message || "The command could not be completed.");
    } else if (payload.type === "guide:snapshot") {
      const view = String(payload.view || "").toLowerCase();
      if (!VIEW_NAMES.includes(view) || !isSnapshotPayloadAllowed(payload.dataUrl)) {
        setStatus("The snapshot is invalid or too large.");
        return;
      }
      const viewLabel = view[0].toUpperCase() + view.slice(1);
      snapshots?.querySelector(`[data-view="${view}"]`)?.remove();
      const figure = document.createElement("figure");
      figure.dataset.view = view;
      const image = document.createElement("img");
      const caption = document.createElement("figcaption");
      image.alt = `${viewLabel} view snapshot`;
      image.src = payload.dataUrl;
      caption.textContent = `${viewLabel} view`;
      figure.append(image, caption);
      snapshots?.append(figure);
    }
  };

  function destroyIframe() {
    clearTimer();
    if (messageHandler) window.removeEventListener("message", messageHandler);
    messageHandler = null;
    iframe?.remove();
    iframe = null;
  }

  const readyTimeoutMs = 5000;
  function createGuideIframe() {
    if (iframe) return iframe;
    iframe = document.createElement("iframe");
    iframe.id = "project-guide-embed";
    iframe.title = "FAIRINO TechX Camp 3D simulator";
    iframe.src = "/?embed=guide";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.dataset.embed = "guide";
    iframe.dataset.guide = "true";
    iframe.dataset.storage = "memory-isolated";
    viewport?.append(iframe);
    messageHandler = handleEvent;
    window.addEventListener("message", messageHandler);
    iframe.addEventListener("load", () => send({ protocol: 1, type: "guide:init", source: "project-guide" }));
    readyTimer = window.setTimeout((readyTimeout) => showFallback("The simulator is not ready yet. Try again."), readyTimeoutMs);
    return iframe;
  }

  function open() {
    if (fallback) fallback.hidden = true;
    createGuideIframe();
    send({ protocol: 1, type: "guide:init", source: "project-guide" });
    setStatus("Loading the 3D simulator…");
    openButton?.focus();
  }

  openButton?.addEventListener("click", open);
  retry?.addEventListener("click", () => {
    destroyIframe();
    open();
  });
  profile?.addEventListener("change", () => send({ protocol: 1, type: "guide:set-profile", profile: profile.value }));
  zoom?.addEventListener("input", () => {
    text(zoomOutput, `${zoom.value}%`);
    send({ protocol: 1, type: "guide:set-zoom", value: Number(zoom.value) });
  });
  card.querySelectorAll("[data-playground-view]").forEach((button) => button.addEventListener("click", () => {
    selectedView = button.dataset.playgroundView || "home";
    send({ protocol: 1, type: "guide:set-view", view: selectedView });
  }));
  card.querySelectorAll("[data-playground-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.playgroundAction;
    if (!iframe?.contentWindow) {
      setStatus("Open the 3D simulator first.");
      return;
    }
    if (sampleRunning && action !== "stop") {
      setStatus("Stop the current example first.");
      return;
    }
    if (action === "run-sample") setBusy(true);
    if (action === "stop") setBusy(false);
    const payload = action === "run-sample"
      ? { sampleId: "p2-to-p7" }
      : action === "capture"
        ? { view: selectedView }
        : {};
    send({ protocol: 1, type: `guide:${action === "run-sample" ? "run-sample" : action}`, ...payload });
  }));
  card.querySelectorAll("[data-guide-command]").forEach((button) => button.addEventListener("click", () => {
    if (sampleRunning) {
      setStatus("Stop the current example first.");
      return;
    }
    if (!iframe?.contentWindow) {
      setStatus("Open the 3D simulator first.");
      return;
    }
    const command = button.dataset.guideCommand;
    const point = card.querySelector("[data-command-point]")?.value || "P1";
    if (!isAllowedGuideCommand(command, point)) return setStatus("This command is not included in the lesson cards.");
    lastTrigger = button;
    const message = createGuideCommandMessage(command, point);
    send({ protocol: 1, type: "guide:run-command", ...message });
  }));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const target = event.target.closest?.("button");
      if (target && target.dataset.playgroundAction) target.click();
    }
  });

  return {
    open,
    destroy() {
      destroyed = true;
      destroyIframe();
      lastTrigger?.focus?.();
    },
  };
}

if (typeof document !== "undefined") {
  const boot = () => initProjectGuidePlayground(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
