import { supabase } from '../supabase.js';
import { createDataSource } from '../shared/data.js';
import { mountLevels } from './level-editor.js';
import { mountWeapons, mountEnemies } from './catalog-editor.js';

const dataSource = createDataSource({
  client: supabase,
  fetchFallback: () => fetch('../fallback-data.json').then((r) => r.json()),
});

// Shared with the editors (Tasks 9-11). `data` is GameData incl. unpublished levels;
// `readOnly` is true when data came from the bundled fallback: editors must not save then.
export const state = { data: null, dataSource, readOnly: false };

export async function refresh() {
  state.data = await dataSource.loadGameData({ includeUnpublished: true });
  state.readOnly = state.data.source === 'fallback';
}

const app = document.getElementById('app');

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}

function signOutButton() {
  return h('button', {
    className: 'secondary',
    textContent: 'Sign out',
    onclick: async () => { await supabase.auth.signOut(); render(); },
  });
}

function showLogin() {
  const error = h('p', { className: 'error', role: 'alert' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
  const password = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { type: 'submit', textContent: 'Sign in' });
  const form = h('form', { className: 'login' },
    h('label', {}, 'Email', email), h('label', {}, 'Password', password), submit, error);
  form.onsubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
    submit.disabled = false;
    if (err) error.textContent = err.message;
    else render();
  };
  app.replaceChildren(h('h1', {}, 'Friday Afternoon Drinks - Admin'), form);
}

function showNotAdmin() {
  app.replaceChildren(h('h1', {}, "You're not on the guest list."), signOutButton());
}

async function exportJson(button) {
  button.disabled = true;
  try {
    const parsed = JSON.parse(await dataSource.exportJson());
    const byId = (a, b) => String(a.id).localeCompare(String(b.id));
    parsed.weapons.sort(byId); // stable diffs; levels keep exportJson's order
    parsed.enemies.sort(byId);
    const blob = new Blob([JSON.stringify(parsed, null, 2) + '\n'], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'fallback-data.json' });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert(`Export failed: ${e.message ?? e}`);
  } finally {
    button.disabled = false;
  }
}

async function showAdmin() {
  app.replaceChildren(h('p', { className: 'muted' }, 'Loading...'));
  try {
    await refresh();
  } catch (e) {
    app.replaceChildren(h('p', { className: 'error' }, `Couldn't load data: ${e.message ?? e}`), signOutButton());
    return;
  }
  const tabs = [['Levels', mountLevels], ['Weapons', mountWeapons], ['Enemies', mountEnemies]];
  const panel = h('section', { role: 'tabpanel' });
  const nav = h('nav', { className: 'tabs', role: 'tablist' });
  const buttons = tabs.map(([label, mount]) => {
    const b = h('button', { role: 'tab', textContent: label });
    b.onclick = () => {
      buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      panel.replaceChildren();
      mount(panel);
    };
    return b;
  });
  nav.append(...buttons);
  const exportBtn = h('button', { className: 'secondary', textContent: 'Export JSON' });
  exportBtn.onclick = () => exportJson(exportBtn);
  const banner = state.readOnly
    ? [h('div', { className: 'banner', role: 'alert' },
        "Couldn't reach the database — showing bundled data; saving is disabled until reload.")]
    : [];
  app.replaceChildren(
    h('header', { className: 'bar' }, h('h1', {}, 'Friday Afternoon Drinks - Admin'),
      h('div', { className: 'actions' }, exportBtn, signOutButton())),
    ...banner, nav, panel);
  buttons[0].click();
}

async function render() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return showLogin();
  const { data: row, error } = await supabase.from('admins').select('user_id')
    .eq('user_id', session.user.id).maybeSingle();
  if (error || !row) return showNotAdmin();
  return showAdmin();
}

render();
