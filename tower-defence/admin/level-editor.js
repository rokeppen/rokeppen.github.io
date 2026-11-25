// Levels tab of the admin: level list + tile-map editor.
// All level edits go through the pure functions in editor-state.js; this file only does DOM.
// Never use innerHTML here: names come from the database.
import { state, refresh } from './admin.js';
import {
  newLevel, duplicateLevel, cloneLevel, applyTool, extendPath, toggleBlocked, eraseTile,
  resizeLevel, canSave, MIN_SIZE, MAX_SIZE,
} from './editor-state.js';

const TOOLS = [
  { id: 'start', label: 'Start', key: 's', hint: 'Click a tile to place the start (S). Moving it clears the path.' },
  { id: 'end', label: 'End', key: 'e', hint: 'Click a tile to place the end (E). Moving it clears the path.' },
  { id: 'path', label: 'Path', key: 'p', hint: 'Begin on S, then click or drag through neighbouring tiles to E. Click the last tile (or drag back) to step back.' },
  { id: 'blocked', label: 'Blocked', key: 'b', hint: 'Click or drag to toggle tiles where no tower can be built.' },
  { id: 'erase', label: 'Erase', key: 'x', hint: 'Remove whatever is on a tile. Erasing a path tile cuts the path from there; erasing S or E clears the path.' },
];
const HISTORY_LIMIT = 100;

// Editor state survives tab switches (module scope), so unsaved work isn't lost.
const ed = {
  root: null,        // element passed to mountLevels
  view: null,        // our top-level element inside root
  parts: {},         // section id -> container element
  selectedId: null,
  draft: null,       // the level being edited (never mutated; replaced on each edit)
  savedJson: null,   // JSON of the last saved/loaded version; null = never saved
  tool: 'path',
  warnings: [],      // resize warnings (banner)
  message: null,     // { kind: 'ok'|'error', text }
  history: [],       // previous drafts for undo
  paint: null,       // active pointer stroke
  busy: false,
};

