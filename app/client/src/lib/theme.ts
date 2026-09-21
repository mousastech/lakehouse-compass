// Dark-first theme (spec §20.2). Default is dark; the user can opt into light.
const KEY = 'compass_theme';
export type Theme = 'dark' | 'light';

export function initTheme(): void {
  const t = getTheme();
  applyTheme(t);
}

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
  applyTheme(t);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.classList.toggle('light', t === 'light');
  el.classList.toggle('dark', t === 'dark');
}
