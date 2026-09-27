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

/**
 * 체크박스 트리에서 여러 개를 고른다. 조합(포함)에서 '다른 프로젝트의 이벤트'를 트리로 펼쳐
 * 골라 담을 때 쓴다.
 * @param {{title, message?, rows:{id,label,sub?,depth?,checkable?}[], checked?:Set<string>}} o
 * @returns {Promise<Set<string>|null>} 확인하면 체크된 id 집합, 취소하면 null
 */
export function askTree({ title, message = '', rows = [], checked = new Set() }) {
  const scrim = ensureHost();
  return new Promise((resolve) => {
    let settled = false;
    const sel = new Set(checked);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      scrim.hidden = true;
      scrim.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);

    const list = el('div.dlg-tree');
    if (!rows.length) list.append(el('div.empty', { text: '다른 프로젝트에 담을 이벤트가 없습니다.' }));
    for (const r of rows) {
      const row = el('div.dlg-tree-row', { dataset: { depth: String(r.depth ?? 0) }, style: { paddingLeft: `${8 + (r.depth ?? 0) * 16}px` } });
      if (r.checkable !== false) {
        const box = el('input', { type: 'checkbox', checked: sel.has(r.id) });
        box.addEventListener('change', () => { if (box.checked) sel.add(r.id); else sel.delete(r.id); });
        row.append(box);
      } else {
        row.classList.add('dlg-tree-head');
      }
      row.append(el('span.dlg-tree-label', { text: r.label || '(제목 없음)' }));
      if (r.sub) row.append(el('em.dlg-tree-sub', { text: r.sub }));
      list.append(row);
    }
    const box = el('div.dlg.dlg-wide', { on: { click: (e) => e.stopPropagation() } }, [
      el('h2', { text: title }),
      message ? el('p.note', { text: message }) : null,
      list,
      el('div.dlg-actions', {}, [
        el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(null) } }),
        el('button.btn.cta', { type: 'button', text: '적용', on: { click: () => finish(sel) } }),
      ]),
    ]);
    scrim.replaceChildren(box);
    scrim.hidden = false;
    scrim.onclick = () => finish(null);
  });
}

/**
 * 여러 보기 중 하나를 고른다. 동일 매핑에서 "어느 이벤트의 본질을 남길까"를 매번 고를 때 쓴다.
 * @param {{title, message?, choices:{key,label,sub?}[]}} o
 * @returns {Promise<string|null>} 고른 key, 취소하면 null
 */
export function askChoice({ title, message = '', choices = [] }) {
  const scrim = ensureHost();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (key) => {
      if (settled) return;
      settled = true;
      scrim.hidden = true;
      scrim.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      resolve(key);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    const box = el('div.dlg', { on: { click: (e) => e.stopPropagation() } }, [
      el('h2', { text: title }),
      message ? el('p.note', { text: message }) : null,
      el('div.dlg-choices', {}, choices.map((c) => el('button.btn.outline.dlg-choice', {
        type: 'button', on: { click: () => finish(c.key) },
      }, [
        el('span.dlg-choice-label', { text: c.label }),
        c.sub ? el('span.dlg-choice-sub', { text: c.sub }) : null,
      ]))),
      el('div.dlg-actions', {}, [
        el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(null) } }),
      ]),
    ]);
    scrim.replaceChildren(box);
    scrim.hidden = false;
    scrim.onclick = () => finish(null);
  });
}
