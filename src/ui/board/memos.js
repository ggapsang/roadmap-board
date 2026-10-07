/**
 * 메모(포스트잇) — 보드 위 아무 데나 붙이는 마크다운 메모. **이벤트가 아니다** — 관계·항등·조합·그래프·휴지통·검색 어디에도
 * 들지 않는 순수 보드 표시 값이다(doc.meta.memos, 보드 meta_json).
 *
 * 자리: 픽셀로 놓되 '놓인 점'을 보드 좌표로 기억한다 — 세로는 날짜+그날 안 비율(dy) 또는 칸 위치(slot, 날짜 없는 보드),
 * 가로는 트랙 + 그 칸 폭에 대한 비율(x). 행 높이·구간 접기·눈금 모드·트랙 폭이 바뀌어도 그 자리를 따라간다.
 * 크기(w·h)는 px — 보드가 줄고 늘어도 글이 찌그러지지 않는다(보드 확대 Ctrl+휠은 .cal 전체 zoom이라 함께 커진다).
 *
 * 리스너는 다시 그려지지 않는 층(.memos)과 window에만 붙인다(규약 14). 끄는 동안은 DOM만 옮기고 놓을 때 한 번 commit한다.
 */
import { el } from '../dom.js';
import { openCtxMenu } from '../ctxmenu.js';
import { renderMarkdown } from '../markdown.js';
import { createNoteEditor } from '../noteEditor.js';
import { dayIndex, dateAt } from '../../core/dates.js';
import { newId } from '../../core/schema.js';
import { MEMO } from '../../config/index.js';

const round3 = (v) => Math.round(v * 1000) / 1000;

export class MemoLayer {
  /**
   * @param {object} o
   * @param {HTMLElement} o.grid   .body
   * @param {() => import('./index.js').Board} o.board
   */
  constructor({ grid, store, view, board }) {
    Object.assign(this, { grid, store, view, board });
    this.layer = el('div.memos');
    this.edit = null;            // { id, node, ed, text, fresh }
    this.#attach();
  }

  // ── 좌표 ────────────────────────────────────────────────

  /** 메모의 보드 px 상자 */
  box(m) {
    const b = this.board();
    const tl = b.timeline;
    let p;
    if (tl.dated) p = m.date ? dayIndex(m.date, b.origin) + (m.dy ?? 0) : (m.slot ?? 0);
    else p = m.slot ?? 0;
    const top = b.scale.y(Math.max(0, p));
    const cols = [...b.columns.entries()];
    const col = b.columns.get(m.track) ?? cols[0]?.[1];
    const left = col ? col.offsetLeft + (m.x ?? 0) * col.offsetWidth : 0;
    return { left, top, width: m.w ?? MEMO.w, height: m.h ?? MEMO.h };
  }

  /** 보드 px 점 → 메모 자리(날짜·칸 + 트랙 비율) */
  anchor(bx, by) {
    const b = this.board();
    const cols = [...b.columns.entries()];
    let pick = cols[0];
    for (const c of cols) if (bx >= c[1].offsetLeft) pick = c;
    const [track, col] = pick ?? [null, null];
    const x = col && col.offsetWidth ? round3((bx - col.offsetLeft) / col.offsetWidth) : 0;
    const p = Math.max(0, b.scale.dayAt(Math.max(0, by)));
    if (b.timeline.dated) {
      const d = Math.floor(p);
      return { date: dateAt(b.origin, d), dy: round3(p - d), slot: null, track, x };
    }
    return { date: null, dy: 0, slot: round3(p), track, x };
  }

