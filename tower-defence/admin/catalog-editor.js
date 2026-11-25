// Weapon and enemy catalog editors. Reads from `state` in admin.js; saves through
// state.dataSource and calls refresh() afterwards. DB strings only ever go through
// textContent / .value (never innerHTML).
import { state, refresh } from './admin.js';
import {
  validateWeapon, validateEnemy, levelsUsing, levelsHiddenByDelete, EFFECTS, TIMED_EFFECTS,
  IMMUNITY_EFFECTS, MAX_QUOTES, MAX_QUOTE_LENGTH,
} from './catalog-validate.js';
import { ALLOWED_TYPES, validateImageFile } from './upload-validate.js';
import { uploadSprite, removeSprite } from './upload.js';
import { isUrl } from '../shared/mapping.js';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

const toNum = (s) => (String(s).trim() === '' ? NaN : Number(s));

const levelsUsingWeapon = (id) => levelsUsing(state.data.levels, { weaponId: id });
const levelsUsingEnemy = (id) => levelsUsing(state.data.levels, { enemyId: id });
const hiddenIfWeaponDeleted = (id) => levelsHiddenByDelete(state.data.levels, state.data, { weaponId: id });
const hiddenIfEnemyDeleted = (id) => levelsHiddenByDelete(state.data.levels, state.data, { enemyId: id });

// Confirm text for deleting an item: which levels use it, and which of those would be
// hidden from the game (no weapons / no waves left) until repaired in the level editor.
function deleteWarning(name, used, hidden, leftWithout) {
  if (used.length === 0) return `Delete "${name}"?`;
  let text = `"${name}" is used by: ${used.join(', ')}.`;
  if (hidden.length) {
    text += `\n\nThese levels would have no ${leftWithout} left and will be hidden from the game`
      + ` until repaired in the level editor: ${hidden.join(', ')}.`;
  }
  if (hidden.length < used.length) text += '\n\nThe other levels just lose it.';
  return `${text}\n\nDelete anyway?`;
}

// A labelled input bound to draft[key]. kind: 'text' | 'number' | 'textarea'.
function field(draft, key, label, kind = 'text', extra = {}) {
  const input = kind === 'textarea'
    ? h('textarea', { rows: 2, value: draft[key] ?? '' })
    : h('input', { type: kind === 'number' ? 'number' : 'text', step: 'any', value: draft[key] ?? '', ...extra });
  input.oninput = () => { draft[key] = kind === 'number' ? toNum(input.value) : input.value; };
  const wrap = h('label', { className: 'field' }, h('span', {}, label), input);
  return { wrap, input };
}

// Legacy items may lack fallbackSprite: an emoji sprite is its own fallback, an image URL
// gets the default. Called before the form's dirty snapshot, so it doesn't count as a change.
function initFallbackSprite(item, dflt) {
  if (typeof item.fallbackSprite === 'string' && item.fallbackSprite.trim()) return;
  const sprite = typeof item.sprite === 'string' ? item.sprite.trim() : '';
  item.fallbackSprite = sprite && !isUrl(sprite) ? sprite : dflt;
}

// Before save: trimmed fallback; an emoji sprite always equals the fallback emoji.
function normalizeSprite(item) {
  if (typeof item.fallbackSprite === 'string') item.fallbackSprite = item.fallbackSprite.trim();
  if (!isUrl(item.sprite) && !isUrl(item.fallbackSprite)) item.sprite = item.fallbackSprite;
}

// A sprite as DOM: an <img> for an image URL (falls back to the emoji if it fails to load),
// else the emoji text.
function spriteView(sprite, fallback, className) {
  if (!isUrl(sprite)) return h('span', { className, textContent: sprite ?? '' });
  const img = h('img', { className, src: sprite, alt: '' });
  img.onerror = () => img.replaceWith(h('span', { className, textContent: fallback ?? '' }));
  return img;
}

/**
 * Image box (Upload / Clear + preview) and the fallback emoji input, bound to draft.sprite and
 * draft.fallbackSprite. ctx.setBusy(bool) blocks the form's Save while an upload runs;
 * renderForm calls ctx.setSaving(bool) to block Upload/Clear while a save runs.
 * ctx.savedSprite is the sprite the DB currently points at (renderForm updates it as soon as a
 * save succeeds): images uploaded in this form and replaced before saving are removed right
 * away (nothing references them); the saved one is only removed by renderForm after a save
 * that replaced it succeeds.
 */
