/**
 * 보드 — 시간축 위에 트랙별 일정을 배치하는 메인 뷰.
 *
 * 렌더 단계
 *   1. layout   레인/컬럼 폭 계산 (순수 함수)
 *   2. head     트랙 헤더 + grid-template-columns
 *   3. axis     주 행선 · 월 밴드 · 오늘 기준선
 *   4. cards    일정 카드
 *   5. arrows   실제 좌표를 읽어 선후행 경로를 그림  ← 반드시 1~4 뒤
 *
 * 화살표는 DOM 좌표를 읽으므로 컬럼 폭이 확정된 뒤에 그려야 한다.
 * (P0 시안은 buildHead()를 drawArrows() 뒤에 호출해 한 프레임 어긋났다.)
 */
import { parseDate, dayIndex, dateAt } from '../../core/dates.js';
import { computeLayout, gridTemplate } from '../../core/layout.js';
import { newId } from '../../core/schema.js';
import { LAYOUT, DEFAULT_ORG, DEFAULT_STATUS, DEFAULT_TYPE } from '../../config/index.js';
import { el, clear } from '../dom.js';
import { renderHead } from './head.js';
import { renderAxis, makeTodayLine } from './axis.js';
import { renderCard } from './card.js';
import { createArrowLayer, drawArrows } from './arrows.js';
import { attachDrag } from './drag.js';

export class Board {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.head   .head
   * @param {HTMLElement} opts.grid   .body
   * @param {HTMLElement} opts.lines  .lines
   * @param {HTMLElement} opts.gutM   .gut-m
   * @param {HTMLElement} opts.gutW   .gut-w
   */
  constructor({ head, grid, lines, gutM, gutW, store, view, handlers }) {
    Object.assign(this, { head, grid, lines, gutM, gutW, store, view });
    this.handlers = handlers;          // {openItem, openTrack, addTrack}
    this.columns = new Map();
    this.arrowLayer = createArrowLayer();
    this._layout = { placement: new Map(), trackLanes: new Map() };

    this.#attachEvents();
    attachDrag(grid, {
      store, view,
      getOrigin: () => this.origin,
      getTotalDays: () => this.totalDays,
      onDragEnd: (id) => this.handlers.openItem(id),
    });
  }

  get origin() { return parseDate(this.store.meta.start); }
  get endDate() { return parseDate(this.store.meta.end); }
  get totalDays() { return dayIndex(this.store.meta.end, this.origin); }

  // ── 렌더 ────────────────────────────────────────────────

  /** 트랙/기간/배율이 바뀐 경우: 골격부터 전부 다시. */
  rebuild() {
    this.#computeLayout();
    this.#renderHead();
    this.#renderSkeleton();
    this.renderCards();
  }

  /** 일정만 바뀐 경우. 컬럼 폭이 달라질 수 있어 head도 갱신한다. */
  render() {
    this.#computeLayout();
    this.#renderHead();
    this.renderCards();
  }

  #computeLayout() {
    this._layout = computeLayout(
      this.store.tracks, this.store.items, this.origin, (i) => this.view.isVisible(i),
    );
  }

  #renderHead() {
    const template = gridTemplate(this.store.tracks, this._layout.trackLanes);
    this.grid.style.gridTemplateColumns = template;
    renderHead(this.head, {
      tracks: this.store.tracks,
      items: this.store.items,
      selectedTrack: this.view.selectedTrack,
      template,
      onSelect: (id) => this.handlers.openTrack(id),
      onAddTrack: () => this.handlers.addTrack(),
    });
  }

  /** 시간축 + 트랙 컬럼 + 오늘선 + 화살표 레이어 */
  #renderSkeleton() {
    renderAxis({
      lines: this.lines, gutM: this.gutM, gutW: this.gutW, grid: this.grid,
      origin: this.origin, endDate: this.endDate,
      totalDays: this.totalDays, ppd: this.view.ppd,
    });

    for (const node of this.grid.querySelectorAll('.col,.pad,.now,.arrows')) node.remove();
    this.columns.clear();

    for (const track of this.store.tracks) {
      const col = el('div.col', { dataset: { t: track.id } });
      this.columns.set(track.id, col);
      this.grid.append(col);
    }
    this.grid.append(el('div.pad'));
    this.grid.append(this.arrowLayer);

    const now = makeTodayLine(this.origin, this.totalDays, this.view.ppd);
    if (now) this.grid.append(now);
  }

  renderCards() {
    for (const node of this.grid.querySelectorAll('.ev')) node.remove();

    const ctx = {
      origin: this.origin,
      ppd: this.view.ppd,
      placement: this._layout.placement,
      selectedId: this.view.selectedItem,
      match: null,
    };

    for (const item of this.store.items) {
      const col = this.columns.get(item.t);
      if (!col || !this.view.isVisible(item)) continue;
      col.append(renderCard(item, { ...ctx, match: this.view.matches(item) }));
    }

    // 카드가 붙은 뒤에야 offsetLeft/offsetTop이 확정된다
    drawArrows(this.arrowLayer, this.grid, this.store.items);
  }

  redrawArrows() {
    drawArrows(this.arrowLayer, this.grid, this.store.items);
  }

  // ── 입력 ────────────────────────────────────────────────

  #attachEvents() {
    this.grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.ev');
      if (card) this.handlers.openItem(card.dataset.id);
    });

    this.grid.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.ev')) return;
      const col = ev.target.closest('.col');
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const day = Math.max(0, Math.round((ev.clientY - rect.top) / this.view.ppd));
      this.createItem(col.dataset.t, day);
    });

    this.grid.addEventListener('keydown', (ev) => {
      const card = ev.target.closest('.ev');
      if (card && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        this.handlers.openItem(card.dataset.id);
      }
    });
  }

  /** 지정 트랙/일자에 기본 길이 일정을 만들고 편집 패널을 연다. */
  createItem(trackId, startDay) {
    const origin = this.origin;
    const total = this.totalDays;
    const start = Math.max(0, Math.min(total - 1, startDay));
    const end = Math.min(total - 1, start + LAYOUT.newItemDays - 1);

    const item = {
      id: newId('e'), t: trackId, sp: 1,
      s: dateAt(origin, start), e: dateAt(origin, end),
      ti: '새 일정', ty: DEFAULT_TYPE, st: DEFAULT_STATUS,
      og: DEFAULT_ORG, pg: 0, dp: [], note: '',
    };
    this.store.commit('일정 추가', (doc) => { doc.items.push(item); });
    this.handlers.openItem(item.id);
    return item;
  }

  /** 오늘 위치로 스크롤 */
  scrollToToday(scroller) {
    const i = Math.round((new Date().setHours(0, 0, 0, 0) - this.origin) / 86400000);
    scroller.scrollTop = Math.max(0, i * this.view.ppd - 80);
  }
}
