// Levels tab of the admin: level list + tile-map editor.
// All level edits go through the pure functions in editor-state.js; this file only does DOM.
// Never use innerHTML here: names come from the database.
import { state, refresh } from './admin.js';
import {
  newLevel, duplicateLevel, applyTool, extendPath, toggleBlocked, eraseTile,
  resizeLevel, canSave, MIN_SIZE, MAX_SIZE, prepareForEditor,
  setWeapons, addWave, removeWave, moveWave, addGroup, updateGroup, removeGroup, waveSummary,
  setGuests, guestWaves, applyGenerated, DEFAULT_BAR_SPRITE, spawnWarnings,
} from './editor-state.js';
import { SIZES, DIFFICULTIES, canGenerate, generateLevel, randomSeed } from '../shared/generator.js';
import { isUrl } from '../shared/mapping.js';
import { ALLOWED_TYPES, validateImageFile } from './upload-validate.js';
import { uploadSprite, removeSprite } from './upload.js';

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
  // Generate panel settings. `seed` is the last one used (shown as "Party #seed"). `result` is
  // the draft that generation produced and `base` the draft as loaded (incl. editor repairs, e.g.
  // a legacy level's derived guest list): replacing either loses nothing the admin made, so
  // Generate/Re-roll doesn't ask first. Guest/weapon list toggles carry both along (the lists
  // are the generator's input and survive generation).
  gen: { size: 'medium', difficulty: 'party', twistiness: 0.5, waves: 6, seed: null, result: null, base: null },
  // Bar image. `barEmoji` is the emoji shown without an image (or when it fails to load); it
  // is the draft's barSprite whenever that isn't an image URL.
  barEmoji: DEFAULT_BAR_SPRITE,
  barMessage: '',    // upload error
  uploading: false,  // a bar image upload is in flight (blocks Save and level switching)
  barUploads: new Set(), // bar images uploaded this session: removed once nothing references them
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
  ed.barEmoji = isUrl(draft.barSprite) ? DEFAULT_BAR_SPRITE : draft.barSprite;
  ed.barMessage = '';
  ed.gen.seed = null;
  ed.gen.result = null;
  ed.gen.base = draft;
}

function confirmDiscard() {
  if (ed.busy || ed.uploading) return false; // never switch level while a save/delete/upload is in flight
  return !isDirty() || confirm(`"${ed.draft.name || 'This level'}" has unsaved changes. Discard them?`);
}

const blankLevel = (sortOrder) => ({
  ...newLevel(), sortOrder,
  weaponIds: catalog().weapons.map((w) => w.id),
  enemyIds: catalog().enemies.map((e) => e.id),
});

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
  removeUnusedBarImages([level.barSprite]);
  ed.message = reloadError
    ? { kind: 'error', text: `Deleted "${level.name}", but couldn't reload the levels: ${reloadError}` }
    : { kind: 'ok', text: `Deleted "${level.name}".` };
  renderAll();
}

// Called after a successful save/delete (state.data reloaded). Best effort, never awaited:
// deletes the given bar images and this session's uploads unless a level in the database, a
// catalog sprite or the current draft still points at them. Undo entries that pointed at a
// deleted image get the emoji instead, so Undo never brings back a dead URL.
function removeUnusedBarImages(candidates) {
  const used = new Set([
    ...(state.data?.levels ?? []).map((l) => l.barSprite),
    ...(state.data?.weapons ?? []).map((w) => w.sprite),
    ...(state.data?.enemies ?? []).map((e) => e.sprite),
    ed.draft?.barSprite,
  ]);
  const gone = new Set();
  for (const url of new Set([...candidates, ...ed.barUploads])) {
    if (!isUrl(url) || used.has(url)) continue;
    ed.barUploads.delete(url);
    gone.add(url);
    removeSprite(state.client, url);
  }
  if (gone.size) {
    const emoji = ed.barEmoji && !isUrl(ed.barEmoji) ? ed.barEmoji : DEFAULT_BAR_SPRITE;
    ed.history = ed.history.map((l) => (gone.has(l.barSprite) ? { ...l, barSprite: emoji } : l));
  }
}

async function saveCurrent() {
  const level = ed.draft;
  if (state.readOnly || ed.busy || ed.uploading || !canSave(level, catalog()).ok) return;
  // The bar image the database points at before this save (removed after it if replaced).
  const previousBar = savedLevels().find((l) => l.id === level.id)?.barSprite;
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
    removeUnusedBarImages([previousBar]);
  } else {
    ed.message = { kind: 'error', text: `Save failed: ${res.error}` };
  }
  renderAll();
}

