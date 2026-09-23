/** 테마 전환 — 시스템 설정 자동 감지 + 수동 토글 (기획안 §6). */
const KEY = 'dr-roadmap-theme';

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* noop */ }
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const isDark = current ? current === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(KEY, next); } catch { /* noop */ }
  return next;
}
