/**
 * 비고 미리보기 — 비고가 있는 카드에 커서를 올리고 잠깐 멈추면 카드 옆에 비고를 마크다운으로 띄운다(2026-10-15 사용자).
 * 보기만 한다(pointer-events 없음) — 고치기는 편집 패널에서. 화면 상태만이라 문서·저장·되돌리기와 무관하다.
 *
 * - 맨 위엔 비고 없는 카드에 뜨는 기본 툴팁(카드 title — 이름·날짜·주체·진척)과 같은 것을, 그 밑에 비고(2026-10-28 사용자).
 *   띄운 동안은 카드의 기본 툴팁을 잠시 비워 둘이 겹쳐 뜨지 않게 한다(닫을 때 되돌린다).
 * - 카드 위에 비고가 이미 다 보이면(스타일 탭 '비고 표시') 띄우지 않는다. 잘려 숨었으면 띄운다.
 * - 상위 일정은 제목 바에 올렸을 때만 — 안쪽 빈 곳까지 띄우면 자식 카드 사이를 지날 때마다 튄다.
 * - 누르기(끌기 시작)·휠·스크롤·키 입력·문서 변경이면 닫는다.
 * 층은 document.body에 붙는 fixed 요소다 — 보드 확대(.cal zoom) 밖이라 화면 좌표(getBoundingClientRect)를 그대로 쓴다.
 * 리스너는 다시 그려지지 않는 보드 몸통(.body)과 window에만 붙인다(규약 14).
 */
import { el, clear } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import { NOTE_TIP } from '../../config/index.js';

export class NoteTip {
  /** @param {{grid:HTMLElement, store:import('../../core/store.js').Store}} o */
  constructor({ grid, store }) {
    Object.assign(this, { grid, store });
    this.node = el('div.note-tip', { attrs: { role: 'tooltip' }, hidden: true });
    document.body.append(this.node);
    this.id = null;        // 커서가 올라간 카드
    this.card = null;
    this.timer = 0;
    this.#attach();
  }

  #attach() {
    this.grid.addEventListener('pointerover', (ev) => {
      if (ev.pointerType && ev.pointerType !== 'mouse') return;
      const card = this.#cardAt(ev.target);
      if (card === this.card) return;
      this.hide();
      if (!card || ev.buttons) return;
      this.card = card;
      this.id = card.dataset.id;
      this.timer = setTimeout(() => this.#show(), NOTE_TIP.delay);
    });
    this.grid.addEventListener('pointerleave', () => this.hide());
    const close = () => { if (this.card) this.hide(); };
    this.grid.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, { passive: true, capture: true });
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    this.store.on?.('change', close);
  }

  /** 커서 아래 카드 — 가장 안쪽. 상위 일정은 제목 바 위일 때만 */
  #cardAt(target) {
    const card = target?.closest?.('.ev');
    if (!card || !this.grid.contains(card)) return null;
    if (card.classList.contains('container') && !target.closest(':scope > .t, .ev.container > .t')) return null;
    return card;
  }

  hide() {
    clearTimeout(this.timer);
    this.timer = 0;
    if (this.card && this.savedTitle != null) this.card.title = this.savedTitle;
    this.savedTitle = null;
    this.card = null;
    this.id = null;
    if (!this.node.hidden) { this.node.hidden = true; clear(this.node); }
  }

  #show() {
    const card = this.card;
    if (!card?.isConnected || document.body.classList.contains('exporting')) return;
    const item = this.store.item(this.id);
    const note = (item?.note ?? '').trim();
    if (!note) return;
    // 카드 위 비고가 다 보이면 같은 것을 또 띄우지 않는다
    const onCard = card.querySelector(':scope > .card-note');
    if (onCard && !onCard.hidden && onCard.scrollHeight <= onCard.clientHeight + 1 && card.scrollHeight <= card.clientHeight + 1) return;
    clear(this.node);
    // 머리 — 카드의 기본 툴팁 글(첫 줄 이름, 다음 줄부터 날짜·주체·진척)을 그대로
    const [name, ...rest] = (card.title || item.ti || '').split('\n').filter((l) => l.trim());
    this.node.append(
      el('div.note-tip-head', {}, [
        el('div.note-tip-title', { text: name ?? '' }),
        ...rest.map((l) => el('div.note-tip-meta', { text: l })),
      ]),
      el('div.note-tip-body.md-body', {}, renderMarkdown(note)),
    );
    this.savedTitle = card.title;
    card.title = '';
    this.node.hidden = false;
    this.node.classList.toggle('long', this.node.scrollHeight > this.node.clientHeight + 1);
    this.#place(card.getBoundingClientRect());
  }

  /** 카드 오른쪽에, 모자라면 왼쪽에, 그래도 모자라면 아래에. 화면 안으로 */
  #place(r) {
    const gap = NOTE_TIP.gap;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = this.node.offsetWidth;
    const h = this.node.offsetHeight;
    let x;
    let y = r.top;
    if (r.right + gap + w <= vw - gap) x = r.right + gap;
    else if (r.left - gap - w >= gap) x = r.left - gap - w;
    else { x = r.left; y = r.bottom + gap; if (y + h > vh - gap) y = r.top - gap - h; }
    x = Math.max(gap, Math.min(x, vw - gap - w));
    y = Math.max(gap, Math.min(y, vh - gap - h));
    this.node.style.left = `${Math.round(x)}px`;
    this.node.style.top = `${Math.round(y)}px`;
  }
}
