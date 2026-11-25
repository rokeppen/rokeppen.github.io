// Weapon and enemy catalog editors. Reads from `state` in admin.js; saves through
// state.dataSource and calls refresh() afterwards. DB strings only ever go through
// textContent / .value (never innerHTML).
import { state, refresh } from './admin.js';
import { validateWeapon, validateEnemy, EFFECTS } from './catalog-validate.js';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

const toNum = (s) => (String(s).trim() === '' ? NaN : Number(s));

function levelsUsingWeapon(id) {
  return state.data.levels.filter((l) => l.weaponIds.includes(id));
}
function levelsUsingEnemy(id) {
  return state.data.levels.filter((l) => l.waves.some((w) => w.some((g) => g.enemyId === id)));
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

function spriteField(draft) {
  const { wrap, input } = field(draft, 'sprite', 'Sprite (emoji)');
  const preview = h('span', { className: 'sprite-preview', textContent: draft.sprite ?? '' });
  input.addEventListener('input', () => { preview.textContent = input.value; });
  wrap.append(preview);
  return wrap;
}

/**
 * Generic list + form editor.
 * cfg: { noun, items(), blank(), buildFields(draft, form) -> Node[], normalize(draft), validate,
 *        usedBy(id) -> levels, save(item), remove(id) }
 */
function mountCatalog(el, cfg) {
  let selectedId = null; // null = nothing; '__new__' = new draft

  async function afterWrite(result, errorEl, onOk) {
    if (!result.ok) { errorEl.textContent = result.error ?? 'Save failed'; return; }
    await refresh();
    onOk();
    render();
  }

  function renderForm(isNew, source) {
    const draft = structuredClone(source);
    const error = h('p', { className: 'error', role: 'alert' });
    const form = h('form', { className: 'catalog-form' });
    form.append(h('h2', {}, isNew ? `New ${cfg.noun}` : draft.name || cfg.noun));
    if (!isNew) form.append(h('p', { className: 'muted' }, `id: ${draft.id}`));
    form.append(...cfg.buildFields(draft));

    const save = h('button', { type: 'submit', textContent: 'Save', disabled: state.readOnly });
    const actions = h('div', { className: 'actions' }, save);
    if (!isNew) {
      const del = h('button', { type: 'button', className: 'secondary', textContent: 'Delete', disabled: state.readOnly });
      del.onclick = async () => {
        error.textContent = '';
        const used = cfg.usedBy(draft.id);
        const warn = used.length
          ? `"${draft.name}" is used by: ${used.map((l) => l.name).join(', ')}.\n\nThose levels will lose it (the game cleans them on load). Delete anyway?`
          : `Delete "${draft.name}"?`;
        if (!confirm(warn)) return;
        del.disabled = true;
        const result = await cfg.remove(draft.id);
        del.disabled = state.readOnly;
        await afterWrite(result, error, () => { selectedId = null; });
      };
      actions.append(del);
    }
    form.append(actions, error);
    if (state.readOnly) form.append(h('p', { className: 'muted' }, 'Read-only: database unreachable.'));

    form.onsubmit = async (e) => {
      e.preventDefault();
      error.textContent = '';
      cfg.normalize(draft);
      const problems = cfg.validate(draft);
      if (problems.length) { error.textContent = problems.join('; '); return; }
      save.disabled = true;
      const result = await cfg.save(draft);
      save.disabled = state.readOnly;
      await afterWrite(result, error, () => { selectedId = draft.id; });
    };
    return form;
  }

  function render() {
    const list = h('ul', { className: 'catalog-list' });
    for (const item of cfg.items()) {
      const b = h('button', { type: 'button', className: 'secondary', textContent: `${item.sprite ?? ''} ${item.name}`.trim() });
      if (item.id === selectedId) b.setAttribute('aria-current', 'true');
      b.onclick = () => { selectedId = item.id; render(); };
      list.append(h('li', {}, b));
    }
    const add = h('button', { type: 'button', textContent: `+ New ${cfg.noun}`, disabled: state.readOnly });
    add.onclick = () => { selectedId = '__new__'; render(); };

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

function weaponFields(draft) {
  const out = [
    field(draft, 'name', 'Name').wrap,
    field(draft, 'description', 'Description', 'textarea').wrap,
    spriteField(draft),
    field(draft, 'cost', 'Cost (corks)', 'number', { min: 1, step: 1 }).wrap,
    field(draft, 'range', 'Range (tiles)', 'number', { min: 0 }).wrap,
    field(draft, 'damage', 'Damage', 'number', { min: 0 }).wrap,
    field(draft, 'fireRate', 'Fire rate (shots/s)', 'number', { min: 0 }).wrap,
  ];

  const effectSelect = h('select', {}, ...EFFECTS.map((v) => h('option', { value: v, textContent: v })));
  effectSelect.value = draft.effect;
  const strength = field(draft, 'effectStrength', 'Effect strength (slow: 0-1 fraction)', 'number', { min: 0 });
  const duration = field(draft, 'effectDuration', 'Effect duration (s)', 'number', { min: 0 });
  const effectBox = h('div', { className: 'effect-fields' }, strength.wrap, duration.wrap);
  const syncEffect = () => { effectBox.hidden = draft.effect === 'none'; };
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
      name: '', description: '', sprite: '🍺', cost: 50, range: 2.5, damage: 5, fireRate: 1,
      effect: 'none', effectStrength: 0, effectDuration: 0, upgrades: [],
    }),
    normalize: (w) => {
      if (w.effect === 'none') { w.effectStrength = 0; w.effectDuration = 0; }
    },
    buildFields: weaponFields,
    validate: validateWeapon,
    usedBy: levelsUsingWeapon,
    save: (w) => state.dataSource.saveWeapon(w),
    remove: (id) => state.dataSource.deleteWeapon(id),
  });
}

export function mountEnemies(el) {
  mountCatalog(el, {
    noun: 'enemy',
    items: () => state.data.enemies,
    blank: () => ({ name: '', description: '', sprite: '🙂', hp: 20, speed: 1, reward: 5, wineDamage: 1 }),
    normalize: () => {},
    buildFields: (draft) => [
      field(draft, 'name', 'Name').wrap,
      field(draft, 'description', 'Description', 'textarea').wrap,
      spriteField(draft),
      field(draft, 'hp', 'HP', 'number', { min: 0 }).wrap,
      field(draft, 'speed', 'Speed (tiles/s)', 'number', { min: 0 }).wrap,
      field(draft, 'reward', 'Reward (corks)', 'number', { min: 1, step: 1 }).wrap,
      field(draft, 'wineDamage', 'Wine damage', 'number', { min: 1, step: 1 }).wrap,
    ],
    validate: validateEnemy,
    usedBy: levelsUsingEnemy,
    save: (e) => state.dataSource.saveEnemy(e),
    remove: (id) => state.dataSource.deleteEnemy(id),
  });
}