// ---------- helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset' || k === 'style') Object.assign(el[k], v);
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const key = (t) => `${t.x},${t.y}`;
const savedLevels = () => [...(state.data?.levels ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
const catalog = () => ({ weapons: state.data?.weapons ?? [], enemies: state.data?.enemies ?? [] });
const isSaved = (id) => savedLevels().some((l) => l.id === id);
const isDirty = () => !!ed.draft && (ed.savedJson === null || JSON.stringify(ed.draft) !== ed.savedJson);
const nextSortOrder = () => Math.max(0, ...savedLevels().map((l) => l.sortOrder ?? 0)) + 1;
const active = () => !!ed.view?.isConnected;

function ensureStylesheet() {
  if (document.getElementById('level-editor-css')) return;
  document.head.append(h('link', {
    id: 'level-editor-css', rel: 'stylesheet', href: new URL('./level-editor.css', import.meta.url).href,
  }));
}

// ---------- state transitions ----------

function load(level, { isNew = false } = {}) {
  ed.draft = cloneLevel(level);
  ed.selectedId = level.id;
  ed.savedJson = isNew ? null : JSON.stringify(ed.draft);
  ed.history = [];
  ed.warnings = [];
  ed.message = null;
}

function confirmDiscard() {
  return !isDirty() || confirm(`"${ed.draft.name}" has unsaved changes. Discard them?`);
}

// Replace the draft. `record` pushes the previous draft onto the undo stack.
// `render` lists the section ids to re-render (status and list always refresh).
function update(next, { record = true, render = ['map'] } = {}) {
  if (next === ed.draft) return;
  if (record) pushHistory(ed.draft);
  ed.draft = next;
  ed.message = null;
  render.forEach(renderPart);
  renderPart('save');
  renderList();
}

function pushHistory(level) {
  ed.history.push(level);
  if (ed.history.length > HISTORY_LIMIT) ed.history.shift();
}

function undo() {
  if (!ed.history.length) return;
  ed.draft = ed.history.pop();
  renderAll();
}

function selectLevel(level) {
  if (level.id === ed.selectedId || !confirmDiscard()) return;
  load(level);
  renderAll();
}

function createLevel() {
  if (!confirmDiscard()) return;
  load({ ...newLevel(), sortOrder: nextSortOrder() }, { isNew: true });
  ed.tool = 'start';
  renderAll();
}

function duplicateCurrent() {
  if (!ed.draft || !confirmDiscard()) return;
  load({ ...duplicateLevel(ed.draft), sortOrder: nextSortOrder() }, { isNew: true });
  ed.message = { kind: 'ok', text: 'Duplicated. The copy is not saved yet.' };
  renderAll();
}

async function deleteCurrent() {
  const level = ed.draft;
  if (!level || !confirm(`Delete "${level.name}"? This can't be undone.`)) return;
  if (isSaved(level.id)) {
    ed.busy = true;
    renderPart('save');
    let res;
    try {
      res = await state.dataSource.deleteLevel(level.id);
      if (res.ok) await refresh();
    } catch (e) {
      res = { ok: false, error: e.message ?? String(e) };
    }
    ed.busy = false;
    if (!res.ok) {
      ed.message = { kind: 'error', text: `Delete failed: ${res.error}` };
      renderAll();
      return;
    }
  }
  selectFirstOrNew();
  ed.message = { kind: 'ok', text: `Deleted "${level.name}".` };
  renderAll();
}

async function saveCurrent() {
  const level = ed.draft;
  if (state.readOnly || !canSave(level, catalog()).ok) return;
  ed.busy = true;
  renderPart('save');
  let res;
  try {
    res = await state.dataSource.saveLevel(level);
    if (res.ok) await refresh();
  } catch (e) {
    res = { ok: false, error: e.message ?? String(e) };
  }
  ed.busy = false;
  if (res.ok) {
    ed.savedJson = JSON.stringify(level);
    ed.message = { kind: 'ok', text: `Saved "${level.name}".` };
  } else {
    ed.message = { kind: 'error', text: `Save failed: ${res.error}` };
  }
  renderAll();
}

function resize(cols, rows) {
  const clamp = (n, fallback) => (Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n))) : fallback);
  cols = clamp(cols, ed.draft.cols);
  rows = clamp(rows, ed.draft.rows);
  if (cols === ed.draft.cols && rows === ed.draft.rows) { renderPart('details'); return; }
  const { level, warnings } = resizeLevel(ed.draft, cols, rows);
  ed.warnings = warnings;
  update(level, { render: ['banner', 'details', 'map'] });
}

function selectFirstOrNew() {
  const first = savedLevels()[0];
  if (first) load(first);
  else load({ ...newLevel(), sortOrder: 1 }, { isNew: true });
}

// ---------- rendering ----------

// Sections of the editor column, rendered top to bottom, each in its own container so it
// can be re-rendered alone. Task 10: add { id, render } entries (weapons, waves, settings)
// and put a "Play this level" button in saveSection's actions.
const SECTIONS = [
  { id: 'banner', render: bannerSection },
  { id: 'details', render: detailsSection },
  { id: 'save', render: saveSection },
  { id: 'map', render: mapSection },
];

function renderAll() {
  if (!ed.root) return;
  const list = h('aside', { className: 'le-list' });
  const main = h('div', { className: 'le-main' });
  ed.parts = { list };
  for (const s of SECTIONS) {
    ed.parts[s.id] = h('div', { className: `le-part le-part-${s.id}` });
    main.append(ed.parts[s.id]);
  }
  ed.view = h('div', { className: 'level-editor' }, list, main);
  ed.root.replaceChildren(ed.view);
  renderList();
  SECTIONS.forEach((s) => renderPart(s.id));
}

function renderPart(id) {
  const el = ed.parts[id];
  const section = SECTIONS.find((s) => s.id === id);
  if (el && section) el.replaceChildren(...[section.render()].flat().filter(Boolean));
}

