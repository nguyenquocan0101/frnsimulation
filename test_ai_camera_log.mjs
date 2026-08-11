import test from 'node:test';
import assert from 'node:assert/strict';

async function loadProtocol() {
  return import('./ai-camera-log.mjs');
}

class RecordingBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.messages = [];
    this.closeCalls = 0;
    RecordingBroadcastChannel.instances.push(this);
  }

  postMessage(payload) {
    this.messages.push(payload);
  }

  close() {
    this.closeCalls += 1;
  }
}

const validPayload = () => ({
  type: 'ai-camera:prediction',
  version: 1,
  summary: 'Predicted 2 boxes in 76 ms. Boxes are ready to run again.',
  lines: [
    'Box 1 · 3_dog — 3_dog 33.8% · 8_airplane 27.1%',
    'Box 2 · 5_chair — 5_chair 97.7% · 3_dog 1.8%',
  ],
});

test('validator accepts only the strict four-key versioned prediction schema', async () => {
  const { validateAiCameraLogPayload } = await loadProtocol();
  const payload = validPayload();

  assert.equal(validateAiCameraLogPayload(payload), true);
  assert.deepEqual(Object.keys(payload).sort(), ['lines', 'summary', 'type', 'version']);

  const invalid = [
    null,
    [],
    new Date(),
    { ...payload, type: 'ai-camera:status' },
    { ...payload, version: 2 },
    { type: payload.type, version: payload.version, summary: payload.summary },
    { ...payload, model: 'demo.onnx' },
    { ...payload, frame: new Uint8Array([1]) },
  ];

  for (const candidate of invalid) {
    assert.equal(validateAiCameraLogPayload(candidate), false, `rejected ${String(candidate)}`);
  }
});

test('validator rejects invalid cardinality and every non-single-line control case', async () => {
  const { validateAiCameraLogPayload } = await loadProtocol();
  const payload = validPayload();
  const overlong = 'x'.repeat(501);
  const eightLines = Array.from({ length: 8 }, (_, index) => `Box ${index + 1}`);
  const invalid = [
    { ...payload, summary: '' },
    { ...payload, summary: overlong },
    { ...payload, summary: 'line\rbreak' },
    { ...payload, summary: 'line\nbreak' },
    { ...payload, summary: 'nul\u0000byte' },
    { ...payload, summary: 'unit\u001fseparator' },
    { ...payload, summary: 'delete\u007fchar' },
    { ...payload, summary: 'next\u0085line' },
    { ...payload, summary: 'line\u2028separator' },
    { ...payload, summary: 'paragraph\u2029separator' },
    { ...payload, lines: [] },
    { ...payload, lines: eightLines },
    { ...payload, lines: [''] },
    { ...payload, lines: [overlong] },
    { ...payload, lines: ['Box 1\rBox 2'] },
    { ...payload, lines: ['Box 1\nBox 2'] },
    { ...payload, lines: ['Box\u0009tab'] },
    { ...payload, lines: ['Box\u007fdel'] },
    { ...payload, lines: ['Box\u0085next'] },
    { ...payload, lines: ['Box\u2028line'] },
    { ...payload, lines: ['Box\u2029paragraph'] },
    { ...payload, lines: [123] },
  ];

  for (const candidate of invalid) {
    assert.equal(validateAiCameraLogPayload(candidate), false, JSON.stringify(candidate));
  }

  for (let codePoint = 0; codePoint <= 0x1f; codePoint += 1) {
    const control = String.fromCharCode(codePoint);
    assert.equal(validateAiCameraLogPayload({ ...payload, summary: `bad${control}summary` }), false, `summary rejects U+${codePoint.toString(16).padStart(4, '0')}`);
    assert.equal(validateAiCameraLogPayload({ ...payload, lines: [`bad${control}line`] }), false, `line rejects U+${codePoint.toString(16).padStart(4, '0')}`);
  }

  assert.equal(validateAiCameraLogPayload({ ...payload, summary: 'x'.repeat(500) }), true);
  assert.equal(validateAiCameraLogPayload({ ...payload, lines: ['x'.repeat(500)] }), true);
  assert.equal(validateAiCameraLogPayload({ ...payload, lines: Array.from({ length: 7 }, (_, index) => `Box ${index + 1}`) }), true);
});