function playCurrent() {
  // Resolved against this module (tower-defence/admin/level-editor.js), not the page URL,
  // so it works whether the admin page was opened as /admin or /admin/.
  const url = new URL(`../play.html?level=${encodeURIComponent(ed.draft.id)}&preview=1`, import.meta.url);
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
  { id: 'generate', render: generateSection },
  { id: 'map', render: mapSection },
  { id: 'settings', render: settingsSection },
  { id: 'lineup', render: lineupSection },
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
  const { ok, errors: problems } = canSave(level, catalog());
  const errors = [...problems, ...spawnWarnings(level)];
  const dirty = isDirty();
  const saved = isSaved(level.id);
  const saveBtn = h('button', {
    type: 'button',
    textContent: ed.busy ? 'Saving…' : 'Save',
    disabled: !ok || !(dirty || !saved) || state.readOnly || ed.busy || ed.uploading,
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
      field('startingCorks', 'Starting caps 🧢', 'Bottle caps to spend on weapons at the start'),
      field('startingWine', 'Starting kegs 🍺', 'Lives: each guest that reaches the beer bar drains some kegs')),
    barImageFields());
}

// ---------- bar image ----------

// An <img> for an image URL (the emoji if it fails to load), else the emoji itself.
function barView(sprite) {
  const fallback = ed.barEmoji || DEFAULT_BAR_SPRITE;
  if (!isUrl(sprite)) return h('span', { className: 'le-bar-img', textContent: sprite || fallback });
  const img = h('img', { className: 'le-bar-img', src: sprite, alt: 'Bar image' });
  img.onerror = () => img.replaceWith(h('span', { className: 'le-bar-img', textContent: fallback }));
  return img;
}

function barImageFields() {
  // Keep the emoji box in step with the draft (e.g. after Undo); with an image it keeps its value.
  if (!isUrl(ed.draft.barSprite)) ed.barEmoji = ed.draft.barSprite ?? '';
  const hasImage = isUrl(ed.draft.barSprite);
  const off = state.readOnly || ed.uploading || ed.busy;
  const preview = h('div', { className: 'le-bar-preview' }, barView(ed.draft.barSprite));
  const fileInput = h('input', { type: 'file', accept: ALLOWED_TYPES.join(','), hidden: true, disabled: off });
  fileInput.onchange = () => uploadBarImage(fileInput);
  // The emoji updates on every keystroke without re-rendering (keeps focus); one undo entry
  // per focus session, like the name.
  let recorded = false;
  const emoji = h('input', {
    type: 'text', className: 'le-emoji', value: ed.barEmoji ?? '', maxLength: 16, disabled: state.readOnly,
    'aria-label': 'Bar emoji', onblur: () => { recorded = false; },
  });
  emoji.oninput = () => {
    ed.barEmoji = emoji.value.trim();
    // Without an image the bar sprite is the emoji. A URL typed here never becomes the image.
    if (!isUrl(ed.draft.barSprite) && !isUrl(ed.barEmoji)) {
      update({ ...ed.draft, barSprite: ed.barEmoji }, { record: !recorded, render: [] });
      recorded = true;
    }
    preview.replaceChildren(barView(ed.draft.barSprite));
  };
  return h('div', { className: 'le-bar' },
    h('span', { className: 'le-bar-title', textContent: 'Beer bar' }),
    preview,
    h('label', {}, 'Emoji', emoji),
    h('div', { className: 'le-bar-actions' },
      h('button', {
        type: 'button', className: 'secondary', textContent: ed.uploading ? 'Uploading…' : 'Upload image',
        disabled: off, onclick: () => { ed.barMessage = ''; fileInput.click(); },
      }),
      h('button', {
        type: 'button', className: 'secondary', textContent: 'Clear image',
        disabled: off || !hasImage, onclick: clearBarImage,
      })),
    h('p', { className: 'muted le-bar-note' },
      'PNG, JPEG, SVG or WebP, up to 1 MB. Without an image (or if it fails to load) the emoji is shown.'),
    fileInput,
    ed.barMessage ? h('p', { className: 'error', role: 'alert', textContent: ed.barMessage }) : null);
}

async function uploadBarImage(fileInput) {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file || state.readOnly || ed.uploading) return;
  ed.barMessage = '';
  const problem = validateImageFile(file);
  if (problem) { ed.barMessage = problem; renderPart('settings'); return; }
  const levelId = ed.draft.id;
  ed.uploading = true;
  renderPart('settings');
  renderPart('save');
  try {
    const result = await uploadSprite(state.client, file);
    if (!result.ok) { ed.barMessage = result.error; return; }
    ed.barUploads.add(result.url);
    // Level switching is blocked while uploading, but never put the image on another level.
    if (ed.draft?.id === levelId) update({ ...ed.draft, barSprite: result.url }, { render: [] });
  } catch (e) {
    ed.barMessage = `Upload failed: ${errorText(e)}`;
  } finally {
    ed.uploading = false;
    if (active()) { renderPart('settings'); renderPart('save'); }
  }
}