function renderList() {
  const el = ed.parts.list;
  if (!el) return;
  const items = savedLevels().map((level) => {
    const current = level.id === ed.selectedId;
    const shown = current ? ed.draft : level;
    return listItem(shown, current, level);
  });
  if (ed.draft && !isSaved(ed.draft.id)) items.push(listItem(ed.draft, true, ed.draft, true));
  el.replaceChildren(
    h('h2', {}, 'Levels'),
    h('div', { className: 'le-list-actions' },
      h('button', { type: 'button', textContent: 'New', title: 'Start a blank 16 × 10 level', onclick: createLevel }),
      h('button', { type: 'button', className: 'secondary', textContent: 'Duplicate', disabled: !ed.draft, onclick: duplicateCurrent }),
      h('button', {
        type: 'button', className: 'secondary', textContent: 'Delete',
        disabled: !ed.draft || ed.busy || (state.readOnly && isSaved(ed.draft.id)), onclick: deleteCurrent,
      })),
    items.length ? h('ul', {}, items) : h('p', { className: 'muted' }, 'No levels yet.'),
  );
}

function listItem(shown, current, level, unsaved = false) {
  return h('li', {},
    h('button', {
      type: 'button', 'aria-current': String(current), title: shown.name,
      onclick: () => selectLevel(level),
    },
    h('span', { className: 'le-order', textContent: `#${shown.sortOrder ?? ''}` }),
    h('span', { className: 'le-name', textContent: shown.name || '(unnamed)' }),
    unsaved && h('span', { className: 'le-unsaved', textContent: 'unsaved' }),
    current && !unsaved && isDirty() && h('span', { className: 'le-dirty', textContent: '•', title: 'Unsaved changes' }),
    shown.published && h('span', { className: 'le-pub', textContent: '✓', title: 'Published' })));
}

function bannerSection() {
  const out = [];
  if (ed.warnings.length) {
    out.push(h('div', { className: 'banner', role: 'alert' },
      h('div', {}, h('strong', {}, 'Resizing removed some of the map:'),
        h('ul', {}, ed.warnings.map((w) => h('li', { textContent: w })))),
      h('button', {
        type: 'button', className: 'secondary', textContent: '×', 'aria-label': 'Dismiss',
        onclick: () => { ed.warnings = []; renderPart('banner'); },
      })));
  }
  if (ed.message) {
    out.push(h('p', { className: `le-message ${ed.message.kind}`, role: 'status', textContent: ed.message.text }));
  }
  return out;
}

function detailsSection() {
  const level = ed.draft;
  const num = (value, onchange, extra = {}) => h('input', { type: 'number', value: String(value ?? ''), onchange, ...extra });
  const cols = num(level.cols, () => resize(cols.valueAsNumber, rows.valueAsNumber), { min: MIN_SIZE, max: MAX_SIZE, step: 1 });
  const rows = num(level.rows, () => resize(cols.valueAsNumber, rows.valueAsNumber), { min: MIN_SIZE, max: MAX_SIZE, step: 1 });
  const sortOrder = num(level.sortOrder, () => {
    const n = Math.round(sortOrder.valueAsNumber);
    if (Number.isFinite(n)) update({ ...ed.draft, sortOrder: n }, { render: [] });
    else sortOrder.value = String(ed.draft.sortOrder);
  }, { step: 1 });
  // Name updates on every keystroke without re-rendering this section (keeps focus);
  // undo history records one entry per focus session.
  let recorded = false;
  const name = h('input', {
    type: 'text', className: 'le-name-input', value: level.name ?? '', maxLength: 80,
    oninput: () => { update({ ...ed.draft, name: name.value }, { record: !recorded, render: [] }); recorded = true; },
    onblur: () => { recorded = false; },
  });
  const published = h('input', {
    type: 'checkbox', checked: !!level.published,
    onchange: () => update({ ...ed.draft, published: published.checked }, { render: [] }),
  });
  return h('div', { className: 'le-details' },
    h('label', {}, 'Name', name),
    h('label', {}, 'Order', sortOrder),
    h('div', { className: 'le-size' },
      h('label', {}, `Columns (${MIN_SIZE}–${MAX_SIZE})`, cols),
      h('span', {}, '×'),
      h('label', {}, `Rows (${MIN_SIZE}–${MAX_SIZE})`, rows)),
    h('label', { className: 'le-check' }, published, 'Published'));
}

