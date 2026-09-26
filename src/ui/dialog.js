/**
 * 인앱 입력 다이얼로그.
 *
 * Electron은 window.prompt()를 지원하지 않는다 ("prompt() is not supported").
 * 브라우저에서만 돌던 시안에서 넘어오며 놓쳤던 부분이라, 이름을 묻는 자리는
 * 전부 이 다이얼로그를 쓴다. confirm()과 alert()는 Electron에서도 동작하므로
 * 그대로 둔다.
 */
import { el, $ } from './dom.js';

let host = null;

function ensureHost() {
  if (host) return host;
  host = el('div.dlg-scrim', { hidden: true });
  document.body.append(host);
  return host;
}

/**
 * 한 줄 입력을 받는다.
 * @returns {Promise<string|null>} 취소하면 null
 */
export function askText({ title, label = '', value = '', placeholder = '', confirmLabel = '확인' }) {
  const scrim = ensureHost();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      scrim.hidden = true;
      scrim.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };

    const input = el('input', {
      type: 'text', value, placeholder,
      attrs: { 'aria-label': label || title },
    });

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      if (e.key === 'Enter' && document.activeElement === input) {
        e.preventDefault(); e.stopPropagation();
        finish(input.value.trim() || null);
      }
    };
    document.addEventListener('keydown', onKey, true);

    const box = el('div.dlg', { on: { click: (e) => e.stopPropagation() } }, [
      el('h2', { text: title }),
      label ? el('label', { text: label }) : null,
      input,
      el('div.dlg-actions', {}, [
        el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(null) } }),
        el('button.btn.cta', {
          type: 'button', text: confirmLabel,
          on: { click: () => finish(input.value.trim() || null) },
        }),
      ]),
    ]);

    scrim.replaceChildren(box);
    scrim.hidden = false;
    scrim.onclick = () => finish(null);

    input.focus();
    input.select();
  });
}

/**
 * 예/아니오 확인. window.confirm은 스모크·자동화를 막으므로 인앱 다이얼로그로 한다.
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, message = '', confirmLabel = '확인', danger = false }) {
  const scrim = ensureHost();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      scrim.hidden = true;
      scrim.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    };
    document.addEventListener('keydown', onKey, true);

    const box = el('div.dlg', { on: { click: (e) => e.stopPropagation() } }, [
      el('h2', { text: title }),
      message ? el('p.note', { text: message }) : null,
      el('div.dlg-actions', {}, [
        el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(false) } }),
        el(`button.btn.${danger ? 'danger' : 'cta'}`, {
          type: 'button', text: confirmLabel, on: { click: () => finish(true) },
        }),
      ]),
    ]);
    scrim.replaceChildren(box);
    scrim.hidden = false;
    scrim.onclick = () => finish(false);
  });
}