// Back to the emoji. The image file itself is removed after a save, once nothing uses it.
function clearBarImage() {
  ed.barMessage = '';
  const emoji = ed.barEmoji && !isUrl(ed.barEmoji) ? ed.barEmoji : DEFAULT_BAR_SPRITE;
  update({ ...ed.draft, barSprite: emoji }, { render: ['settings'] });
}

// ---------- guest list and weapon list ----------
// One place edits the level's own enemyIds / weaponIds: the "Guests & weapons" section. The
// Generate panel only summarises them (they are level data the generator reads, not generator
// settings), so there is never a second set of toggles to keep in sync.

const LIST_PARTS = ['generate', 'lineup', 'waves'];
const guestList = () => (Array.isArray(ed.draft.enemyIds) ? ed.draft.enemyIds : []);
const weaponList = () => (Array.isArray(ed.draft.weaponIds) ? ed.draft.weaponIds : []);
const guestName = (id) => catalog().enemies.find((e) => e.id === id)?.name ?? `'${id}'`;

// A list toggle on an untouched generated result (or the level as loaded) keeps it counting as
// that, so Re-roll/Generate doesn't then ask to discard "changes": generation keeps the lists.
function updateLists(next) {
  if (ed.draft === ed.gen.result) ed.gen.result = next;
  if (ed.draft === ed.gen.base) ed.gen.base = next;
  update(next, { render: LIST_PARTS });
}

function toggleGuest(id) {
  const listed = guestList();
  if (!listed.includes(id)) { updateLists(setGuests(ed.draft, [...listed, id])); return; }
  const waves = guestWaves(ed.draft, id);
  if (waves.length && !confirm(
    `${guestName(id)} ${waves.length === 1 ? 'is in wave' : 'is in waves'} ${waves.join(', ')}. `
    + 'Taking them off the guest list removes their groups from those waves '
    + '(a wave left without guests is removed too). Continue?')) return;
  updateLists(setGuests(ed.draft, listed.filter((x) => x !== id)));
}

function toggleWeapon(id) {
  const listed = weaponList();
  updateLists(setWeapons(ed.draft, listed.includes(id) ? listed.filter((x) => x !== id) : [...listed, id]));
}

// A catalog sprite for a chip: an image URL as a small <img> (its emoji on error), else the emoji.
function chipSprite(item) {
  if (!item) return '';
  if (!isUrl(item.sprite)) return item.sprite ?? '';
  const img = h('img', { src: item.sprite, alt: '' });
  img.onerror = () => img.replaceWith(item.fallbackSprite ?? '');
  return img;
}

// A sprite as plain text (for <option>s and summaries): an image URL shows its fallback emoji.
const spriteText = (item) => (isUrl(item?.sprite) ? item?.fallbackSprite ?? '' : item?.sprite ?? '');

function chip(item, label, on, onclick, { missing = false, extra = '' } = {}) {
  return h('button', {
    type: 'button', className: `le-chip${missing ? ' missing' : ''}`, 'aria-pressed': String(on),
    title: on ? `Take ${label} off the list` : `Add ${label}`, onclick,
  }, h('span', { className: 'le-chip-sprite' }, chipSprite(item)), h('span', { textContent: label }),
  extra ? h('span', { className: 'le-chip-extra', textContent: extra }) : null);
}

function chipGroup(kind) {
  const isGuests = kind === 'guests';
  const items = isGuests ? catalog().enemies : catalog().weapons;
  const listed = isGuests ? guestList() : weaponList();
  const toggle = isGuests ? toggleGuest : toggleWeapon;
  const extra = (it) => (isGuests ? '' : `${it.cost ?? '?'} 🧢`);
  const chips = [
    ...items.map((it) => chip(it, it.name ?? it.id, listed.includes(it.id), () => toggle(it.id), { extra: extra(it) })),
    ...listed.filter((id) => !items.some((it) => it.id === id))
      .map((id) => chip(null, `'${id}' (no longer exists)`, true, () => toggle(id), { missing: true })),
  ];
  if (!chips.length) {
    return h('p', { className: 'muted' }, isGuests ? 'No guests yet — create one on the Enemies tab first.'
      : 'No weapons yet — create one on the Weapons tab first.');
  }
  return h('div', {
    className: 'le-chips', role: 'group', 'aria-label': isGuests ? 'Guests in this level' : 'Weapons in this level',
  }, chips);
}