function saveSection() {
  const level = ed.draft;
  const { ok, errors } = canSave(level, catalog());
  const dirty = isDirty();
  const saveBtn = h('button', {
    type: 'button',
    textContent: ed.busy ? 'Saving…' : 'Save',
    disabled: !ok || !dirty || state.readOnly || ed.busy,
    onclick: saveCurrent,
  });
  let stateText = dirty ? (ed.savedJson === null ? 'Not saved yet' : 'Unsaved changes') : 'All changes saved';
  if (state.readOnly) stateText = 'Read-only: showing bundled data, saving is disabled';
  return h('section', { className: 'le-section', 'aria-label': 'Save' },
    h('div', { className: 'le-save' },
      saveBtn,
      h('span', { className: `le-state${dirty ? ' dirty' : ''}`, textContent: stateText })),
    errors.length
      ? h('ul', { className: `le-reasons${ok ? ' notes' : ''}`, 'aria-label': ok ? 'Notes' : "Why this level can't be saved yet" },
        errors.map((e) => h('li', { textContent: e })))
      : null);
}

function mapSection() {
  const tool = TOOLS.find((t) => t.id === ed.tool);
  const toolbar = h('div', { className: 'le-tools', role: 'toolbar', 'aria-label': 'Map tools' },
    TOOLS.map((t) => h('button', {
      type: 'button', 'aria-pressed': String(t.id === ed.tool), title: `${t.label} (${t.key.toUpperCase()})`,
      onclick: () => { ed.tool = t.id; renderPart('map'); },
    }, t.label, h('kbd', { textContent: t.key.toUpperCase() }))),
    h('span', { className: 'le-spacer' }),
    h('button', {
      type: 'button', className: 'secondary', textContent: 'Undo', title: 'Undo (Ctrl+Z)',
      disabled: !ed.history.length, onclick: undo,
    }));
  return [
    toolbar,
    h('p', { className: 'le-hint', textContent: tool.hint }),
    h('div', { className: 'le-map-wrap' }, mapGrid()),
    legend(),
  ];
}

function mapGrid() {
  const level = ed.draft;
  const pathIndex = new Map(level.path.map((p, i) => [key(p), i]));
  const blocked = new Set(level.blocked.map(key));
  const head = level.path[level.path.length - 1];
  const candidates = new Set();
  if (ed.tool === 'path') {
    if (!head && level.start) candidates.add(key(level.start));
    if (head && !same(head, level.end)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = { x: head.x + dx, y: head.y + dy };
        if (t.x >= 0 && t.y >= 0 && t.x < level.cols && t.y < level.rows && !pathIndex.has(key(t))) candidates.add(key(t));
      }
    }
  }
  const grid = h('div', {
    className: 'le-map', role: 'grid', 'aria-label': `Map, ${level.cols} by ${level.rows} tiles`,
    style: { gridTemplateColumns: `repeat(${level.cols}, minmax(0, 1fr))`, maxWidth: `${level.cols * 44}px` },
  });
  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      const t = { x, y };
      const k = key(t);
      const classes = [];
      let text = '';
      let label = `Tile ${x}, ${y}`;
      if (pathIndex.has(k)) {
        const i = pathIndex.get(k);
        classes.push('path');
        text = String(i + 1);
        label += `, path step ${i + 1}`;
      }
      if (blocked.has(k)) { classes.push('blocked'); text = '✕'; label += ', blocked'; }
      if (same(t, level.start)) { classes.push('start'); text = 'S'; label += ', start'; }
      if (same(t, level.end)) { classes.push('end'); text = 'E'; label += ', end'; }
      if (same(t, head)) classes.push('head');
      if (candidates.has(k)) classes.push('candidate');
      grid.append(h('button', {
        type: 'button', className: classes.join(' '), textContent: text, title: label,
        'aria-label': label, dataset: { x: String(x), y: String(y) },
      }));
    }
  }
  grid.addEventListener('pointerdown', onPointerDown);
  // Keyboard activation (Enter/Space on a focused tile) arrives as a click with detail 0;
  // mouse/touch clicks are already handled on pointerdown.
  grid.addEventListener('click', (e) => {
    const t = tileOf(e.target);
    if (!t || e.detail !== 0) return;
    update(applyTool(ed.draft, ed.tool, t));
    ed.parts.map?.querySelector(`.le-map button[data-x="${t.x}"][data-y="${t.y}"]`)?.focus();
  });
  return grid;
}

