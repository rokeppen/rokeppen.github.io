// Best result per level, remembered in localStorage (wrapped: storage may be blocked).
const STORAGE_KEY = 'friday-drinks:v2:stars';

// 3 stars: barely touched the kegs (internal name: wine); 1 star: survived.
export function starsFor(wine, startingWine) {
  const ratio = startingWine > 0 ? wine / startingWine : 0;
  return ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : 1;
}

export function loadStars() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function recordStars(levelId, stars) {
  try {
    const all = loadStars();
    if ((all[levelId] ?? 0) >= stars) return;
    all[levelId] = stars;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Not remembered; the game still works.
  }
}

// Best wave reached per level: one key per level id, holding { wave, cleared }.
const BEST_PREFIX = 'friday-drinks:v2:best:';

export function loadBest(levelId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BEST_PREFIX + levelId) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return { wave: Number.isFinite(parsed.wave) ? parsed.wave : 0, cleared: parsed.cleared === true };
  } catch {
    return null;
  }
}

// Merges a finished run into the stored best: highest wave, cleared once means cleared.
export function recordBest(levelId, wave, cleared) {
  try {
    const old = loadBest(levelId) || { wave: 0, cleared: false };
    const best = { wave: Math.max(old.wave, wave), cleared: old.cleared || cleared };
    if (best.wave === old.wave && best.cleared === old.cleared) return;
    window.localStorage.setItem(BEST_PREFIX + levelId, JSON.stringify(best));
  } catch {
    // Not remembered; the game still works.
  }
}

// The "how to play" overlay opens by itself only on the first launch.
const HOW_TO_KEY = 'friday-drinks:how-to-seen';

export function howToSeen() {
  try {
    return window.localStorage.getItem(HOW_TO_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHowToSeen() {
  try {
    window.localStorage.setItem(HOW_TO_KEY, '1');
  } catch {
    // Shown again next launch; harmless.
  }
}

// Best score per cleared level: the caps 🧢 held at the end of a won run (cards made caps a
// score). One key per level id, holding { score }. Lost runs don't count, so the number
// always means "the best party you survived".
const SCORE_PREFIX = 'friday-drinks:v2:score:';

export function loadHighScore(levelId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCORE_PREFIX + levelId) || 'null');
    const score = parsed && typeof parsed === 'object' ? parsed.score : null;
    return Number.isFinite(score) && score >= 0 ? score : null;
  } catch {
    return null;
  }
}

// Records a cleared run's score. Returns { best, previous, isNew }; previous is null on a
// first clear. With storage blocked it still reports this run as new.
export function recordHighScore(levelId, score) {
  const previous = loadHighScore(levelId);
  if (previous !== null && score <= previous) return { best: previous, previous, isNew: false };
  try {
    window.localStorage.setItem(SCORE_PREFIX + levelId, JSON.stringify({ score }));
  } catch {
    // Not remembered; the game still works.
  }
  return { best: score, previous, isNew: true };
}

// End screen line for a recordHighScore() result ('' when there is none, e.g. a loss).
export function highScoreLine(record) {
  if (!record) return '';
  if (!record.isNew) return `High score: ${record.best} 🧢`;
  if (record.previous === null) return '🏅 New high score! First clear.';
  return `🏅 New high score! Beat ${record.previous} 🧢 by ${record.best - record.previous}.`;
}
