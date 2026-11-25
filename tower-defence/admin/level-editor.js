// Levels tab of the admin: level list + tile-map editor.
// All level edits go through the pure functions in editor-state.js; this file only does DOM.
// Never use innerHTML here: names come from the database.
import { state, refresh } from './admin.js';
import {
  newLevel, duplicateLevel, applyTool, extendPath, toggleBlocked, eraseTile,
  resizeLevel, canSave, MIN_SIZE, MAX_SIZE, prepareForEditor,
  setWeapons, addWave, removeWave, moveWave, addGroup, updateGroup, removeGroup, waveSummary,
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
  savedJson: null,   // JSON of the last saved/loaded version (a new level: its initial snapshot)
  isNew: false,      // draft has never been saved
  tool: 'path',
  warnings: [],      // resize warnings (banner)
  loadWarnings: [],  // repairs made when a raw (possibly invalid) DB level was loaded (banner)
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
const isDirty = () => !!ed.draft && JSON.stringify(ed.draft) !== ed.savedJson;
const nextSortOrder = () => Math.max(0, ...savedLevels().map((l) => l.sortOrder ?? 0)) + 1;
const active = () => !!ed.view?.isConnected;

function ensureStylesheet() {
  if (document.getElementById('level-editor-css')) return;
  document.head.append(h('link', {
    id: 'level-editor-css', rel: 'stylesheet', href: new URL('./level-editor.css', import.meta.url).href,
  }));
}

// ---------- state transitions ----------

// Saved levels may be raw invalid DB rows: prepareForEditor sanitises them and reports every
// repair (shown in the banner). Dirtiness compares against the level as stored, so a repaired
// level shows "Unsaved changes" until the repair is saved. A new level compares against its
// initial snapshot, so an untouched one isn't "dirty".
function load(level, { isNew = false } = {}) {
  const { level: draft, warnings } = prepareForEditor(level, catalog());
  ed.draft = draft;
  ed.selectedId = draft.id;
  ed.isNew = isNew;
  ed.savedJson = JSON.stringify(isNew ? draft : level);
  ed.loadWarnings = warnings;
  ed.history = [];
  ed.warnings = [];
  ed.message = null;
}

function confirmDiscard() {
  if (ed.busy) return false; // never switch level while a save/delete is in flight
  return !isDirty() || confirm(`"${ed.draft.name || 'This level'}" has unsaved changes. Discard them?`);
}

const blankLevel = (sortOrder) => ({ ...newLevel(), sortOrder, weaponIds: catalog().weapons.map((w) => w.id) });

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
  load(blankLevel(nextSortOrder()), { isNew: true });
  ed.tool = 'start';
  renderAll();
}

function duplicateCurrent() {
  if (!ed.draft || !confirmDiscard()) return;
  load({ ...duplicateLevel(ed.draft), sortOrder: nextSortOrder() }, { isNew: true });
  ed.message = { kind: 'ok', text: 'Duplicated. The copy is not saved yet.' };
  renderAll();
}

const errorText = (e) => e?.message ?? String(e);

