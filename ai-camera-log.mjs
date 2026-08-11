export const AI_CAMERA_LOG_CHANNEL = 'fairino-ai-camera-log:v1';
export const AI_CAMERA_LOG_TYPE = 'ai-camera:prediction';
export const AI_CAMERA_LOG_VERSION = 1;

const MAX_TEXT_LENGTH = 500;
const MAX_RESULT_LINES = 7;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g;
const INVALID_RECEIVER_TEXT = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeAiCameraLogText(value) {
  return String(value ?? '')
    .replace(UNSAFE_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
    .trim();
}

function isValidPayloadText(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MAX_TEXT_LENGTH
    && !INVALID_RECEIVER_TEXT.test(value);
}

export function validateAiCameraLogPayload(payload) {
  if (!isPlainObject(payload)) return false;
  const keys = Object.keys(payload).sort();
  if (keys.length !== 4 || keys.join('|') !== 'lines|summary|type|version') return false;
  if (payload.type !== AI_CAMERA_LOG_TYPE || payload.version !== AI_CAMERA_LOG_VERSION) return false;
  if (!isValidPayloadText(payload.summary)) return false;
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > MAX_RESULT_LINES) return false;
  return payload.lines.every(isValidPayloadText);
}

export function createAiCameraLogPublisher({ windowRef, BroadcastChannel: BroadcastChannelOverride } = {}) {
  const BroadcastChannelCtor = BroadcastChannelOverride ?? windowRef?.BroadcastChannel;
  let channel = null;
  let destroyed = false;

  if (typeof BroadcastChannelCtor === 'function') {
    try {
      channel = new BroadcastChannelCtor(AI_CAMERA_LOG_CHANNEL);
    } catch {
      channel = null;
    }
  }

  return {
    publish({ summary, lines } = {}) {
      if (destroyed || !channel) return false;
      const payload = {
        type: AI_CAMERA_LOG_TYPE,
        version: AI_CAMERA_LOG_VERSION,
        summary: normalizeAiCameraLogText(summary),
        lines: Array.isArray(lines)
          ? lines.slice(0, MAX_RESULT_LINES).map(normalizeAiCameraLogText)
          : [],
      };
      if (!validateAiCameraLogPayload(payload)) return false;
      try {
        channel.postMessage(payload);
        return true;
      } catch {
        return false;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        channel?.close?.();
      } catch {
        // Transport teardown must never break Camera teardown.
      }
      channel = null;
    },
  };
}

export function createAiCameraLogReceiver({
  windowRef,
  BroadcastChannel: BroadcastChannelOverride,
  onRender = () => {},
  now = () => Date.now(),
  setTimeout: setTimeoutRef = (callback, delay) => windowRef?.setTimeout?.(callback, delay),
  clearTimeout: clearTimeoutRef = (timer) => windowRef?.clearTimeout?.(timer),
  intervalMs = 3000,
} = {}) {
  const BroadcastChannelCtor = BroadcastChannelOverride ?? windowRef?.BroadcastChannel;
  let channel = null;
  let destroyed = false;
  let nextRenderAt = 0;
  let pendingPayload = null;
  let timer = null;

  const render = (payload, renderedAt = now()) => {
    if (destroyed) return;
    pendingPayload = null;
    nextRenderAt = renderedAt + intervalMs;
    try {
      onRender(payload);
    } catch {
      // A view failure must not break channel delivery or page event dispatch.
    }
  };

  const flushPending = () => {
    timer = null;
    if (destroyed || !pendingPayload) return;
    render(pendingPayload, now());
  };

  const schedule = () => {
    if (timer !== null || destroyed || !pendingPayload) return;
    const delay = Math.max(0, nextRenderAt - now());
    try {
      timer = setTimeoutRef(flushPending, delay);
    } catch {
      timer = null;
    }
  };

  const handleMessage = (event) => {
    if (destroyed || !validateAiCameraLogPayload(event?.data)) return;
    const receivedAt = now();
    if (receivedAt >= nextRenderAt && timer === null) {
      render(event.data, receivedAt);
      return;
    }
    pendingPayload = event.data;
    schedule();
  };

  if (typeof BroadcastChannelCtor === 'function') {
    try {
      channel = new BroadcastChannelCtor(AI_CAMERA_LOG_CHANNEL);
      if (typeof channel.addEventListener === 'function') channel.addEventListener('message', handleMessage);
      else channel.onmessage = handleMessage;
    } catch {
      channel = null;
    }
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pendingPayload = null;
      if (timer !== null) {
        try {
          clearTimeoutRef(timer);
        } catch {
          // Timer cleanup remains best-effort in unsupported environments.
        }
        timer = null;
      }
      try {
        if (typeof channel?.removeEventListener === 'function') channel.removeEventListener('message', handleMessage);
        else if (channel) channel.onmessage = null;
        channel?.close?.();
      } catch {
        // Receiver teardown must never break IDE page teardown.
      }
      channel = null;
    },
  };
}

export function renderAiCameraLog(consoleElement, payload) {
  if (!consoleElement || !validateAiCameraLogPayload(payload)) return null;
  let block = consoleElement.querySelector?.('.ai-camera-log-block') ?? null;
  if (!block) {
    const documentRef = consoleElement.ownerDocument;
    if (!documentRef?.createElement) return null;
    block = documentRef.createElement('span');
    block.className = 'ai-camera-log-block';
    consoleElement.appendChild(block);
  }
  block.textContent = [payload.summary, ...payload.lines].join('\n');
  consoleElement.scrollTop = consoleElement.scrollHeight;
  return block;
}

export function appendConsoleLogText(consoleElement, text) {
  if (!consoleElement) return null;
  const documentRef = consoleElement.ownerDocument;
  if (!documentRef?.createTextNode) return null;
  const textNode = documentRef.createTextNode(String(text));
  const block = consoleElement.querySelector?.('.ai-camera-log-block') ?? null;
  if (block) consoleElement.insertBefore(textNode, block);
  else consoleElement.appendChild(textNode);
  consoleElement.scrollTop = consoleElement.scrollHeight;
  return textNode;
}

export function createAiCameraLogLifecycle({ windowRef, isEmbedMode = false, createReceiver = () => null } = {}) {
  let receiver = null;
  let destroyed = false;

  const startReceiver = () => {
    if (destroyed || receiver) return receiver;
    try {
      receiver = createReceiver() ?? null;
    } catch {
      receiver = null;
    }
    return receiver;
  };

  const stopReceiver = () => {
    const current = receiver;
    receiver = null;
    try {
      current?.destroy?.();
    } catch {
      // Lifecycle cleanup remains isolated from the rest of IDE teardown.
    }
  };

  const removeListeners = () => {
    windowRef?.removeEventListener?.('pagehide', onPageHide);
    windowRef?.removeEventListener?.('pageshow', onPageShow);
  };

  const finish = () => {
    if (destroyed) return;
    destroyed = true;
    stopReceiver();
    removeListeners();
  };

  function onPageHide(event) {
    if (destroyed) return;
    stopReceiver();
    if (!event?.persisted) finish();
  }

  function onPageShow(event) {
    if (destroyed || !event?.persisted) return;
    startReceiver();
  }

  if (!isEmbedMode && windowRef?.addEventListener) {
    startReceiver();
    windowRef.addEventListener('pagehide', onPageHide);
    windowRef.addEventListener('pageshow', onPageShow);
  }

  return { destroy: finish };
}
