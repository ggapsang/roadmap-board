/**
 * 인앱 입력 다이얼로그.
 *
 * Electron은 window.prompt()를 지원하지 않는다 ("prompt() is not supported").
 * 브라우저에서만 돌던 시안에서 넘어오며 놓쳤던 부분이라, 이름을 묻는 자리는
 * 전부 이 다이얼로그를 쓴다. confirm()과 alert()는 Electron에서도 동작하므로
 * 그대로 둔다.
 */
import { el, $, clear, icon, ICONS } from './dom.js';

let host = null;

function ensureHost() {
  if (!host) host = el('div.dlg-scrim', { hidden: true });
  // 매번 맨 뒤로 옮긴다 — 다른 팝업(휴지통 등) 위에서 확인 창을 띄워도 그 위에 오게.
  document.body.append(host);
  return host;
}

/** 공용 확인 창이 떠 있는가 — 그 아래 팝업이 Esc를 가로채지 않게. */
export function dialogOpen() {
  return !!host && !host.hidden;
}

/** 끌어도 드래그가 시작되지 않는 곳 — 입력·버튼·목록은 원래 동작(클릭·선택·스크롤)을 지킨다 */
const NO_DRAG = 'input,textarea,select,button,a,label,[contenteditable],.dlg-tree,.trash-list,.dlg-choices';
/** 이만큼 움직여야 드래그로 본다(px) — 그 전에는 클릭 */
const DRAG_SLOP = 3;

/**
 * 팝업을 끌어 옮길 수 있게 한다. 입력·버튼·목록이 아닌 곳(제목·설명·여백)을 잡고 끈다.
 * 화면 밖으로 완전히 나가지 않게 가둔다. 위치는 그 팝업이 떠 있는 동안만 유지된다(다음엔 가운데).
 * 리스너는 window에 붙였다 뗀다 — 드래그 중 포인터가 팝업 밖으로 나가도 이어지게(규약 14와 같은 이유).
 */
export function makeMovable(box) {
  let dx = 0, dy = 0;
  box.classList.add('movable');
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
    const sx = e.clientX, sy = e.clientY;
    const x0 = dx, y0 = dy;
    const r0 = box.getBoundingClientRect();
    let moving = false;
    const move = (ev) => {
      const mx = ev.clientX - sx, my = ev.clientY - sy;
      if (!moving && Math.hypot(mx, my) < DRAG_SLOP) return;
      if (!moving) { moving = true; box.classList.add('moving'); }
      ev.preventDefault();
      // 제목 줄이 늘 잡히도록 — 위는 화면 안, 옆·아래는 최소 48px이 남게
      const keep = 48;
      const nx = Math.min(innerWidth - keep - r0.left, Math.max(keep - r0.right, mx));
      const ny = Math.min(innerHeight - keep - r0.top, Math.max(-r0.top, my));
      dx = x0 + nx; dy = y0 + ny;
      box.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      box.classList.remove('moving');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  return box;
}

/**
 * 바깥(어두운 막)을 눌러 닫기. 누름과 뗌이 **둘 다 막 위에서** 일어났을 때만 닫는다 — 팝업을 끌다가
 * 막 위에서 놓거나, 입력 칸을 긁다가 바깥에서 놓았을 때 닫혀 버리지 않게.
 */
export function closeOnScrim(scrim, close) {
  let downOnScrim = false;
  scrim.onpointerdown = (e) => { downOnScrim = e.target === scrim; };
  scrim.onclick = (e) => { if (downOnScrim && e.target === scrim) close(); downOnScrim = false; };
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

    scrim.replaceChildren(makeMovable(box));
    scrim.hidden = false;
    closeOnScrim(scrim, () => finish(null));

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
    scrim.replaceChildren(makeMovable(box));
    scrim.hidden = false;
    closeOnScrim(scrim, () => finish(false));
  });
}

