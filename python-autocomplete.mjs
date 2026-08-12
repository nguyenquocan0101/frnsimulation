const TECHCAMP_SUGGESTIONS = Object.freeze([
  { label: 'move_to', detail: 'TechCamp API', insert: 'move_to("P1")', caretBack: 4 },
  { label: 'move_down', detail: 'TechCamp API', insert: 'move_down()' },
  { label: 'move_up', detail: 'TechCamp API', insert: 'move_up()' },
  { label: 'grip', detail: 'TechCamp API', insert: 'grip()' },
  { label: 'release', detail: 'TechCamp API', insert: 'release()' },
  { label: 'get_positions', detail: 'TechCamp API', insert: 'get_positions()' },
]);

const PYTHON_SUGGESTIONS = Object.freeze([
  { label: 'print', detail: 'Python function', insert: 'print()', caretBack: 1 },
  { label: 'range', detail: 'Python function', insert: 'range()', caretBack: 1 },
  { label: 'len', detail: 'Python function', insert: 'len()', caretBack: 1 },
  { label: 'sorted', detail: 'Python function', insert: 'sorted()', caretBack: 1 },
  { label: 'enumerate', detail: 'Python function', insert: 'enumerate()', caretBack: 1 },
  { label: 'zip', detail: 'Python function', insert: 'zip()', caretBack: 1 },
  { label: 'int', detail: 'Python function', insert: 'int()', caretBack: 1 },
  { label: 'str', detail: 'Python function', insert: 'str()', caretBack: 1 },
  { label: 'def', detail: 'Python snippet', insert: 'def function_name():\n    ', caretBack: 17 },
  { label: 'for', detail: 'Python snippet', insert: 'for item in items:\n    ', caretBack: 15 },
  { label: 'if', detail: 'Python snippet', insert: 'if condition:\n    ', caretBack: 15 },
  { label: 'with', detail: 'TechCamp snippet', insert: 'with TechCamp() as bot:\n    ' },
  { label: 'return', detail: 'Python keyword', insert: 'return ' },
  { label: 'import', detail: 'Python keyword', insert: 'import ' },
  { label: 'from', detail: 'Python keyword', insert: 'from ' },
]);

function isCodePosition(source, caret) {
  let quote = null;
  let triple = false;
  let escaped = false;
  for (let index = 0; index < caret; index += 1) {
    const character = source[index];
    if (!quote && character === '#') {
      const newline = source.indexOf('\n', index);
      if (newline < 0 || newline >= caret) return false;
      index = newline;
      continue;
    }
    if (!quote && (character === "'" || character === '"')) {
      triple = source.slice(index, index + 3) === character.repeat(3);
      quote = character;
      if (triple) index += 2;
      continue;
    }
    if (!quote) continue;
    if (!triple && character === '\n') {
      if (!escaped) quote = null;
      escaped = false;
      continue;
    }
    if (!triple && character === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (character === quote && !escaped) {
      if (!triple || source.slice(index, index + 3) === quote.repeat(3)) {
        if (triple) index += 2;
        quote = null;
        triple = false;
      }
    }
    escaped = false;
  }
  return !quote;
}

export function getPythonCompletions(source, caret = String(source ?? '').length) {
  const text = String(source ?? '');
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  if (!isCodePosition(text, safeCaret)) return null;
  const before = text.slice(0, safeCaret);
  const apiMatch = before.match(/\bbot\.([A-Za-z_]*)$/);
  const wordMatch = before.match(/([A-Za-z_]+)$/);
  const match = apiMatch ?? wordMatch;
  if (!match) return null;
  const query = match[1].toLowerCase();
  const pool = apiMatch ? TECHCAMP_SUGGESTIONS : PYTHON_SUGGESTIONS;
  const items = pool.filter((item) => item.label.startsWith(query)).slice(0, 7);
  return items.length ? { start: safeCaret - query.length, end: safeCaret, items } : null;
}

export function applyPythonCompletion(source, completion, item) {
  const text = String(source ?? '');
  const nextSource = `${text.slice(0, completion.start)}${item.insert}${text.slice(completion.end)}`;
  const caret = completion.start + item.insert.length - (item.caretBack ?? 0);
  return { source: nextSource, selectionStart: caret, selectionEnd: caret };
}

function caretCoordinates(editor) {
  const before = editor.value.slice(0, editor.selectionStart);
  const lines = before.split('\n');
  const visualColumn = [...lines.at(-1)].reduce(
    (column, character) => character === '\t' ? column + 4 - (column % 4) : column + 1,
    0,
  );
  const style = getComputedStyle(editor);
  const fontSize = Number.parseFloat(style.fontSize) || 12;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.7;
  const left = 62 + visualColumn * fontSize * 0.61 - editor.scrollLeft;
  const top = 15 + lines.length * lineHeight - editor.scrollTop;
  return { left: Math.max(54, left), top: Math.max(8, top) };
}

export function createPythonAutocomplete({ editor, popup, onChange = () => {} } = {}) {
  if (!editor || !popup) return { destroy() {} };
  let completion = null;
  let selectedIndex = 0;

  const close = () => {
    completion = null;
    popup.hidden = true;
    popup.replaceChildren();
    editor.removeAttribute('aria-activedescendant');
  };

  const select = (index) => {
    if (!completion) return;
    selectedIndex = (index + completion.items.length) % completion.items.length;
    [...popup.children].forEach((item, itemIndex) => {
      item.setAttribute('aria-selected', String(itemIndex === selectedIndex));
    });
    const active = popup.children[selectedIndex];
    if (active) editor.setAttribute('aria-activedescendant', active.id);
  };

  const accept = (index = selectedIndex) => {
    if (
      !completion?.items[index]
      || editor.selectionStart !== editor.selectionEnd
      || editor.selectionStart !== completion.end
    ) {
      close();
      return false;
    }
    const result = applyPythonCompletion(editor.value, completion, completion.items[index]);
    editor.value = result.source;
    editor.setSelectionRange(result.selectionStart, result.selectionEnd);
    close();
    onChange();
    return true;
  };

  const update = () => {
    completion = getPythonCompletions(editor.value, editor.selectionStart);
    if (!completion || editor.selectionStart !== editor.selectionEnd) {
      close();
      return;
    }
    selectedIndex = 0;
    popup.replaceChildren(...completion.items.map((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `pythonCompletion${index}`;
      option.className = 'python-completion-option';
      option.setAttribute('role', 'option');
      option.innerHTML = `<strong></strong><span></span>`;
      option.querySelector('strong').textContent = item.label;
      option.querySelector('span').textContent = item.detail;
      option.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        accept(index);
      });
      return option;
    }));
    const coordinates = caretCoordinates(editor);
    popup.style.left = `${Math.min(coordinates.left, Math.max(8, editor.clientWidth - 270))}px`;
    popup.style.top = `${Math.min(coordinates.top, Math.max(8, editor.clientHeight - 238))}px`;
    popup.hidden = false;
    select(0);
  };

  const onKeyDown = (event) => {
    if (popup.hidden || !completion) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      accept();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      close();
    }
  };

  editor.addEventListener('input', update);
  editor.addEventListener('click', update);
  editor.addEventListener('keydown', onKeyDown);
  editor.addEventListener('blur', close);
  return {
    close,
    destroy() {
      close();
      editor.removeEventListener('input', update);
      editor.removeEventListener('click', update);
      editor.removeEventListener('keydown', onKeyDown);
      editor.removeEventListener('blur', close);
    },
  };
}