test('publisher posts an exact sanitized text-only payload through windowRef BroadcastChannel', async () => {
  const { createAiCameraLogPublisher, validateAiCameraLogPayload } = await loadProtocol();
  RecordingBroadcastChannel.instances.length = 0;
  const publisher = createAiCameraLogPublisher({
    windowRef: { BroadcastChannel: RecordingBroadcastChannel },
  });

  publisher.publish({
    summary: '  Predicted\r\n 1 box\u0000\u0085 in 9 ms.  ',
    lines: ['  Box 1\t· dog — dog 90.0%\n\u2028\u2029  '],
  });

  assert.equal(RecordingBroadcastChannel.instances.length, 1);
  const channel = RecordingBroadcastChannel.instances[0];
  assert.match(channel.name, /v1/i);
  assert.equal(channel.messages.length, 1);
  const [message] = channel.messages;
  assert.deepEqual(Object.keys(message).sort(), ['lines', 'summary', 'type', 'version']);
  assert.equal(validateAiCameraLogPayload(message), true);
  for (const text of [message.summary, ...message.lines]) {
    assert.doesNotMatch(text, /[\u0000-\u001f\u007f\u0085\u2028\u2029]/);
  }
  for (const forbidden of ['model', 'frame', 'file', 'blob', 'stream', 'canvas']) {
    assert.equal(Object.hasOwn(message, forbidden), false);
  }

  publisher.destroy();
  publisher.destroy();
  assert.equal(channel.closeCalls, 1);
});

test('publisher is a safe no-op and never falls back to an ambient Node global', async () => {
  const { createAiCameraLogPublisher } = await loadProtocol();
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  let ambientConstructions = 0;
  class AmbientChannel {
    constructor() { ambientConstructions += 1; }
    postMessage() {}
    close() {}
  }

  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: AmbientChannel,
  });
  try {
    const missing = createAiCameraLogPublisher({ windowRef: {} });
    assert.doesNotThrow(() => missing.publish({ summary: 'Valid summary', lines: ['Box 1'] }));
    assert.doesNotThrow(() => missing.destroy());
    assert.equal(ambientConstructions, 0, 'ambient global must not be consulted');

    const throwingConstructor = createAiCameraLogPublisher({
      windowRef: { BroadcastChannel: class { constructor() { throw new Error('blocked'); } } },
    });
    assert.doesNotThrow(() => throwingConstructor.publish({ summary: 'Valid summary', lines: ['Box 1'] }));
    assert.doesNotThrow(() => throwingConstructor.destroy());

    const throwingOperations = createAiCameraLogPublisher({
      windowRef: {
        BroadcastChannel: class {
          postMessage() { throw new Error('post failed'); }
          close() { throw new Error('close failed'); }
        },
      },
    });
    assert.doesNotThrow(() => throwingOperations.publish({ summary: 'Valid summary', lines: ['Box 1'] }));
    assert.doesNotThrow(() => throwingOperations.destroy());
    assert.doesNotThrow(() => throwingOperations.destroy());
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'BroadcastChannel', originalDescriptor);
    else delete globalThis.BroadcastChannel;
  }
});

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.tasks = new Map();
    this.now = () => this.time;
    this.setTimeout = (callback, delay = 0) => {
      const id = this.nextId++;
      this.tasks.set(id, { callback, due: this.time + Math.max(0, Number(delay) || 0) });
      return id;
    };
    this.clearTimeout = (id) => { this.tasks.delete(id); };
  }

  advanceTo(target) {
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.time = task.due;
      task.callback();
    }
    this.time = target;
  }
}

class ReceivingBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.closeCalls = 0;
    this.listeners = new Set();
    this.onmessage = null;
    ReceivingBroadcastChannel.instances.push(this);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  emit(data) {
    const event = { data };
    this.onmessage?.(event);
    for (const listener of this.listeners) listener(event);
  }

  close() { this.closeCalls += 1; }
}

class LinkedBroadcastChannel extends ReceivingBroadcastChannel {
  static instances = [];

  constructor(name) {
    super(name);
    ReceivingBroadcastChannel.instances.pop();
    LinkedBroadcastChannel.instances.push(this);
  }

  postMessage(payload) {
    for (const peer of LinkedBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name && peer.closeCalls === 0) peer.emit(payload);
    }
  }
}