function lineupSection() {
  const g = guestList().length;
  const w = weaponList().length;
  return h('section', { className: 'le-section le-lineup', id: 'le-lineup', 'aria-label': 'Guests and weapons', tabIndex: -1 },
    h('h3', {}, 'Guests & weapons'),
    h('div', { className: 'le-lineup-grid' },
      h('div', {},
        h('div', { className: 'le-gen-label', textContent: `Guest list (${g})` }),
        h('p', { className: 'le-hint le-sub' }, 'Only listed guests can be put in waves or generated.'),
        chipGroup('guests')),
      h('div', {},
        h('div', { className: 'le-gen-label', textContent: `Weapons players can build (${w})` }),
        h('p', { className: 'le-hint le-sub' }, 'Cost in bottle caps 🧢.'),
        chipGroup('weapons'))));
}

// The Generate panel's read-only view of the two lists, with a jump to where they're edited.
function listSummary() {
  const row = (label, ids, items) => {
    const known = ids.map((id) => items.find((it) => it.id === id)).filter(Boolean);
    return h('div', { className: 'le-gen-uses-row' },
      h('strong', { textContent: `${label} (${known.length})` }),
      h('span', { className: 'le-gen-uses-sprites' },
        known.length ? known.map((it) => h('span', { className: 'le-chip-sprite', title: it.name ?? it.id }, chipSprite(it)))
          : h('span', { className: 'muted', textContent: 'none' })));
  };
  const jump = h('button', {
    type: 'button', className: 'secondary le-jump', textContent: 'Edit the lists ↓',
    onclick: () => {
      const target = ed.parts.lineup?.querySelector('.le-lineup');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    },
  });
  return h('div', { className: 'le-gen-uses' },
    h('div', { className: 'le-gen-label', textContent: "Uses this level's guests & weapons" }),
    row('Guests', guestList(), catalog().enemies),
    row('Weapons', weaponList(), catalog().weapons),
    jump);
}

// ---------- Generate panel ----------

const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function genOpts(seed) {
  const g = ed.gen;
  return {
    size: g.size, difficulty: g.difficulty, twistiness: g.twistiness, waves: g.waves, seed,
    enemyIds: guestList(), weaponIds: weaponList(),
  };
}

// Generate and Re-roll both draw a new seed. Over unsaved edits (other than an earlier
// generated result or editor repairs made on load) it asks first; the result is a normal
// unsaved draft (Undo restores).
function generate() {
  if (!canGenerate(genOpts(0), catalog()).ok) return;
  if (isDirty() && ed.draft !== ed.gen.result && ed.draft !== ed.gen.base && !confirm(
    `Generating replaces the map, waves and starting resources of "${ed.draft.name || 'this level'}". `
    + 'Discard your unsaved changes? (Undo brings them back.)')) return;
  const seed = randomSeed();
  let next;
  try {
    next = applyGenerated(ed.draft, generateLevel(genOpts(seed), catalog()));
  } catch (e) {
    ed.message = { kind: 'error', text: `Couldn't generate a level: ${errorText(e)}` };
    renderPart('banner');
    return;
  }
  ed.gen.seed = seed;
  ed.gen.result = next;
  ed.warnings = [];
  update(next, { render: ['details', 'map', 'settings', ...LIST_PARTS] });
  ed.message = { kind: 'ok', text: `Generated party #${seed}. Not saved yet: tweak it if you like, then Save.` };
  renderPart('banner');
}

function segmented(label, options, current, onpick) {
  return h('div', { className: 'le-seg', role: 'group', 'aria-label': label },
    options.map(([value, text]) => h('button', {
      type: 'button', 'aria-pressed': String(value === current), textContent: text,
      onclick: () => onpick(value),
    })));
}

