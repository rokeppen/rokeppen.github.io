import { createDataSource } from '../shared/data.js';
import { mountLevels } from './level-editor.js';
import { mountWeapons, mountEnemies } from './catalog-editor.js';

// supabase.js pulls the client from a CDN. Imported dynamically (see boot()) so a blocked,
// broken or hanging CDN shows a clear message instead of leaving the page on "Loading...".
const IMPORT_TIMEOUT_MS = 10000;
const CDN_ERROR = "Couldn't load the Supabase library — check your connection and reload.";
let supabase = null;
let dataSource = null;

// Shared with the editors (Tasks 9-11). `data` is GameData incl. unpublished levels;
// `data.levels` are the DB's own rows: unpublished and possibly invalid ones are included so they
// can be repaired. `readOnly` is true only when the DB was unreachable on the first load (bundled
// fallback shown): editors must not save then. `dataSource` is set by boot() before any render.
export const state = { data: null, dataSource: null, readOnly: false };

export async function refresh() {
  const data = await dataSource.loadGameData({ includeUnpublished: true, includeInvalid: true });
  if (data.source === 'fallback' && state.data && !state.readOnly) {
    // A reload after a save hit the fallback: keep the DB data we have (still editable, and what
    // the editors patch locally) and let the caller report the failed reload, instead of silently
    // swapping to bundled data.
    throw new Error('the database did not answer; showing the last loaded data, reload the page to see the latest');
  }
  state.data = data;
  state.readOnly = data.source === 'fallback';
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

function showError(message) {
  app.replaceChildren(
    h('h1', {}, 'Something went wrong'),
    h('p', { className: 'error', role: 'alert' }, message),
    h('div', { className: 'actions' },
      h('button', { textContent: 'Retry', onclick: () => render() }), signOutButton()));
}

async function render() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return showLogin();
    const { data: row, error } = await supabase.from('admins').select('user_id')
      .eq('user_id', session.user.id).maybeSingle();
    if (error) return showError(`Couldn't check your access: ${error.message}`);
    if (!row) return showNotAdmin();
    return await showAdmin();
  } catch (e) {
    showError(e?.message ?? String(e));
  }
}

async function boot() {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${IMPORT_TIMEOUT_MS} ms`)), IMPORT_TIMEOUT_MS);
    });
    ({ supabase } = await Promise.race([import('../supabase.js'), timeout]));
  } catch (e) {
    console.error('Supabase library failed to load:', e);
    app.replaceChildren(
      h('h1', {}, 'Friday Afternoon Drinks - Admin'),
      h('p', { className: 'error', role: 'alert' }, CDN_ERROR),
      h('div', { className: 'actions' },
        h('button', { textContent: 'Reload', onclick: () => window.location.reload() })));
    return;
  } finally {
    clearTimeout(timer);
  }
  dataSource = createDataSource({
    client: supabase,
    fetchFallback: () => fetch('../fallback-data.json').then((r) => r.json()),
  });
  state.dataSource = dataSource;
  render();
}

boot();