test('receiver uses a leading and trailing latest-wins cadence at 0, 3, 6, and 9 seconds', async () => {
  const { createAiCameraLogReceiver } = await loadProtocol();
  const clock = new FakeClock();
  const renders = [];
  ReceivingBroadcastChannel.instances.length = 0;
  const receiver = createAiCameraLogReceiver({
    windowRef: { BroadcastChannel: ReceivingBroadcastChannel },
    onRender(payload) { renders.push({ at: clock.now(), summary: payload.summary }); },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const channel = ReceivingBroadcastChannel.instances[0];
  const emit = (second, label) => {
    clock.advanceTo(second * 1000);
    channel.emit({ ...validPayload(), summary: label });
  };

  emit(0, 'result@0');
  emit(2, 'result@2');
  clock.advanceTo(3000);
  emit(4, 'result@4');
  clock.advanceTo(6000);
  emit(6, 'result@6');
  emit(8, 'result@8');
  clock.advanceTo(9000);
  emit(10, 'result@10');

  assert.deepEqual(renders, [
    { at: 0, summary: 'result@0' },
    { at: 3000, summary: 'result@2' },
    { at: 6000, summary: 'result@4' },
    { at: 9000, summary: 'result@8' },
  ]);
  assert.equal(clock.tasks.size, 1, 'the result at 10 seconds is buffered behind one timer');

  receiver.destroy();
  receiver.destroy();
  clock.advanceTo(12000);
  assert.equal(renders.length, 4, 'destroy cancels the buffered trailing render');
  assert.equal(channel.closeCalls, 1);
});

test('receiver rejects invalid messages and safely no-ops without a browser channel', async () => {
  const { createAiCameraLogReceiver } = await loadProtocol();
  const renders = [];
  ReceivingBroadcastChannel.instances.length = 0;
  const receiver = createAiCameraLogReceiver({
    windowRef: { BroadcastChannel: ReceivingBroadcastChannel },
    onRender(payload) { renders.push(payload); },
  });
  const channel = ReceivingBroadcastChannel.instances[0];
  channel.emit({ ...validPayload(), extra: 'same-origin spoof' });
  channel.emit({ ...validPayload(), lines: ['bad\nline'] });
  assert.equal(renders.length, 0);
  receiver.destroy();

  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  let ambientConstructions = 0;
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: class { constructor() { ambientConstructions += 1; } },
  });
  try {
    const missing = createAiCameraLogReceiver({ windowRef: {}, onRender() { throw new Error('must not render'); } });
    assert.doesNotThrow(() => missing.destroy());
    assert.equal(ambientConstructions, 0);

    const throwing = createAiCameraLogReceiver({
      windowRef: { BroadcastChannel: class { constructor() { throw new Error('unsupported'); } } },
      onRender() { throw new Error('must not render'); },
    });
    assert.doesNotThrow(() => throwing.destroy());
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'BroadcastChannel', originalDescriptor);
    else delete globalThis.BroadcastChannel;
  }
});