// Runs a DB write then reloads state.data. Returns { ok, error, reloadError }: a failed reload
// after a successful write is reported separately (the write did happen).
async function writeAndReload(write) {
  let res;
  try {
    res = await write();
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
  if (!res?.ok) return { ok: false, error: res?.error ?? 'unknown error' };
  try {
    await refresh();
  } catch (e) {
    return { ok: true, reloadError: errorText(e) };
  }
  return { ok: true };
}

async function deleteCurrent() {
  const level = ed.draft;
  if (!level || ed.busy || !confirm(`Delete "${level.name || 'this level'}"? This can't be undone.`)) return;
  let reloadError;
  if (isSaved(level.id)) {
    ed.busy = true;
    renderPart('save');
    renderList();
    const res = await writeAndReload(() => state.dataSource.deleteLevel(level.id));
    ed.busy = false;
    if (!res.ok) {
      ed.message = { kind: 'error', text: `Delete failed: ${res.error}` };
      renderAll();
      return;
    }
    reloadError = res.reloadError;
  }
  if (reloadError) {
    // state.data is stale and still lists the level: drop it locally so it isn't shown.
    state.data = { ...state.data, levels: state.data.levels.filter((l) => l.id !== level.id) };
  }
  selectFirstOrNew();
  ed.message = reloadError
    ? { kind: 'error', text: `Deleted "${level.name}", but couldn't reload the levels: ${reloadError}` }
    : { kind: 'ok', text: `Deleted "${level.name}".` };
  renderAll();
}

async function saveCurrent() {
  const level = ed.draft;
  if (state.readOnly || ed.busy || !canSave(level, catalog()).ok) return;
  ed.busy = true;
  renderPart('save');
  renderList();
  const res = await writeAndReload(() => state.dataSource.saveLevel(level));
  ed.busy = false;
  // Level switching is blocked while busy, but guard anyway: never mark another draft as saved.
  const stillHere = ed.draft?.id === level.id;
  if (res.ok) {
    if (stillHere) {
      ed.savedJson = JSON.stringify(level);
      ed.isNew = false;
      ed.loadWarnings = [];
    }
    if (res.reloadError) {
      // Keep the level list consistent with what was just written.
      const levels = (state.data?.levels ?? []).filter((l) => l.id !== level.id);
      state.data = { ...state.data, levels: [...levels, level] };
    }
    ed.message = res.reloadError
      ? { kind: 'error', text: `Saved "${level.name}", but couldn't reload: ${res.reloadError}` }
      : { kind: 'ok', text: `Saved "${level.name}".` };
  } else {
    ed.message = { kind: 'error', text: `Save failed: ${res.error}` };
  }
  renderAll();
}

function playCurrent() {
  const url = new URL(`../play.html?level=${encodeURIComponent(ed.draft.id)}&preview=1`, location.href);
  window.open(url.href, '_blank', 'noopener');
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
  else load(blankLevel(1), { isNew: true });
}

// ---------- rendering ----------

// Sections of the editor column, rendered top to bottom, each in its own container so it
// can be re-rendered alone.
const SECTIONS = [
  { id: 'banner', render: bannerSection },
  { id: 'details', render: detailsSection },
  { id: 'save', render: saveSection },
  { id: 'map', render: mapSection },
  { id: 'settings', render: settingsSection },
  { id: 'weapons', render: weaponsSection },
  { id: 'waves', render: wavesSection },
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
  if (ed.loadWarnings.length) {
    out.push(h('div', { className: 'banner', role: 'alert' },
      h('div', {}, h('strong', {}, 'This level had problems and was repaired in the editor. Save to keep the repairs:'),
        h('ul', {}, ed.loadWarnings.map((w) => h('li', { textContent: w })))),
      h('button', {
        type: 'button', className: 'secondary', textContent: '×', 'aria-label': 'Dismiss',
        onclick: () => { ed.loadWarnings = []; renderPart('banner'); },
      })));
  }
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
  const saved = isSaved(level.id);
  const saveBtn = h('button', {
    type: 'button',
    textContent: ed.busy ? 'Saving…' : 'Save',
    disabled: !ok || !(dirty || !saved) || state.readOnly || ed.busy,
    onclick: saveCurrent,
  });
  // The game loads the level from the database, so only a saved, unchanged, valid level can be played.
  const playable = ok && saved && !dirty && !ed.busy;
  const playBtn = h('button', {
    type: 'button', className: 'secondary', textContent: 'Play this level ↗',
    title: playable ? 'Opens the game with this level in a new tab (unpublished levels included)'
      : 'Save a valid level first, then play-test it',
    disabled: !playable, onclick: playCurrent,
  });
  const undoBtn = h('button', {
    type: 'button', className: 'secondary', textContent: 'Undo', title: 'Undo (Ctrl+Z)',
    disabled: !ed.history.length, onclick: undo,
  });
  let stateText = !saved ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved';
  if (state.readOnly) stateText = 'Read-only: showing bundled data, saving is disabled';
  return h('section', { className: 'le-section', 'aria-label': 'Save' },
    h('div', { className: 'le-save' },
      saveBtn,
      undoBtn,
      playBtn,
      h('span', { className: `le-state${dirty || !saved ? ' dirty' : ''}`, textContent: stateText })),
    errors.length
      ? h('ul', { className: `le-reasons${ok ? ' notes' : ''}`, 'aria-label': ok ? 'Notes' : "Why this level can't be saved yet" },
        errors.map((e) => h('li', { textContent: e })))
      : null);
}

// A number input that stores Numbers. Empty/garbage input reverts to the current value;
// range problems (0 guests, a negative delay…) are stored and reported by canSave.
// `get` returns the current stored value.
function numberInput(get, onNumber, attrs = {}) {
  const input = h('input', { type: 'number', value: String(get() ?? ''), ...attrs });
  input.onchange = () => {
    const n = input.valueAsNumber;
    if (Number.isFinite(n)) onNumber(n);
    else input.value = String(get() ?? '');
  };
  return input;
}

function settingsSection() {
  const field = (key, label, hint) => h('label', { title: hint }, label,
    numberInput(() => ed.draft[key], (n) => update({ ...ed.draft, [key]: n }, { render: [] }), { min: 1, step: 1 }));
  return h('section', { className: 'le-section le-settings', 'aria-label': 'Starting resources' },
    h('h3', {}, 'Starting resources'),
    h('div', { className: 'le-fields' },
      field('startingCorks', 'Starting corks', 'Corks to spend on weapons at the start'),
      field('startingWine', 'Starting wine (bottles)', 'Lives: a guest reaching the end drinks some wine')));
}

function weaponsSection() {
  const weapons = catalog().weapons;
  const chosen = Array.isArray(ed.draft.weaponIds) ? ed.draft.weaponIds : [];
  const missing = chosen.filter((id) => !weapons.some((w) => w.id === id));
  const boxes = [];
  const onchange = () => update(setWeapons(ed.draft, boxes.filter((b) => b.checked).map((b) => b.dataset.id)), { render: [] });
  const option = (id, ...label) => {
    const box = h('input', { type: 'checkbox', checked: chosen.includes(id), onchange, dataset: { id } });
    boxes.push(box);
    return h('li', {}, h('label', { className: 'le-check' }, box, ...label));
  };
  const items = [
    ...weapons.map((w) => option(w.id,
      h('span', { className: 'le-sprite', textContent: w.sprite ?? '' }),
      h('span', { textContent: w.name ?? w.id }),
      h('span', { className: 'le-cost', textContent: `${w.cost ?? '?'} corks` }))),
    ...missing.map((id) => option(id, h('span', { className: 'le-missing', textContent: `'${id}' (no longer exists)` }))),
  ];
  return h('section', { className: 'le-section le-weapons', 'aria-label': 'Weapons' },
    h('h3', {}, 'Weapons available in this level'),
    items.length
      ? h('ul', { className: 'le-weapon-list' }, items)
      : h('p', { className: 'muted' }, 'No weapons yet — create one on the Weapons tab first.'));
}

function wavesSection() {
  const enemies = catalog().enemies;
  const waves = Array.isArray(ed.draft.waves) ? ed.draft.waves : [];
  const total = waves.flat().reduce((n, g) => n + (Number.isFinite(g?.count) ? g.count : 0), 0);
  return h('section', { className: 'le-section le-waves', 'aria-label': 'Waves' },
    h('h3', {}, `Waves (${waves.length})${total ? ` · ${total} guests in total` : ''}`),
    enemies.length ? null : h('p', { className: 'muted' }, 'No guests yet — create one on the Enemies tab first.'),
    waves.length
      ? h('ol', { className: 'le-wave-list' }, waves.map((wave, wi) => waveCard(wave, wi, waves.length, enemies)))
      : h('p', { className: 'muted' }, 'No waves yet.'),
    h('button', {
      type: 'button', className: 'secondary',
      textContent: waves.length ? '+ Add wave (copy of the last one)' : '+ Add wave',
      disabled: !waves.length && !enemies.length,
      onclick: () => update(addWave(ed.draft, enemies[0]?.id), { render: ['waves'] }),
    }));
}

function waveCard(wave, wi, count, enemies) {
  const label = `Wave ${wi + 1}`;
  const summary = h('span', { className: 'le-wave-summary', textContent: waveSummary(wave, enemies) });
  const refreshSummary = () => { summary.textContent = waveSummary(ed.draft.waves[wi], enemies); };
  const structural = (next) => update(next, { render: ['waves'] });
  const btn = (text, title, disabled, onclick) => h('button', {
    type: 'button', className: 'secondary le-icon', textContent: text, title, 'aria-label': title, disabled, onclick,
  });
  const groups = Array.isArray(wave) ? wave : [];
  return h('li', { className: 'le-wave' },
    h('div', { className: 'le-wave-head' },
      h('strong', { textContent: label }), summary,
      h('span', { className: 'le-spacer' }),
      btn('↑', `Move ${label} up`, wi === 0, () => structural(moveWave(ed.draft, wi, -1))),
      btn('↓', `Move ${label} down`, wi === count - 1, () => structural(moveWave(ed.draft, wi, 1))),
      btn('✕', `Remove ${label}`, false, () => structural(removeWave(ed.draft, wi)))),
    groups.length
      ? h('table', { className: 'le-groups' },
        h('thead', {}, h('tr', {},
          ['Guest', 'Count', 'Interval (s)', 'Delay (s)', ''].map((t) => h('th', { textContent: t })))),
        h('tbody', {}, groups.map((g, gi) => groupRow(g, wi, gi, enemies, refreshSummary, structural))))
      : h('p', { className: 'muted' }, 'This wave has no guests.'),
    h('button', {
      type: 'button', className: 'secondary le-add-group', textContent: '+ Add guests',
      disabled: !enemies.length, onclick: () => structural(addGroup(ed.draft, wi, enemies[0]?.id)),
    }));
}

function groupRow(g, wi, gi, enemies, refreshSummary, structural) {
  const at = `Wave ${wi + 1}, group ${gi + 1}`;
  const remove = h('button', {
    type: 'button', className: 'secondary le-icon', textContent: '✕', title: `Remove ${at}`, 'aria-label': `Remove ${at}`,
    onclick: () => structural(removeGroup(ed.draft, wi, gi)),
  });
  if (!g || typeof g !== 'object') {
    return h('tr', {}, h('td', { colSpan: 4, className: 'le-missing', textContent: 'Malformed group' }), h('td', {}, remove));
  }
  // Field edits don't re-render the section (keeps focus while tabbing); only the summary updates.
  const set = (patch) => { update(updateGroup(ed.draft, wi, gi, patch), { render: [] }); refreshSummary(); };
  const select = h('select', { 'aria-label': `${at}: guest`, onchange: () => set({ enemyId: select.value }) },
    enemies.map((e) => h('option', { value: e.id, textContent: `${e.sprite ?? ''} ${e.name ?? e.id}`.trim() })),
    enemies.some((e) => e.id === g.enemyId) ? null
      : h('option', { value: String(g.enemyId), textContent: `'${g.enemyId}' (no longer exists)` }));
  select.value = String(g.enemyId);
  const num = (key, name, attrs) => h('td', {}, numberInput(
    () => ed.draft.waves?.[wi]?.[gi]?.[key], (n) => set({ [key]: n }), { 'aria-label': `${at}: ${name}`, ...attrs }));
  return h('tr', {},
    h('td', {}, select),
    num('count', 'count', { min: 1, step: 1 }),
    num('intervalS', 'seconds between guests', { min: 0.1, step: 0.1 }),
    num('delayS', 'delay before the group starts (s)', { min: 0, step: 0.5 }),
    h('td', {}, remove));
}

function mapSection() {
  const tool = TOOLS.find((t) => t.id === ed.tool);
  const toolbar = h('div', { className: 'le-tools', role: 'toolbar', 'aria-label': 'Map tools' },
    TOOLS.map((t) => h('button', {
      type: 'button', 'aria-pressed': String(t.id === ed.tool), title: `${t.label} (${t.key.toUpperCase()})`,
      onclick: () => { ed.tool = t.id; renderPart('map'); },
    }, t.label, h('kbd', { textContent: t.key.toUpperCase() }))));
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
    if (active()) renderPart('save'); // refresh Undo button state
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
  // Keep a new or edited draft across tab switches. A clean saved level is reloaded, so repairs
  // reflect the current catalog (a weapon/guest may have been deleted on another tab).
  const stored = ed.draft && savedLevels().find((l) => l.id === ed.draft.id);
  const keep = ed.draft && (ed.isNew || isDirty());
  if (!keep) {
    if (stored) load(stored);
    else selectFirstOrNew();
  }
  renderAll();
}