function spriteFields(draft, ctx, dflt) {
  initFallbackSprite(draft, dflt);
  const preview = h('div', { className: 'sprite-preview' });
  const message = h('p', { className: 'error', role: 'alert' });
  const fileInput = h('input', { type: 'file', accept: ALLOWED_TYPES.join(','), hidden: true });
  const upload = h('button', { type: 'button', className: 'secondary', textContent: 'Upload image' });
  const clear = h('button', { type: 'button', className: 'secondary', textContent: 'Clear image' });
  let busy = false; // uploading
  let saving = false; // the form's save is in flight
  // Whether draft.sprite is an image (vs. mirroring the fallback emoji), tracked separately so
  // a URL typed into the fallback box never becomes the image.
  let hasImage = isUrl(draft.sprite);

  const sync = () => {
    preview.replaceChildren(spriteView(draft.sprite, draft.fallbackSprite, 'sprite-img'));
    const off = busy || saving || state.readOnly;
    upload.disabled = off;
    clear.disabled = off || !hasImage;
    fileInput.disabled = off;
  };
  const setBusy = (b) => { busy = b; ctx.setBusy(b); sync(); };
  ctx.setSaving = (b) => { saving = b; sync(); };
  // Drop an image uploaded in this form that is about to be replaced (never the saved one).
  const discardUnsaved = (url) => {
    if (isUrl(url) && url !== ctx.savedSprite) removeSprite(state.client, url);
  };

  upload.onclick = () => { message.textContent = ''; fileInput.click(); };
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    message.textContent = '';
    const problem = validateImageFile(file);
    if (problem) { message.textContent = problem; return; }
    setBusy(true);
    try {
      const result = await uploadSprite(state.client, file);
      if (!result.ok) { message.textContent = result.error; return; }
      if (hasImage) discardUnsaved(draft.sprite);
      draft.sprite = result.url;
      hasImage = true;
    } catch (e) {
      message.textContent = `Upload failed: ${e?.message ?? e}`;
    } finally {
      setBusy(false);
    }
  };
  clear.onclick = () => {
    message.textContent = '';
    if (hasImage) discardUnsaved(draft.sprite);
    draft.sprite = draft.fallbackSprite;
    hasImage = false;
    sync();
  };

  const fallback = h('input', {
    type: 'text', value: draft.fallbackSprite ?? '', maxLength: 16, className: 'emoji-input', disabled: state.readOnly,
  });
  fallback.oninput = () => {
    draft.fallbackSprite = fallback.value;
    // Without an image the sprite is the emoji. A URL typed here is never mirrored (validation
    // rejects it as a fallback); the sprite keeps the last emoji until it's fixed.
    if (!hasImage && !isUrl(fallback.value)) draft.sprite = fallback.value;
    sync();
  };
  sync();

  return [
    h('fieldset', { className: 'image-box' }, h('legend', {}, 'Image'),
      preview,
      h('div', { className: 'actions' }, upload, clear),
      h('p', { className: 'muted' }, 'PNG, JPEG, SVG or WebP, up to 1 MB. Without an image the fallback emoji is shown.'),
      fileInput, message),
    h('label', { className: 'field' }, h('span', {}, 'Fallback emoji (shown when there is no image or it fails to load)'), fallback),
  ];
}

// Speech-bubble lines for a guest: add, edit, remove.
function quotesField(draft) {
  draft.quotes ??= [];
  const list = h('div', { className: 'quotes' });
  const add = h('button', { type: 'button', className: 'secondary', textContent: '+ Add quote' });
  const renderQuotes = () => {
    list.replaceChildren(...draft.quotes.map((q, i) => {
      const input = h('input', { type: 'text', value: q, maxLength: MAX_QUOTE_LENGTH, placeholder: 'Something this guest says', disabled: state.readOnly });
      input.oninput = () => { draft.quotes[i] = input.value; };
      const rm = h('button', { type: 'button', className: 'secondary', textContent: 'Remove', disabled: state.readOnly });
      rm.onclick = () => { draft.quotes.splice(i, 1); renderQuotes(); };
      return h('div', { className: 'quote-row' }, input, rm);
    }));
    add.disabled = state.readOnly || draft.quotes.length >= MAX_QUOTES;
  };
  add.onclick = () => {
    draft.quotes.push('');
    renderQuotes();
    list.lastElementChild?.querySelector('input')?.focus();
  };
  renderQuotes();
  return h('fieldset', {}, h('legend', {}, `Quotes (speech bubbles; up to ${MAX_QUOTES}, ${MAX_QUOTE_LENGTH} characters each)`),
    list, add);
}

