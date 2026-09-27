import { $, el } from './dom.js';

let timer = null;

/**
 * 짧은 안내. variant='warn'이면 오류 색. action={label,on}이면 되돌리기 같은 버튼을 붙이고
 * 더 오래 띄운다(누르면 on() 실행 후 사라짐).
 */
export function toast(message, variant = '', action = null) {
  const node = $('toast');
  if (!node) return;
  node.replaceChildren(document.createTextNode(message));
  node.className = 'toast on' + (variant ? ' ' + variant : '');
  clearTimeout(timer);
  if (action && action.label && typeof action.on === 'function') {
    node.append(el('button.toast-action', {
      type: 'button', text: action.label,
      on: { click: () => { clearTimeout(timer); node.classList.remove('on'); action.on(); } },
    }));
    timer = setTimeout(() => node.classList.remove('on'), 6000);
  } else {
    timer = setTimeout(() => node.classList.remove('on'), variant === 'warn' ? 3200 : 1600);
  }
}