test('publisher close still allows one already-buffered success to render and remain', async () => {
  const { createAiCameraLogPublisher, createAiCameraLogReceiver } = await loadProtocol();
  const clock = new FakeClock();
  const renders = [];
  LinkedBroadcastChannel.instances.length = 0;
  const windowRef = { BroadcastChannel: LinkedBroadcastChannel };
  const receiver = createAiCameraLogReceiver({
    windowRef,
    onRender(payload) { renders.push({ at: clock.now(), summary: payload.summary }); },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const publisher = createAiCameraLogPublisher({ windowRef });

  publisher.publish({ summary: 'first success', lines: ['Box 1 · dog'] });
  clock.advanceTo(1000);
  publisher.publish({ summary: 'buffered success', lines: ['Box 1 · chair'] });
  const publisherChannel = LinkedBroadcastChannel.instances[1];
  publisher.destroy();
  publisher.destroy();
  assert.equal(publisherChannel.closeCalls, 1, 'Camera publisher channel closes synchronously and once');
  assert.equal(publisher.publish({ summary: 'late success', lines: ['Box 1 · dog'] }), false, 'publish after close is ignored');
  assert.deepEqual(renders, [{ at: 0, summary: 'first success' }]);

  clock.advanceTo(3000);
  assert.deepEqual(renders, [
    { at: 0, summary: 'first success' },
    { at: 3000, summary: 'buffered success' },
  ]);
  clock.advanceTo(9000);
  assert.equal(renders.length, 2, 'no disconnect or blank replacement is synthesized');
  receiver.destroy();
});

class FakeTextNode {
  constructor(text, ownerDocument) {
    this.nodeType = 3;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.textContent = String(text);
  }
}

class FakeDomElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.className = '';
    this.scrollTop = 0;
    this.scrollHeight = 320;
    this._textContent = '';
    this.classList = {
      add: (...names) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) current.add(name);
        this.className = [...current].join(' ');
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join('');
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) {
        const oldIndex = node.parentNode.children.indexOf(node);
        if (oldIndex >= 0) node.parentNode.children.splice(oldIndex, 1);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  insertBefore(node, reference) {
    if (node.parentNode) {
      const oldIndex = node.parentNode.children.indexOf(node);
      if (oldIndex >= 0) node.parentNode.children.splice(oldIndex, 1);
    }
    const index = this.children.indexOf(reference);
    node.parentNode = this;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }

  querySelectorAll(selector) {
    if (!selector.startsWith('.')) return [];
    const className = selector.slice(1);
    return this.children.filter((child) => child.nodeType === 1 && child.classList.contains(className));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDomDocument {
  createElement(tagName) { return new FakeDomElement(tagName, this); }
  createTextNode(text) { return new FakeTextNode(text, this); }
}

test('console renderer lazily maintains exactly one text-only AI block and scrolls to bottom', async () => {
  const { renderAiCameraLog } = await loadProtocol();
  const documentRef = new FakeDomDocument();
  const consoleElement = documentRef.createElement('pre');
  assert.equal(consoleElement.querySelectorAll('.ai-camera-log-block').length, 0);

  const first = {
    ...validPayload(),
    summary: '<img src=x onerror=alert(1)>',
    lines: ['Box 1 · <b>dog</b> — dog 90.0%'],
  };
  renderAiCameraLog(consoleElement, first);
  const block = consoleElement.querySelector('.ai-camera-log-block');
  assert.ok(block);
  assert.equal(block.children.length, 0, 'payload never creates nested HTML elements');
  assert.match(block.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(block.textContent, /<b>dog<\/b>/);
  assert.equal(consoleElement.scrollTop, consoleElement.scrollHeight);

  for (let index = 0; index < 10; index += 1) {
    consoleElement.scrollTop = 0;
    renderAiCameraLog(consoleElement, { ...validPayload(), summary: `latest-${index}` });
  }
  assert.equal(consoleElement.querySelectorAll('.ai-camera-log-block').length, 1);
  assert.equal(consoleElement.querySelector('.ai-camera-log-block'), block, 'updates reuse the one live block');
  assert.match(block.textContent, /latest-9/);
  assert.doesNotMatch(block.textContent, /latest-8/);
  assert.equal(consoleElement.scrollTop, consoleElement.scrollHeight);
});

test('normal console text inserts before the AI block and Clear allows one recreated block', async () => {
  const { appendConsoleLogText, renderAiCameraLog } = await loadProtocol();
  const documentRef = new FakeDomDocument();
  const consoleElement = documentRef.createElement('pre');
  renderAiCameraLog(consoleElement, validPayload());
  const originalBlock = consoleElement.querySelector('.ai-camera-log-block');

  appendConsoleLogText(consoleElement, '12:00:00  Simulator ready\n');
  consoleElement.scrollTop = 0;
  appendConsoleLogText(consoleElement, '12:00:01  Home -> 0\n');
  assert.equal(consoleElement.children.length, 3);
  assert.equal(consoleElement.children[0].nodeType, 3);
  assert.equal(consoleElement.children[0].textContent, '12:00:00  Simulator ready\n');
  assert.equal(consoleElement.children[1].textContent, '12:00:01  Home -> 0\n');
  assert.equal(consoleElement.children[2], originalBlock);
  assert.match(consoleElement.textContent, /^12:00:00  Simulator ready/);
  assert.match(consoleElement.textContent, /12:00:01  Home -> 0/);
  assert.equal(consoleElement.scrollTop, consoleElement.scrollHeight);

  consoleElement.textContent = '';
  assert.equal(consoleElement.querySelector('.ai-camera-log-block'), null);
  consoleElement.scrollTop = 0;
  renderAiCameraLog(consoleElement, { ...validPayload(), summary: 'Recreated after Clear' });
  const recreated = consoleElement.querySelector('.ai-camera-log-block');
  assert.ok(recreated);
  assert.notEqual(recreated, originalBlock);
  assert.equal(consoleElement.querySelectorAll('.ai-camera-log-block').length, 1);
  assert.equal(consoleElement.scrollTop, consoleElement.scrollHeight);
});