// One checkbox per effect the guest ignores (damage still applies).
function immunityField(draft) {
  draft.immuneTo ??= [];
  const boxes = IMMUNITY_EFFECTS.map((fx) => {
    const cb = h('input', { type: 'checkbox', checked: draft.immuneTo.includes(fx), disabled: state.readOnly });
    cb.onchange = () => {
      const set = new Set(draft.immuneTo);
      if (cb.checked) set.add(fx); else set.delete(fx);
      draft.immuneTo = IMMUNITY_EFFECTS.filter((x) => set.has(x));
    };
    return h('label', { className: 'check' }, cb, ` ${fx}`);
  });
  return h('fieldset', { className: 'immunities' }, h('legend', {}, 'Immune to (still takes damage)'), ...boxes);
}

/**
 * Generic list + form editor.
 * cfg: { noun, items(), blank(), buildFields(draft, form) -> Node[], normalize(draft), validate,
 *        usedBy(id) -> level names, hiddenBy(id) -> level names hidden if it's deleted,
 *        leftWithout ('weapons' | 'waves'), save(item), remove(id) }
 */
function mountCatalog(el, cfg) {
  let selectedId = null; // null = nothing; '__new__' = new draft

  let isDirty = () => false; // set by renderForm for the form currently shown

  function select(id) {
    if (isDirty() && !confirm('Discard unsaved changes?')) return;
    selectedId = id;
    render();
  }

  // Runs a save/delete, shows any failure inline, always re-enables the button.
  // onWritten runs as soon as the DB write succeeded (even if the reload then fails);
  // onOk only after the reload, right before the re-render.
  async function write(op, errorEl, btn, onOk, onWritten = () => {}) {
    btn.disabled = true;
    try {
      let result;
      try {
        result = await op();
      } catch (e) {
        errorEl.textContent = e?.message ?? String(e);
        return;
      }
      if (!result?.ok) { errorEl.textContent = result?.error ?? 'Save failed'; return; }
      onWritten();
      try {
        await refresh();
      } catch (e) {
        errorEl.textContent = `Saved, but couldn't reload: ${e?.message ?? e}`;
        return;
      }
      isDirty = () => false;
      onOk();
      render();
    } finally {
      btn.disabled = state.readOnly;
    }
  }

  function renderForm(isNew, source) {
    const draft = structuredClone(source);
    const error = h('p', { className: 'error', role: 'alert' });
    const form = h('form', { className: 'catalog-form' });
    form.append(h('h2', {}, isNew ? `New ${cfg.noun}` : draft.name || cfg.noun));
    if (!isNew) form.append(h('p', { className: 'muted' }, `id: ${draft.id}`));
    const save = h('button', { type: 'submit', textContent: 'Save', disabled: state.readOnly });
    let uploading = false;
    const ctx = {
      // The sprite the DB points at; updated as soon as a save succeeds (see onsubmit).
      savedSprite: isNew ? null : source.sprite,
      setBusy: (b) => { uploading = b; save.disabled = b || state.readOnly; },
      setSaving: () => {}, // replaced by spriteFields
    };
    form.append(...cfg.buildFields(draft, ctx));
    const snapshot = JSON.stringify(draft);
    isDirty = () => JSON.stringify(draft) !== snapshot;

    const actions = h('div', { className: 'actions' }, save);
    if (!isNew) {
      const del = h('button', { type: 'button', className: 'secondary', textContent: 'Delete', disabled: state.readOnly });
      del.onclick = async () => {
        error.textContent = '';
        const warn = deleteWarning(draft.name, cfg.usedBy(draft.id), cfg.hiddenBy(draft.id), cfg.leftWithout);
        if (!confirm(warn)) return;
        await write(() => cfg.remove(draft.id), error, del, () => { selectedId = null; });
      };
      actions.append(del);
    }
    form.append(actions, error);
    if (state.readOnly) form.append(h('p', { className: 'muted' }, 'Read-only: database unreachable.'));

    form.onsubmit = async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (uploading) return;
      cfg.normalize(draft);
      const problems = cfg.validate(draft);
      if (problems.length) { error.textContent = problems.join('; '); return; }
      // What this save writes; the draft may change while the save is in flight.
      const persisted = draft.sprite;
      ctx.setSaving(true);
      try {
        await write(() => cfg.save(draft), error, save, () => { selectedId = draft.id; }, () => {
          const previous = ctx.savedSprite;
          ctx.savedSprite = persisted;
          // The previously saved image was replaced or cleared: delete it now that the DB no
          // longer points at it (best effort, not awaited).
          if (isUrl(previous) && previous !== persisted) removeSprite(state.client, previous);
        });
      } finally {
        ctx.setSaving(false);
      }
    };
    return form;
  }

  function render() {
    const list = h('ul', { className: 'catalog-list' });
    for (const item of cfg.items()) {
      const b = h('button', { type: 'button', className: 'secondary' },
        spriteView(item.sprite, item.fallbackSprite, 'sprite-thumb'), ` ${item.name}`);
      if (item.id === selectedId) b.setAttribute('aria-current', 'true');
      b.onclick = () => select(item.id);
      list.append(h('li', {}, b));
    }
    const add = h('button', { type: 'button', textContent: `+ New ${cfg.noun}`, disabled: state.readOnly });
    add.onclick = () => select('__new__');

    isDirty = () => false;
    let editor = h('p', { className: 'muted' }, `Pick a ${cfg.noun} or create a new one.`);
    if (selectedId === '__new__') {
      editor = renderForm(true, { ...cfg.blank(), id: crypto.randomUUID() });
    } else if (selectedId !== null) {
      const item = cfg.items().find((i) => i.id === selectedId);
      if (item) editor = renderForm(false, item);
    }
    el.replaceChildren(h('div', { className: 'catalog' }, h('aside', {}, add, list), h('div', { className: 'catalog-editor' }, editor)));
  }

  render();
}

