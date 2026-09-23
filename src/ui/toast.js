import { $ } from './dom.js';

let timer = null;

/** 짧은 안내. variant='warn'이면 오류 색. */
export function toast(message, variant = '') {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.className = 'toast on' + (variant ? ' ' + variant : '');
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove('on'), variant === 'warn' ? 3200 : 1600);
}
