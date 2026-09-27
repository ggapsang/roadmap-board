/**
 * 커서 위치에 뜨는 작은 우클릭 메뉴. 바깥을 누르면 닫힌다. 바인드·카드 등 여러 곳에서 쓴다.
 * options = [{ label, action, disabled? }]
 */
import { el } from './dom.js';

export function openCtxMenu(x, y, options) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div.ctx-menu', { style: { left: `${x}px`, top: `${y}px` } });
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); };
  const onDoc = (e) => { if (!menu.contains(e.target)) close(); };
  for (const opt of options) {
    if (!opt) continue;
    const btn = el('button', {
      type: 'button', text: opt.label,
      on: { click: () => { close(); if (!opt.disabled) opt.action(); } },
    });
    if (opt.disabled) btn.disabled = true;
    menu.append(btn);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, x - r.width)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, y - r.height)}px`;
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
  return close;
}