function weaponFields(draft, ctx) {
  draft.upgrades ??= [];
  const out = [
    field(draft, 'name', 'Name').wrap,
    field(draft, 'description', 'Description', 'textarea').wrap,
    ...spriteFields(draft, ctx, '❔'),
    field(draft, 'cost', 'Cost (caps 🧢)', 'number', { min: 1, step: 1 }).wrap,
    field(draft, 'range', 'Range (tiles)', 'number', { min: 0 }).wrap,
    field(draft, 'damage', 'Damage', 'number', { min: 0 }).wrap,
    field(draft, 'fireRate', 'Fire rate (shots/s)', 'number', { min: 0 }).wrap,
  ];

  const effectSelect = h('select', {}, ...EFFECTS.map((v) => h('option', { value: v, textContent: v })));
  effectSelect.value = draft.effect;
  const strength = field(draft, 'effectStrength', 'Effect strength', 'number', { min: 0 });
  const duration = field(draft, 'effectDuration', 'Effect duration (s)', 'number', { min: 0 });
  const effectBox = h('div', { className: 'effect-fields' }, strength.wrap, duration.wrap);
  const STRENGTH_LABELS = {
    slow: 'Slow strength (0–1: 0.4 = 40% slower)',
    splash: 'Splash radius (tiles)',
    distract: 'Effect strength (unused by distract)',
    lure: 'Effect strength (unused by lure)',
  };
  // Splash hits once, so it has no duration; slow/distract/lure last effectDuration seconds.
  const syncEffect = () => {
    effectBox.hidden = draft.effect === 'none';
    duration.wrap.hidden = !TIMED_EFFECTS.includes(draft.effect);
    strength.wrap.firstChild.textContent = STRENGTH_LABELS[draft.effect] ?? 'Effect strength';
  };
  effectSelect.onchange = () => { draft.effect = effectSelect.value; syncEffect(); };
  syncEffect();
  out.push(h('label', { className: 'field' }, h('span', {}, 'Effect'), effectSelect), effectBox);

  // Upgrades: ordered tiers, cost required, other stats optional absolute overrides.
  const tbody = h('tbody');
  const cols = [['cost', 'Cost'], ['damage', 'Damage'], ['range', 'Range'], ['fireRate', 'Fire rate'], ['effectStrength', 'Effect str.']];
  const renderTiers = () => {
    tbody.replaceChildren(...draft.upgrades.map((tier, i) => {
      const cells = cols.map(([k]) => {
        const input = h('input', { type: 'number', step: 'any', value: tier[k] ?? '', placeholder: k === 'cost' ? 'required' : 'as before' });
        input.oninput = () => {
          if (input.value.trim() === '' && k !== 'cost') delete tier[k];
          else tier[k] = toNum(input.value);
        };
        return h('td', {}, input);
      });
      const rm = h('button', { type: 'button', className: 'secondary', textContent: 'Remove' });
      rm.onclick = () => { draft.upgrades.splice(i, 1); renderTiers(); };
      return h('tr', {}, h('td', { textContent: String(i + 1) }), ...cells, h('td', {}, rm));
    }));
  };
  renderTiers();
  const addTier = h('button', { type: 'button', className: 'secondary', textContent: '+ Add tier' });
  addTier.onclick = () => { draft.upgrades.push({ cost: NaN }); renderTiers(); };
  out.push(h('fieldset', {}, h('legend', {}, 'Upgrades (absolute values; blank = unchanged)'),
    h('table', { className: 'tiers' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), ...cols.map(([, l]) => h('th', {}, l)), h('th'))), tbody),
    addTier));
  return out;
}