/**
 * 펼칠 수 있는 트리 + 텍스트 검색으로 다른 프로젝트의 이벤트를 고른다.
 *   select='multi' : 체크박스 여러 개 → '적용'. minSelect로 최소 개수 강제(조합은 2). 0개(전부
 *                    해제)는 허용, 1~(minSelect-1)개면 적용 비활성(조합은 둘 이상의 묶음이므로).
 *   select='single': 행을 누르면 그 id로 바로 확정(동일 합치기 대상 고르기).
 * @param {{title, message?, nodes, checked?:Set, select?:'multi'|'single', minSelect?:number}} o
 *   nodes = [{ id, label, sub?, checkable?, children? }] (중첩)
 * @returns {Promise<Set<string>|string|null>} multi=Set, single=id, 취소=null
 */
export function askTree({ title, message = '', nodes = [], checked = new Set(), select = 'multi', minSelect = 0 }) {
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

    const expanded = new Set();
    (function markAll(list) { for (const n of list) if (n.children?.length) { expanded.add(n.id); markAll(n.children); } })(nodes);

    const matchesDeep = (n, q) => `${n.label} ${n.sub ?? ''}`.toLowerCase().includes(q) || (n.children ?? []).some((c) => matchesDeep(c, q));

    const search = el('input.dlg-tree-search', { type: 'text', placeholder: '검색…', attrs: { 'aria-label': '검색' } });
    const treeBox = el('div.dlg-tree');
    const applyBtn = el('button.btn.cta', { type: 'button', text: '적용', on: { click: () => finish(sel) } });
    const updateApply = () => { applyBtn.disabled = sel.size > 0 && sel.size < minSelect; };

    function paint() {
      const q = search.value.trim().toLowerCase();
      clear(treeBox);
      const render = (list, depth) => {
        for (const n of list) {
          if (q && !matchesDeep(n, q)) continue;
          const hasKids = !!(n.children && n.children.length);
          const row = el('div.dlg-tree-row', { dataset: { id: n.id }, style: { paddingLeft: `${6 + depth * 16}px` } });
          if (hasKids) {
            const open = expanded.has(n.id) || !!q;
            row.append(el('button.dlg-tree-chev', { type: 'button', text: open ? '▾' : '▸', attrs: { 'aria-label': open ? '접기' : '펼치기' }, on: { click: (e) => { e.stopPropagation(); if (expanded.has(n.id)) expanded.delete(n.id); else expanded.add(n.id); paint(); } } }));
          } else row.append(el('span.dlg-tree-chev-none'));
          if (n.checkable !== false) {
            if (select === 'multi') {
              const cb = el('input', { type: 'checkbox', checked: sel.has(n.id) });
              cb.addEventListener('change', () => { if (cb.checked) sel.add(n.id); else sel.delete(n.id); updateApply(); });
              row.append(cb);
            }
          } else row.classList.add('dlg-tree-head');
          const clickable = select === 'single' && n.checkable !== false;
          const label = el('span.dlg-tree-label' + (clickable ? '.linklike' : ''), { text: n.label || '(제목 없음)' });
          if (clickable) label.addEventListener('click', () => finish(n.id));
          row.append(label);
          if (n.sub) row.append(el('em.dlg-tree-sub', { text: n.sub }));
          treeBox.append(row);
          if (hasKids && (expanded.has(n.id) || q)) render(n.children, depth + 1);
        }
      };
      render(nodes, 0);
      if (!treeBox.children.length) treeBox.append(el('div.empty', { text: q ? '검색 결과 없음' : '다른 프로젝트에 담을 이벤트가 없습니다.' }));
    }
    search.addEventListener('input', paint);
    paint();
    updateApply();

    const actions = select === 'multi'
      ? el('div.dlg-actions', {}, [el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(null) } }), applyBtn])
      : el('div.dlg-actions', {}, [el('button.btn.outline', { type: 'button', text: '취소', on: { click: () => finish(null) } })]);

    const box = el('div.dlg.dlg-wide', { on: { click: (e) => e.stopPropagation() } }, [
      el('h2', { text: title }),
      message ? el('p.note', { text: message }) : null,
      el('div.fl-search', {}, [icon(ICONS.search), search]),
      treeBox,
      actions,
    ]);
    scrim.replaceChildren(makeMovable(box));
    scrim.hidden = false;
    closeOnScrim(scrim, () => finish(null));
    search.focus();
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
    scrim.replaceChildren(makeMovable(box));
    scrim.hidden = false;
    closeOnScrim(scrim, () => finish(null));
  });
}
