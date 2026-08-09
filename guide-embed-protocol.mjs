const freezeList = (values) => Object.freeze([...values]);

export const PROTOCOL_VERSION = 1;
export const EMBED_QUERY = "guide";
export const PROFILES = freezeList(["fr3", "fr5"]);
export const VIEWS = freezeList(["home", "front", "right", "back", "left"]);
export const GUIDE_SAMPLE_IDS = freezeList(["p2-to-p7"]);
export const GUIDE_COMMANDS = freezeList([
  "move_to",
  "move_down",
  "move_up",
  "grip",
  "release",
  "get_positions",
]);
export const EVENT_TYPES = freezeList([
  "guide:ready",
  "guide:state",
  "guide:running",
  "guide:command",
  "guide:step",
  "guide:complete",
  "guide:error",
  "guide:reset",
  "guide:snapshot",
]);
const POSITIONS = freezeList(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
const MAX_SNAPSHOT_BYTES = 2_000_000;

const SAMPLE_STEPS = Object.freeze([
  Object.freeze({ command: "move_to", position: "P2", source: "P2", target: "P2" }),
  Object.freeze({ command: "move_down", source: "P2", target: "P2" }),
  Object.freeze({ command: "grip", source: "P2", target: "P2" }),
  Object.freeze({ command: "move_up", source: "P2", target: "P2" }),
  Object.freeze({ command: "move_to", position: "P7", source: "P2", target: "P7" }),
  Object.freeze({ command: "move_down", source: "P2", target: "P7" }),
  Object.freeze({ command: "release", source: "P2", target: "P7" }),
  Object.freeze({ command: "move_up", source: "P2", target: "P7" }),
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isGuideEmbedUrl(input) {
  try {
    if (typeof input !== "string" || /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(input)) return false;
    const url = new URL(input, "https://guide.invalid");
    if (!url.pathname || !["/", "/index.html"].includes(url.pathname)) return false;
    return url.searchParams.get("embed") === EMBED_QUERY;
  } catch {
    return false;
  }
}

export function getGuideSampleSteps(sampleId) {
  if (!GUIDE_SAMPLE_IDS.includes(sampleId)) return null;
  return SAMPLE_STEPS.map((step) => ({ ...step }));
}

export function createGuideCommandMessage(command, position) {
  if (!GUIDE_COMMANDS.includes(command)) return null;
  if (command === "move_to") {
    if (!POSITIONS.includes(position)) return null;
    return { protocol: PROTOCOL_VERSION, type: "guide:run-command", command, position };
  }
  if (position !== undefined) return null;
  return { protocol: PROTOCOL_VERSION, type: "guide:run-command", command };
}

function validateCommandMessage(message) {
  if (message.command === "move_to") {
    if (!hasOnlyKeys(message, ["protocol", "type", "command", "position"])) return null;
    return createGuideCommandMessage(message.command, message.position);
  }
  if (!hasOnlyKeys(message, ["protocol", "type", "command"])) return null;
  return createGuideCommandMessage(message.command);
}

export function validateParentMessage(message) {
  if (!isRecord(message) || message.protocol !== PROTOCOL_VERSION || typeof message.type !== "string") {
    return null;
  }
  switch (message.type) {
    case "guide:init":
      return hasOnlyKeys(message, ["protocol", "type", "source"]) && message.source === "project-guide"
        ? { protocol: PROTOCOL_VERSION, type: message.type, source: message.source }
        : null;
    case "guide:set-profile":
      return hasOnlyKeys(message, ["protocol", "type", "profile"]) && PROFILES.includes(message.profile)
        ? { protocol: PROTOCOL_VERSION, type: message.type, profile: message.profile }
        : null;
    case "guide:set-view":
      return hasOnlyKeys(message, ["protocol", "type", "view"]) && VIEWS.includes(message.view)
        ? { protocol: PROTOCOL_VERSION, type: message.type, view: message.view }
        : null;
    case "guide:set-zoom":
      return hasOnlyKeys(message, ["protocol", "type", "value"]) && Number.isFinite(message.value) && message.value >= 100 && message.value <= 200
        ? { protocol: PROTOCOL_VERSION, type: message.type, value: Number(message.value) }
        : null;
    case "guide:run-sample":
      return hasOnlyKeys(message, ["protocol", "type", "sampleId"]) && GUIDE_SAMPLE_IDS.includes(message.sampleId)
        ? { protocol: PROTOCOL_VERSION, type: message.type, sampleId: message.sampleId }
        : null;
    case "guide:run-command":
      return validateCommandMessage(message);
    case "guide:stop":
    case "guide:reset":
      return hasOnlyKeys(message, ["protocol", "type"]) ? { protocol: PROTOCOL_VERSION, type: message.type } : null;
    case "guide:capture":
      return hasOnlyKeys(message, ["protocol", "type", "view"]) && VIEWS.includes(message.view)
        ? { protocol: PROTOCOL_VERSION, type: message.type, view: message.view }
        : null;
    default:
      return null;
  }
}

export function isTrustedEmbedMessage(event, expectedOrigin, expectedSource) {
  return Boolean(
    event &&
      typeof event.origin === "string" &&
      event.origin === expectedOrigin &&
      event.source === expectedSource,
  );
}

export function validateEmbedEvent(event) {
  if (!isRecord(event) || event.protocol !== PROTOCOL_VERSION || !EVENT_TYPES.includes(event.type)) {
    return null;
  }
  return { protocol: PROTOCOL_VERSION, type: event.type };
}

export function isSnapshotPayloadAllowed(value) {
  if (typeof value !== "string") return false;
  if (typeof TextEncoder === "undefined") return value.length <= MAX_SNAPSHOT_BYTES;
  return new TextEncoder().encode(value).byteLength <= MAX_SNAPSHOT_BYTES;
}

export function isAllowedGuideCommand(command, position) {
  return Boolean(createGuideCommandMessage(command, position));
}

export const GUIDE_SNAPSHOT_MAX_BYTES = MAX_SNAPSHOT_BYTES;

export function createEmbedStorage({ storage = globalThis.localStorage, embed = false } = {}) {
  if (!embed) return storage;
  const memory = new Map();
  return {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(String(key));
    },
    clear() {
      memory.clear();
    },
  };
}