function generateSection() {
  const g = ed.gen;
  const set = (patch) => { Object.assign(g, patch); renderPart('generate'); };
  const check = canGenerate(genOpts(0), catalog());
  const twisty = h('input', {
    type: 'range', min: 0, max: 1, step: 0.05, value: String(g.twistiness), 'aria-label': 'Path twistiness',
  });
  twisty.oninput = () => { g.twistiness = Number(twisty.value); };
  const waves = numberInput(() => g.waves, (n) => set({ waves: Math.round(n) }), {
    min: 1, max: 20, step: 1, 'aria-label': 'Number of waves', className: 'le-gen-waves',
  });
  const lbl = (text) => h('div', { className: 'le-gen-label', textContent: text });
  return h('section', { className: 'le-section le-generate', 'aria-label': 'Generate level' },
    h('h3', {}, '🎲 Generate level'),
    h('p', { className: 'le-hint' },
      "Builds a path, furniture and waves from these settings. Then it's a normal level: tweak it by hand, Save, Play."),
    h('div', { className: 'le-gen-grid' },
      h('div', {},
        lbl('Size'),
        segmented('Size', Object.entries(SIZES).map(([k, [c, r]]) => [k, `${SIZE_LABELS[k] ?? cap(k)} ${c}×${r}`]),
          g.size, (v) => set({ size: v })),
        lbl('Difficulty'),
        segmented('Difficulty', DIFFICULTIES.map((d) => [d, cap(d)]), g.difficulty, (v) => set({ difficulty: v }))),
      h('div', {},
        lbl('Path'),
        h('div', { className: 'le-gen-row' }, h('span', { textContent: 'Straight' }), twisty, h('span', { textContent: 'Twisty' })),
        lbl('Waves'),
        h('div', { className: 'le-gen-row' }, waves, h('span', { textContent: 'waves (1–20)' })))),
    listSummary(),
    h('div', { className: 'le-gen-actions' },
      h('button', {
        type: 'button', className: 'le-generate-btn', textContent: '🎲 Generate', disabled: !check.ok,
        title: check.ok ? 'Generate a new random level from these settings' : check.reason, onclick: generate,
      }),
      h('button', {
        type: 'button', className: 'secondary le-reroll-btn', textContent: '↻ Re-roll',
        disabled: !check.ok || g.seed === null,
        title: g.seed === null ? 'Generate a level first' : 'Same settings, new random party', onclick: generate,
      }),
      g.seed === null ? null : h('output', { className: 'le-seed', 'aria-label': 'Seed', textContent: `Party #${g.seed}` })),
    check.ok ? null : h('p', { className: 'le-reasons', role: 'status', textContent: check.reason }));
}

// Listed guests that exist in the catalog: the only ones the wave editor offers.
const listedEnemies = () => guestList().map((id) => catalog().enemies.find((e) => e.id === id)).filter(Boolean);

function wavesSection() {
  const enemies = listedEnemies();
  const waves = Array.isArray(ed.draft.waves) ? ed.draft.waves : [];
  const total = waves.flat().reduce((n, g) => n + (Number.isFinite(g?.count) ? g.count : 0), 0);
  return h('section', { className: 'le-section le-waves', 'aria-label': 'Waves' },
    h('h3', {}, `Waves (${waves.length})${total ? ` · ${total} guests in total` : ''}`),
    enemies.length ? null : h('p', { className: 'muted' }, 'Put guests on the guest list first.'),
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
  // The summary shows every known guest's sprite, listed or not (image guests as their emoji).
  const all = catalog().enemies.map((e) => ({ ...e, sprite: spriteText(e) }));
  const summary = h('span', { className: 'le-wave-summary', textContent: waveSummary(wave, all) });
  const refreshSummary = () => { summary.textContent = waveSummary(ed.draft.waves[wi], all); };
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
          ['Guest', 'Count', 'Interval (turns)', 'Delay (turns)', ''].map((t) => h('th', { textContent: t })))),
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
    enemies.map((e) => h('option', { value: e.id, textContent: `${spriteText(e)} ${e.name ?? e.id}`.trim() })),
    enemies.some((e) => e.id === g.enemyId) ? null
      : h('option', {
        value: String(g.enemyId),
        textContent: catalog().enemies.some((e) => e.id === g.enemyId)
          ? `${guestName(g.enemyId)} (not on the guest list)` : `'${g.enemyId}' (no longer exists)`,
      }));
  select.value = String(g.enemyId);
  const num = (key, name, attrs) => h('td', {}, numberInput(
    () => ed.draft.waves?.[wi]?.[gi]?.[key], (n) => set({ [key]: n }), { 'aria-label': `${at}: ${name}`, ...attrs }));
  return h('tr', {},
    h('td', {}, select),
    num('count', 'count', { min: 1, step: 1 }),
    num('intervalS', 'turns between guests', { min: 0.1, step: 0.1 }),
    num('delayS', 'delay before the group starts (turns)', { min: 0, step: 0.5 }),
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

// Swatch colours come from the same CSS variables as the map tiles (level-editor.css).
function legend() {
  const item = (cls, text) => h('li', {}, h('i', { className: `le-swatch ${cls}` }), text);
  return h('ul', { className: 'le-legend' },
    item('start', 'S door (start)'), item('end', 'E beer bar (end)'), item('path', 'path (numbered in order)'),
    item('blocked', '✕ furniture (blocked)'), item('floor', 'floor (buildable)'));
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
