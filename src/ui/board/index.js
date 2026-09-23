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
import { TimeScale } from '../../core/timescale.js';
import { computeLayout, gridTemplate } from '../../core/layout.js';
import { newId } from '../../core/schema.js';
import { LAYOUT, DEFAULT_STATUS, DEFAULT_TYPE } from '../../config/index.js';
import { el, clear } from '../dom.js';
import { renderHead } from './head.js';
import { renderAxis, makeTodayLine } from './axis.js';
import { attachBandEditing } from './bands.js';
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
    attachBandEditing(gutM, {
      store,
      getOrigin: () => this.origin,
      getScale: () => this.scale,
      onChange: () => this.rebuild(),
    });
    attachDrag(grid, {
      store, view,
      getOrigin: () => this.origin,
      getTotalDays: () => this.totalDays,
      getScale: () => this.scale,
      onDragEnd: (id) => this.handlers.openItem(id),
    });
  }

  /**
   * 트랙 열 너비 드래그.
   *
   * 리스너를 손잡이 요소에 붙이면 안 된다. 드래그 중 store.commit이 재렌더를
   * 부르고, 재렌더는 헤더를 통째로 다시 그리면서 그 손잡이를 DOM에서 없앤다.
   * 리스너와 포인터 캡처가 같이 사라져 첫 픽셀 이후 이벤트가 끊긴다.
   * 그래서 window에 붙이고 드래그가 끝날 때 떼어 낸다.
   *
   * 너비는 문서에 저장한다 — 반출한 JSON을 다른 PC에서 열어도 같은 모양이어야 한다.
   */
  #trackResizer = {
    start: (trackId, ev) => {
      if (this.store.readonly) return;

      const column = this.columns.get(trackId);
      const startWidth = column ? column.getBoundingClientRect().width : 200;
      const startX = ev.clientX;
      let began = false;

      const move = (e) => {
        const next = Math.min(1200, Math.max(120, Math.round(startWidth + (e.clientX - startX))));
        if (!began) { this.store.begin('트랙 너비'); began = true; }
        this.store.commit('트랙 너비', (doc) => {
          const track = doc.tracks.find((t) => t.id === trackId);
          if (track) track.w = next;
        });
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col');
        if (began) this.store.end();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      document.body.classList.add('resizing-col');
    },

    reset: (trackId) => {
      this.store.commit('트랙 너비 자동', (doc) => {
        const track = doc.tracks.find((t) => t.id === trackId);
        if (track) track.w = null;
      });
    },
  };

  get origin() { return parseDate(this.store.meta.start); }
  get endDate() { return parseDate(this.store.meta.end); }
  get totalDays() { return dayIndex(this.store.meta.end, this.origin); }

  /** 일 인덱스 ↔ 픽셀. 묶어서 접은 구간이 있으면 그만큼 눌린다. */
  #buildScale() {
    this.scale = new TimeScale(this.origin, this.totalDays, this.view.ppd, this.store.doc.bands ?? []);
    return this.scale;
  }

  // ── 렌더 ────────────────────────────────────────────────

  /** 트랙/기간/배율이 바뀐 경우: 골격부터 전부 다시. */
  rebuild() {
    this.#buildScale();
    this.#computeLayout();
    this.#renderHead();
    this.#renderSkeleton();
    this.renderCards();
  }

  /**
   * 일정만 바뀐 경우. 컬럼 폭이 달라질 수 있어 head도 갱신한다.
   *
   * 트랙이 늘거나 줄거나 순서가 바뀌었으면 본문 컬럼(.col)까지 다시 만든다.
   * 헤더만 갱신하면 새 트랙에 카드가 들어갈 자리가 없어서, 그 트랙에는
   * 카드가 그려지지도 않고 빈 칸을 더블클릭해도 일정이 생기지 않는다.
   */
  render() {
    this.#buildScale();
    this.#computeLayout();
    this.#renderHead();
    if (!this.#columnsMatchTracks()) this.#renderSkeleton();
    this.renderCards();
  }

  #columnsMatchTracks() {
    const tracks = this.store.tracks;
    if (this.columns.size !== tracks.length) return false;
    const rendered = [...this.grid.querySelectorAll('.col')].map((c) => c.dataset.t);
    return rendered.length === tracks.length && rendered.every((id, i) => id === tracks[i].id);
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
      onResize: this.#trackResizer,
    });
  }

  /** 시간축 + 트랙 컬럼 + 오늘선 + 화살표 레이어 */
  #renderSkeleton() {
    renderAxis({
      lines: this.lines, gutM: this.gutM, gutW: this.gutW, grid: this.grid,
      origin: this.origin, endDate: this.endDate,
      totalDays: this.totalDays, ppd: this.view.ppd,
      bands: this.store.doc.bands ?? [],
      scale: this.scale,
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

    const now = makeTodayLine(this.origin, this.totalDays, this.scale);
    if (now) this.grid.append(now);
  }

  /**
   * 카드를 그린다. 상위 일정부터 그려야 자식이 들어갈 자리가 생기므로
   * 깊이 순으로 훑는다. 상위가 필터에 걸려 빠지면 자식도 함께 빠진다.
   */
  renderCards() {
    for (const node of this.grid.querySelectorAll('.ev')) node.remove();
    this.grid.style.setProperty('--fs', this.store.meta.display?.fontScale ?? 1);

    const { placement, childrenOf, depthOf } = this._layout;
    const ctx = {
      origin: this.origin,
      ppd: this.view.ppd,
      scale: this.scale,
      placement,
      selectedId: this.view.selectedItem,
    };

    const byId = new Map(this.store.items.map((i) => [i.id, i]));
    const cardEls = new Map();
    const colWidth = this.#columnWidths();

    const ordered = [...this.store.items].sort(
      (a, b) => (depthOf.get(a.id) ?? 0) - (depthOf.get(b.id) ?? 0),
    );

    for (const item of ordered) {
      if (!this.view.isVisible(item)) continue;

      const parent = item.parent ? byId.get(item.parent) : null;
      // 상위 카드가 안 그려졌으면(숨김/필터) 자식도 놓을 자리가 없다
      const host = parent ? cardEls.get(parent.id) : this.columns.get(item.t);
      if (!host) continue;

      const node = renderCard(item, {
        ...ctx,
        match: this.view.matches(item),
        parent,
        hasChildren: (childrenOf.get(item.id) ?? []).length > 0,
        spanBox: parent ? null : this.#spanBox(item, placement.get(item.id), colWidth),
      });
      host.append(node);
      cardEls.set(item.id, node);
    }

    // 카드가 붙은 뒤에야 offsetLeft/offsetTop이 확정된다
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.meta.display);
  }

  /** 각 트랙 컬럼의 실제 너비(px) */
  #columnWidths() {
    const widths = new Map();
    for (const [id, col] of this.columns) widths.set(id, col.offsetWidth);
    return widths;
  }

  /**
   * 여러 트랙에 걸치는 카드의 좌표를 실제 컬럼 너비로 계산한다.
   * 퍼센트로는 트랙마다 너비가 다른 경우를 표현할 수 없고, 레인 분할과도 뒤섞인다.
   * @returns {{left:number,width:number}|null} 걸치지 않으면 null (퍼센트 배치)
   */
  #spanBox(item, place, colWidth) {
    const span = Math.max(1, item.sp ?? 1);
    if (span <= 1) return null;

    const tracks = this.store.tracks;
    const home = tracks.findIndex((t) => t.id === item.t);
    if (home < 0) return null;

    const lanes = Math.max(1, place?.lanes ?? 1);
    const lane = place?.lane ?? 0;
    const own = colWidth.get(item.t) ?? 0;

    // 자기 트랙에서는 레인 몫만, 넘어가는 트랙은 통째로 차지한다
    let width = own / lanes;
    for (let k = 1; k < span && home + k < tracks.length; k++) {
      width += colWidth.get(tracks[home + k].id) ?? 0;
    }
    return { left: (lane * own) / lanes, width };
  }

  redrawArrows() {
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.meta.display);
  }

  // ── 입력 ────────────────────────────────────────────────

  #attachEvents() {
    this.grid.addEventListener('click', (ev) => {
      // 텍스트 선택 모드에서는 패널을 열지 않는다.
      // 열면 재렌더가 일어나 카드가 새로 그려지고 긁어 둔 선택이 날아간다.
      if (this.view.textSelect) return;
      const card = ev.target.closest('.ev');
      if (card) this.handlers.openItem(card.dataset.id);
    });

    // 자식 카드의 가로 폭 손잡이를 더블클릭하면 자동 배치로 되돌린다
    this.grid.addEventListener('dblclick', (ev) => {
      const cls = ev.target.classList;
      if (cls.contains('grip-hw') || cls.contains('grip-he')) {
        const card = ev.target.closest('.ev');
        ev.stopPropagation();
        this.store.commit('가로 폭 자동', () => {
          const item = this.store.item(card.dataset.id);
          if (item) { item.x = null; item.w = null; }
        });
      }
    });

    this.grid.addEventListener('dblclick', (ev) => {
      if (this.view.textSelect) return;
      if (ev.target.closest('.ev')) return;
      const col = ev.target.closest('.col');
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const day = Math.max(0, Math.round(this.scale.dayAt(ev.clientY - rect.top)));
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
      og: this.store.orgs[0], pg: 0, dp: [], note: '',
    };
    this.store.commit('일정 추가', (doc) => { doc.items.push(item); });
    this.handlers.openItem(item.id);
    return item;
  }

  /** 오늘 위치로 스크롤 */
  scrollToToday(scroller) {
    const i = Math.round((new Date().setHours(0, 0, 0, 0) - this.origin) / 86400000);
    scroller.scrollTop = Math.max(0, (this.scale?.y(i) ?? 0) - 80);
  }
}