function legend() {
  const item = (bg, text) => h('li', {}, h('i', { style: { background: bg } }), text);
  return h('ul', { className: 'le-legend' },
    item('#2e7d32', 'S start'), item('#7b1e3a', 'E end'), item('#d9b98c', 'path (numbered in order)'),
    item('#6d5a4b', '✕ blocked'), item('#8fbf6a', 'buildable'));
}

// ---------- pointer painting ----------

function tileOf(el) {
  const cell = el?.closest?.('.le-map button');
  return cell ? { x: Number(cell.dataset.x), y: Number(cell.dataset.y) } : null;
}

function onPointerDown(e) {
  const t = tileOf(e.target);
  if (!t || e.button !== 0) return;
  e.preventDefault();
  const before = ed.draft;
  ed.paint = {
    before, last: t, tool: ed.tool,
    addBlocked: !before.blocked.some((b) => same(b, t)),
  };
  update(applyTool(before, ed.tool, t), { record: false });
}

function onPointerMove(e) {
  const p = ed.paint;
  if (!p) return;
  const t = tileOf(document.elementFromPoint(e.clientX, e.clientY));
  if (!t || same(t, p.last)) return;
  p.last = t;
  const level = ed.draft;
  let next = level;
  if (p.tool === 'path') {
    const path = level.path;
    // Dragging back onto the previous tile steps back; otherwise try to extend.
    const head = path[path.length - 1];
    if (path.length >= 2 && same(path[path.length - 2], t)) next = extendPath(level, head);
    else if (!same(head, t) && !same(head, level.end)) next = extendPath(level, t); // stop at E
  } else if (p.tool === 'blocked') {
    if (p.addBlocked !== level.blocked.some((b) => same(b, t))) next = toggleBlocked(level, t);
  } else if (p.tool === 'erase') {
    next = eraseTile(level, t);
  }
  update(next, { record: false });
}

function endStroke() {
  const p = ed.paint;
  if (!p) return;
  ed.paint = null;
  if (p.before !== ed.draft) {
    pushHistory(p.before);
    if (active()) renderPart('map'); // refresh Undo button state
  }
}

// ---------- global listeners (installed once, inert while the tab isn't shown) ----------

let listenersInstalled = false;
function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  // On window, because the map re-renders during a stroke (replacing the grid element).
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', (e) => {
    if (!active() || !ed.draft) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (tool) { ed.tool = tool.id; renderPart('map'); }
  });
}

// ---------- entry ----------

export function mountLevels(el) {
  ensureStylesheet();
  installListeners();
  ed.root = el;
  // Keep the current draft across tab switches; otherwise pick the first level.
  const keep = ed.draft && (isSaved(ed.draft.id) || ed.savedJson === null || isDirty());
  if (!keep) selectFirstOrNew();
  renderAll();
}