  /** 화면 좌표 → 보드 px (.body 기준, 보드 확대 배율을 나눈다 — 규약 24) */
  #boardPoint(clientX, clientY) {
    const r = this.grid.getBoundingClientRect();
    const z = this.board().zoom || 1;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }

  // ── 그리기 ──────────────────────────────────────────────

  /** 카드가 다 붙은 뒤(컬럼 폭이 정해진 뒤) 부른다 */
  draw() {
    const memos = this.store.meta.memos ?? [];
    const keep = this.edit ? this.edit.node : null;
    for (const n of [...this.layer.children]) if (n !== keep) n.remove();
    for (const m of memos) {
      const box = this.box(m);
      const node = this.edit?.id === m.id ? this.edit.node : this.#node(m);
      Object.assign(node.style, {
        left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      });
      node.classList.toggle('sel', this.view.selectedMemo === m.id);
      if (node !== keep) this.layer.append(node);
    }
    // 편집 중이던 메모가 문서에서 사라졌으면(되돌리기 등) 편집을 접는다
    if (this.edit && !memos.some((m) => m.id === this.edit.id)) { this.edit.node.remove(); this.edit = null; }
  }

  #node(m) {
    const body = el('div.memo-body.md-body');
    if ((m.text ?? '').trim()) body.append(...renderMarkdown(m.text));
    else body.append(el('span.memo-empty', { text: '빈 메모 — 더블클릭해 쓰기' }));
    return el('div.memo', { dataset: { memo: m.id }, attrs: { tabindex: '-1' } }, [body, el('div.memo-grip', { attrs: { title: '크기 조절' } })]);
  }

  /** 고른 메모 표시만 바꾼다(다시 그리지 않는다) */
  select(id) {
    this.view.selectedMemo = id ?? null;
    for (const n of this.layer.querySelectorAll('.memo')) n.classList.toggle('sel', n.dataset.memo === this.view.selectedMemo);
  }

  // ── 만들기·고치기·지우기 ────────────────────────────────

  /** 화면 좌표 자리에 새 메모 — 바로 편집 */
  create(clientX, clientY) {
    if (this.store.readonly) return null;
    const p = this.#boardPoint(clientX, clientY);
    const memo = { id: newId('m'), text: '', ...this.anchor(p.x, p.y), w: MEMO.w, h: MEMO.h };
    this.store.commit('메모 붙이기', (doc) => { doc.meta.memos = [...(doc.meta.memos ?? []), memo]; }, { group: `memo:${memo.id}` });
    this.startEdit(memo.id, { fresh: true });
    return memo.id;
  }

  startEdit(id, { fresh = false } = {}) {
    if (this.store.readonly) return;
    if (this.edit?.id === id) { this.edit.ed.focus(); return; }
    this.finishEdit();
    const m = (this.store.meta.memos ?? []).find((x) => x.id === id);
    const node = this.layer.querySelector(`.memo[data-memo="${CSS.escape(id)}"]`);
    if (!m || !node) return;
    this.select(id);
    node.classList.add('editing');
    const host = el('div.memo-editor');
    node.querySelector('.memo-body')?.replaceWith(host);
    const ed = createNoteEditor(host, {
      onChange: (text) => { if (this.edit) this.edit.text = text; },
      // 다른 창으로 포커스가 가도(창 전환) 끝내지 않는다 — 돌아와 이어 쓴다
      onBlur: () => { if (document.hasFocus()) setTimeout(() => this.finishEdit(), 0); },
    });
    ed.setValue(m.text ?? '');
    this.edit = { id, node, ed, text: m.text ?? '', fresh };
    ed.focus();
  }

  /** 쓰던 메모를 저장하고 편집을 끝낸다. 방금 만들고 아무것도 안 쓴 메모는 지운다 */
  finishEdit() {
    const e = this.edit;
    if (!e) return;
    this.edit = null;
    const m = (this.store.meta.memos ?? []).find((x) => x.id === e.id);
    if (m && e.fresh && !e.text.trim()) {
      this.store.commit('메모 붙이기', (doc) => { doc.meta.memos = (doc.meta.memos ?? []).filter((x) => x.id !== e.id); }, { group: `memo:${e.id}` });
      if (this.view.selectedMemo === e.id) this.view.selectedMemo = null;
    } else if (m && e.text !== (m.text ?? '')) {
      this.store.commit('메모', (doc) => {
        const t = (doc.meta.memos ?? []).find((x) => x.id === e.id);
        if (t) t.text = e.text;
      }, { group: `memo:${e.id}` });
    }
    e.node.remove();
    this.draw();
  }

  get editing() { return !!this.edit; }

  remove(id) {
    if (this.store.readonly || !id) return;
    if (this.edit?.id === id) { this.edit.node.remove(); this.edit = null; }
    if (this.view.selectedMemo === id) this.view.selectedMemo = null;
    this.store.commit('메모 삭제', (doc) => { doc.meta.memos = (doc.meta.memos ?? []).filter((x) => x.id !== id); });
  }

  // ── 입력 ────────────────────────────────────────────────

  #attach() {
    const L = this.layer;
    L.addEventListener('pointerdown', (ev) => {
      const node = ev.target.closest('.memo');
      if (!node || ev.button !== 0) return;
      ev.stopPropagation();                         // 보드의 만들기·끌기로 번지지 않게
      if (node.classList.contains('editing')) return;
      if (this.store.readonly) { this.select(node.dataset.memo); return; }
      ev.preventDefault();
      this.#drag(node, ev, ev.target.classList.contains('memo-grip') ? 'size' : 'move');
    });
    L.addEventListener('click', (ev) => { if (ev.target.closest('.memo')) ev.stopPropagation(); });
    L.addEventListener('dblclick', (ev) => {
      const node = ev.target.closest('.memo');
      if (!node) return;
      ev.stopPropagation();
      if (!ev.target.classList.contains('memo-grip')) this.startEdit(node.dataset.memo);
    });
    L.addEventListener('contextmenu', (ev) => {
      const node = ev.target.closest('.memo');
      if (!node) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (this.store.readonly || node.classList.contains('editing')) return;
      const id = node.dataset.memo;
      this.select(id);
      openCtxMenu(ev.clientX, ev.clientY, [
        { label: '메모 고치기', action: () => this.startEdit(id) },
        { label: '메모 삭제', action: () => this.remove(id) },
      ]);
    });
  }

  /** 끌어 옮기기·크기 조절 — 움직이는 동안은 DOM만, 놓을 때 한 번 commit. 안 움직였으면 고르기 */
  #drag(node, ev, kind) {
    const id = node.dataset.memo;
    const z = this.board().zoom || 1;
    const sx = ev.clientX, sy = ev.clientY;
    const start = { left: node.offsetLeft, top: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
    let moved = false;
    const move = (e) => {
      const dx = (e.clientX - sx) / z, dy = (e.clientY - sy) / z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (kind === 'move') {
        node.style.left = `${start.left + dx}px`;
        node.style.top = `${Math.max(0, start.top + dy)}px`;
      } else {
        node.style.width = `${Math.min(MEMO.max, Math.max(MEMO.min, start.w + dx))}px`;
        node.style.height = `${Math.min(MEMO.max, Math.max(MEMO.min, start.h + dy))}px`;
      }
      document.body.classList.add('dragging-memo');
    };
    const up = (e) => {
      if (e?.type === 'pointerup') move(e);       // 놓은 자리까지
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging-memo');
      if (!moved) { this.select(id); return; }
      const next = kind === 'move'
        ? this.anchor(node.offsetLeft, node.offsetTop)
        : { w: Math.round(node.offsetWidth), h: Math.round(node.offsetHeight) };
      this.view.selectedMemo = id;
      this.store.commit(kind === 'move' ? '메모 옮기기' : '메모 크기', (doc) => {
        const t = (doc.meta.memos ?? []).find((x) => x.id === id);
        if (t) Object.assign(t, next);
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