export function mountWeapons(el) {
  mountCatalog(el, {
    noun: 'weapon',
    items: () => state.data.weapons,
    blank: () => ({
      name: '', description: '', sprite: '🍺', fallbackSprite: '🍺', cost: 50, range: 2.5, damage: 5, fireRate: 1,
      effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [],
    }),
    normalize: (w) => {
      if (w.effect === 'none') { w.effectStrength = 0; w.effectDuration = 0; }
      if (w.effect === 'splash') w.effectDuration = 0; // splash has no lasting effect
      normalizeSprite(w);
    },
    buildFields: weaponFields,
    validate: validateWeapon,
    usedBy: levelsUsingWeapon,
    hiddenBy: hiddenIfWeaponDeleted,
    leftWithout: 'weapons',
    save: (w) => state.dataSource.saveWeapon(w),
    remove: (id) => state.dataSource.deleteWeapon(id),
  });
}

export function mountEnemies(el) {
  mountCatalog(el, {
    noun: 'enemy',
    items: () => state.data.enemies,
    blank: () => ({
      name: '', description: '', sprite: '👤', fallbackSprite: '👤', hp: 20, speed: 1, reward: 5, wineDamage: 1,
      quotes: [], immuneTo: [],
    }),
    normalize: (e) => {
      normalizeSprite(e);
      // Blank quote lines are dropped rather than reported.
      e.quotes = (e.quotes ?? []).map((q) => String(q).trim()).filter(Boolean);
    },
    buildFields: (draft, ctx) => [
      field(draft, 'name', 'Name').wrap,
      field(draft, 'description', 'Description', 'textarea').wrap,
      ...spriteFields(draft, ctx, '👤'),
      field(draft, 'hp', 'HP', 'number', { min: 0 }).wrap,
      field(draft, 'speed', 'Speed (tiles/s)', 'number', { min: 0 }).wrap,
      field(draft, 'reward', 'Reward (caps 🧢)', 'number', { min: 1, step: 1 }).wrap,
      field(draft, 'wineDamage', 'Kegs drained per guest (🍺 lost when it reaches the beer bar)', 'number', { min: 1, step: 1 }).wrap,
      quotesField(draft),
      immunityField(draft),
    ],
    validate: validateEnemy,
    usedBy: levelsUsingEnemy,
    hiddenBy: hiddenIfEnemyDeleted,
    leftWithout: 'waves',
    save: (e) => state.dataSource.saveEnemy(e),
    remove: (id) => state.dataSource.deleteEnemy(id),
  });
}
