// Best result per level, remembered in localStorage (wrapped: storage may be blocked).
const STORAGE_KEY = 'friday-drinks:stars';

// 3 stars: barely touched the wine; 1 star: survived.
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
