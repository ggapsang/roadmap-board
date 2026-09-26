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
import { computeOrder, orderLayout, OrderScale } from '../../core/order.js';
import { newId } from '../../core/schema.js';
import { LAYOUT, DEFAULT_STATUS, DEFAULT_TYPE } from '../../config/index.js';
import { el, clear } from '../dom.js';
import { renderHead } from './head.js';
import { renderAxis, makeTodayLine } from './axis.js';
import { attachBandEditing } from './bands.js';
import { renderCard, fitTitle } from './card.js';
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
      getOrderMode: () => this.orderMode,
      onChange: () => this.rebuild(),
    });
    attachDrag(grid, {
      store, view,
      getOrigin: () => this.origin,
      getTotalDays: () => this.totalDays,
      getScale: () => this.scale,
      getOrderMode: () => this.orderMode,
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

  /**
   * 트랙 열 순서 드래그 (엑셀식). 헤더를 잡아 옆으로 끌면 트랙 순서가 바뀐다.
   * #trackResizer와 같은 이유로 window에 리스너를 붙인다 — 드롭 시 재렌더가
   * 헤더를 통째로 새로 그리기 때문이다. 순서는 드롭할 때 한 번만 커밋한다.
   * 살짝 눌렀다 떼면(임계값 미만) 드래그가 아니라 클릭 — 트랙 구성 패널을 연다.
   */
  #trackReorder = {
    start: (trackId, ev) => {
      if (this.store.readonly) return;

      const headers = [...this.head.querySelectorAll('.th')];
      const cell = headers.find((h) => h.dataset.t === trackId);
      const fromIndex = this.store.tracks.findIndex((t) => t.id === trackId);
      if (fromIndex < 0 || !cell) return;

      const startX = ev.clientX;
      const indicator = el('div.th-drop', { attrs: { 'aria-hidden': 'true' } });
      let dragging = false;
      let targetIndex = fromIndex;

      const place = () => {
        const rects = headers.map((h) => h.getBoundingClientRect());
        const headLeft = this.head.getBoundingClientRect().left;
        const x = targetIndex >= rects.length ? rects[rects.length - 1].right : rects[targetIndex].left;
        indicator.style.left = `${x - headLeft}px`;
      };

      const move = (e) => {
        if (!dragging && Math.abs(e.clientX - startX) < 5) return;
        if (!dragging) {
          dragging = true;
          cell.classList.add('dragging');
          this.head.append(indicator);
          document.body.classList.add('reordering-col');
        }
        e.preventDefault();
        const rects = headers.map((h) => h.getBoundingClientRect());
        let idx = rects.findIndex((r) => e.clientX < r.left + r.width / 2);
        if (idx < 0) idx = rects.length;
        targetIndex = idx;
        place();
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        indicator.remove();
        cell.classList.remove('dragging');
        document.body.classList.remove('reordering-col');
        if (!dragging) return;                       // 클릭이었다 — onSelect가 처리

        // 끌어낸 자리를 빼고 나면 뒤쪽 인덱스가 하나 당겨진다
        let to = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
        to = Math.max(0, Math.min(this.store.tracks.length - 1, to));
        if (to !== fromIndex) {
          this.store.commit('트랙 순서', (doc) => {
            const [moved] = doc.tracks.splice(fromIndex, 1);
            doc.tracks.splice(to, 0, moved);
          });
        }
        // 드래그 끝의 click이 트랙 패널을 열지 않도록 한 번 삼킨다
        this._suppressHeadClick = true;
        setTimeout(() => { this._suppressHeadClick = false; }, 0);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
  };

  /**
   * 축 범위 = 선언한 기간(meta) ∪ 모든 일정. 일정을 meta 밖(예: 8월)으로 옮기면
   * 축 위로 튀어나가 사라지는 게 아니라 축이 그만큼 늘어난다. meta는 "선언한 범위"
   * 그대로 두고(헤더 표기·데이터 패널·반출용) 실제 축만 일정까지 덮으므로,
   * 일정을 다시 안으로 넣으면 축도 스스로 원래대로 줄어든다.
   * ISO 문자열은 사전식 비교가 곧 날짜순이라 그대로 min/max 한다.
   */
  get origin() {
    let min = this.store.meta.start;
    for (const it of this.store.items) if (it.s && it.s < min) min = it.s;
    return parseDate(min);
  }
  get endDate() {
    let max = this.store.meta.end;
    for (const it of this.store.items) {
      const e = it.e || it.s;
      if (e && e > max) max = e;
    }
    return parseDate(max);
  }
  get totalDays() { return dayIndex(this.endDate, this.origin); }

  /** 순서 모드 — 축이 달력이 아니라 rank(선행 순서). DIRECTION #4-c (초안). */
  get orderMode() { return this.store.meta.display?.axis === 'order'; }

  /** 펼쳐 들어간 이벤트 id (드릴다운). 순서 모드에선 쓰지 않는다. */
  get focus() { return this.orderMode ? null : (this.view.focus ?? null); }

  /**
   * 펼침 범위 — focus의 자손 id 집합. focus가 없으면 null(전체). focus의 직속 자식이
   * 최상위가 되고, 그 아래는 중첩으로 그려진다.
   */
  #focusScope() {
    const f = this.focus;
    if (!f) return null;
    const childrenBy = new Map();
    for (const it of this.store.items) {
      const p = it.parent ?? null;
      if (!childrenBy.has(p)) childrenBy.set(p, []);
      childrenBy.get(p).push(it.id);
    }
    const out = new Set();
    const walk = (id) => { for (const c of (childrenBy.get(id) ?? [])) { if (!out.has(c)) { out.add(c); walk(c); } } };
    walk(f);
    return out;
  }
  /** 순서 모드의 한 rank 행 높이(px). 확대 배율을 그대로 쓴다. */
  get rowH() { return this.view.weekHeight; }

  /**
   * 스케일 = 일 인덱스 ↔ 픽셀. 묶어서 접은 구간이 있으면 그만큼 눌린다.
   * 지금은 '달력 스케일'(TimeScale)만 구현한다. meta.display.axis === 'order'가 되면
   * 여기서 순서 스케일이 끼어든다 — 스케일은 yOf/span/dayAt/height 인터페이스만 맞추면 된다
   * (docs/DIRECTION.md #4). 그래서 Board 나머지 코드는 '달력'을 몰라도 된다.
   */
  #buildScale() {
    if (this.orderMode) {
      this._rank = computeOrder(this.store.items, this.store.relations);
      this.scale = new OrderScale(this._rank, this.rowH);
    } else {
      this.scale = new TimeScale(this.origin, this.totalDays, this.view.ppd, this.store.doc.bands ?? []);
    }
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
    // 축(골격)은 트랙이 바뀔 때만 다시 그린다. 단, 일정을 옮겨 축 범위가 늘거나
    // 줄면 눈금·월밴드도 다시 그려야 한다 — 안 그러면 카드는 새 범위로 놓이는데
    // 축은 옛 범위라 서로 어긋난다.
    if (!this.#columnsMatchTracks() || this.#rangeChanged()) this.#renderSkeleton();
    this.renderCards();
    this.#renderCrumbs();
  }

  /** 펼침 경로 — [보드] › 조상… › 지금. 클릭하면 그 층으로 접어 나온다 (PDF §8). */
  #renderCrumbs() {
    const bar = document.getElementById('crumbs');
    if (!bar) return;
    const focus = this.focus;
    if (!focus) { bar.hidden = true; bar.replaceChildren(); return; }
    const byId = new Map(this.store.items.map((i) => [i.id, i]));
    const path = [];
    let cur = byId.get(focus);
    let guard = 0;
    while (cur && guard++ < 64) { path.unshift(cur); cur = cur.parent ? byId.get(cur.parent) : null; }

    const crumb = (label, id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb';
      b.textContent = label;
      b.addEventListener('click', () => this.view.setFocus(id));
      return b;
    };
    const sep = () => { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; return s; };

    bar.replaceChildren();
    bar.append(crumb(this.store.meta.name || '보드', null));
    for (const it of path) {
      bar.append(sep(), crumb(it.ti || '(제목 없음)', it.id));
    }
    bar.hidden = false;
  }

  /** 마지막으로 축을 그린 범위와 지금 범위가 다른가 */
  #rangeChanged() {
    if (!this._axis || this._axis.order !== this.orderMode) return true;
    if (this.orderMode) return this._axis.days !== (this._rank?.size ?? 0);
    return this._axis.origin !== this.origin.getTime() || this._axis.days !== this.totalDays;
  }

  #columnsMatchTracks() {
    const tracks = this.store.tracks;
    if (this.columns.size !== tracks.length) return false;
    const rendered = [...this.grid.querySelectorAll('.col')].map((c) => c.dataset.t);
    return rendered.length === tracks.length && rendered.every((id, i) => id === tracks[i].id);
  }

  #computeLayout() {
    if (this.orderMode) {
      // 순서 모드: 세로는 rank(스케일), 가로는 같은 트랙·같은 rank끼리만 레인 분할.
      const placement = orderLayout(
        this.store.tracks, this.store.items, this._rank ?? new Map(), (i) => this.view.isVisible(i),
      );
      this._layout = { placement, trackLanes: new Map(), childrenOf: new Map(), depthOf: new Map() };
      return;
    }
    // 펼침(드릴다운)이면 focus의 자식이 최상위가 되고 자손만 보인다.
    this._scope = this.#focusScope();
    const visible = (i) => this.view.isVisible(i) && (this._scope === null || this._scope.has(i.id));
    this._layout = computeLayout(
      this.store.tracks, this.store.items, this.origin, visible, this.focus,
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
      onSelect: (id) => { if (!this._suppressHeadClick) this.handlers.openTrack(id); },
      onAddTrack: () => this.handlers.addTrack(),
      onResize: this.#trackResizer,
      onReorder: this.#trackReorder,
    });
  }

  /** 시간축 + 트랙 컬럼 + 오늘선 + 화살표 레이어 */
  #renderSkeleton() {
    if (this.orderMode) {
      this.#renderOrderAxis();
    } else {
      renderAxis({
        lines: this.lines, gutM: this.gutM, gutW: this.gutW, grid: this.grid,
        origin: this.origin, endDate: this.endDate,
        totalDays: this.totalDays, ppd: this.view.ppd,
        bands: this.store.doc.bands ?? [],
        scale: this.scale,
      });
    }

    for (const node of this.grid.querySelectorAll('.col,.pad,.now,.arrows')) node.remove();
    this.columns.clear();

    for (const track of this.store.tracks) {
      const col = el('div.col', { dataset: { t: track.id } });
      this.columns.set(track.id, col);
      this.grid.append(col);
    }
    this.grid.append(el('div.pad'));
    this.grid.append(this.arrowLayer);

    if (!this.orderMode) {
      const now = makeTodayLine(this.origin, this.totalDays, this.scale);
      if (now) this.grid.append(now);
    }

    // 다음 render()에서 범위/모드 변화를 감지하려고 방금 그린 축을 기록한다
    this._axis = {
      order: this.orderMode,
      origin: this.orderMode ? 0 : this.origin.getTime(),
      days: this.orderMode ? (this._rank?.size ?? 0) : this.totalDays,
    };
  }

  /** 순서 모드 축 — 왼쪽 칸에 rank 순번을 표시한다 (달력·오늘선 없음). DIRECTION #4-c 초안. */
  #renderOrderAxis() {
    clear(this.lines); clear(this.gutM); clear(this.gutW);
    this.grid.style.height = this.scale.height + 'px';
    let max = 0;
    for (const v of (this._rank ?? new Map()).values()) max = Math.max(max, v);
    for (let r = 0; r <= max; r++) {
      const y = r * this.rowH;
      this.lines.append(el('i', { className: 'm', style: { top: `${y}px` } }));
      this.gutM.append(el('b', {
        style: { top: `${y}px`, height: `${this.rowH}px` },
        dataset: { from: String(r), to: String(r + 1), band: '' },
      }, [el('u', {}, [document.createTextNode(String(r + 1)), el('em', { text: '순서' })])]));
    }
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

    const focus = this.focus;
    for (const item of ordered) {
      if (!this.view.isVisible(item)) continue;
      if (this._scope && !this._scope.has(item.id)) continue;   // 펼침 범위 밖은 숨긴다

      // 순서 모드(초안)는 중첩을 펼쳐(flatten) 모두 트랙의 한 카드로 다룬다.
      // 펼쳐 들어간 이벤트(focus)의 직속 자식은 최상위처럼 트랙 컬럼에 놓는다.
      const pid = (item.parent && item.parent !== focus) ? item.parent : null;
      const parent = this.orderMode ? null : (pid ? byId.get(pid) : null);
      // 상위 카드가 안 그려졌으면(숨김/필터) 자식도 놓을 자리가 없다
      const host = parent ? cardEls.get(parent.id) : this.columns.get(item.place.t);
      if (!host) continue;

      const node = renderCard(item, {
        ...ctx,
        match: this.view.matches(item),
        parent,
        hasChildren: !this.orderMode && (childrenOf.get(item.id) ?? []).length > 0,
        spanBox: (parent || this.orderMode) ? null : this.#spanBox(item, placement.get(item.id), colWidth),
      });
      host.append(node);
      cardEls.set(item.id, node);
    }

    // 카드가 붙어 크기가 확정된 뒤 제목이 넘치면 폰트를 줄여 잘리지 않게 한다
    for (const node of cardEls.values()) fitTitle(node);

    // 카드가 붙은 뒤에야 offsetLeft/offsetTop이 확정된다
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.relations, this.store.meta.display);
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
    const span = Math.max(1, item.place.sp ?? 1);
    if (span <= 1) return null;

    const tracks = this.store.tracks;
    const home = tracks.findIndex((t) => t.id === item.place.t);
    if (home < 0) return null;

    const lanes = Math.max(1, place?.lanes ?? 1);
    const lane = place?.lane ?? 0;
    const own = colWidth.get(item.place.t) ?? 0;

    // 자기 트랙에서는 레인 몫만, 넘어가는 트랙은 통째로 차지한다
    let width = own / lanes;
    for (let k = 1; k < span && home + k < tracks.length; k++) {
      width += colWidth.get(tracks[home + k].id) ?? 0;
    }
    return { left: (lane * own) / lanes, width };
  }

  redrawArrows() {
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.relations, this.store.meta.display);
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
          if (item) { item.place.x = null; item.place.w = null; }
        });
        return;
      }
      // 자식을 품은 카드를 더블클릭하면 펼친다 — 그 자식들이 하나의 보드로 (PDF §8).
      if (this.orderMode) return;
      const card = ev.target.closest('.ev');
      if (!card) return;
      const id = card.dataset.id;
      const hasChildren = this.store.items.some((i) => i.parent === id);
      if (hasChildren) { ev.stopPropagation(); this.view.setFocus(id); }
    });

    this.#attachCreate();

    this.grid.addEventListener('keydown', (ev) => {
      const card = ev.target.closest('.ev');
      if (card && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        this.handlers.openItem(card.dataset.id);
      }
    });
  }

  /**
   * 빈 곳을 클릭·드래그해 일정을 만든다 (구글 캘린더식).
   *   클릭   기본 한 칸(1주) 카드
   *   끌기   끈 길이만큼 카드
   * 끄는 동안 그 트랙에 미리보기 고스트를 띄운다. 카드 위 포인터다운은
   * 이동(drag.js)이 가져가므로 여기서는 무시한다.
   */
  #attachCreate() {
    let make = null;

    const dayAt = (col, clientY) =>
      Math.max(0, Math.round(this.scale.dayAt(clientY - col.getBoundingClientRect().top)));

    // 클릭(안 끈 상태)이면 기본 1주, 끌었으면 끈 범위를 미리보기로 보여 준다
    const layout = () => {
      const a = Math.min(make.startDay, make.curDay);
      const b = make.moved ? Math.max(make.startDay, make.curDay) : a + LAYOUT.newItemDays - 1;
      const top = this.scale.y(a);
      const height = this.scale.y(b) + this.scale.dayHeight(b) - top;
      make.preview.style.top = top + 'px';
      make.preview.style.height = Math.max(this.scale.dayHeight(a), height) + 'px';
    };

    this.grid.addEventListener('pointerdown', (ev) => {
      if (this.store.readonly || ev.button !== 0) return;
      if (this.orderMode) return;                // 순서 모드(초안)에선 날짜 생성 비활성
      if (this.view.textSelect) return;
      if (ev.target.closest('.ev')) return;      // 카드 이동은 drag.js 몫
      const col = ev.target.closest('.col');
      if (!col) return;
      const startDay = dayAt(col, ev.clientY);
      const preview = el('div.create-preview', { attrs: { 'aria-hidden': 'true' } });
      col.append(preview);
      make = { col, trackId: col.dataset.t, startDay, curDay: startDay, moved: false, preview, pointerId: ev.pointerId };
      layout();
      this.grid.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    this.grid.addEventListener('pointermove', (ev) => {
      if (!make) return;
      const day = dayAt(make.col, ev.clientY);
      if (Math.abs(day - make.startDay) >= 1) make.moved = true;
      make.curDay = day;
      layout();
    });

    const close = () => {
      const m = make;
      make = null;
      m.preview.remove();
      if (this.grid.hasPointerCapture(m.pointerId)) this.grid.releasePointerCapture(m.pointerId);
      return m;
    };

    this.grid.addEventListener('pointerup', () => {
      if (!make) return;
      const m = close();
      if (m.moved) {
        this.createItem(m.trackId, Math.min(m.startDay, m.curDay), Math.max(m.startDay, m.curDay));
      } else {
        this.createItem(m.trackId, m.startDay);   // 클릭 → 기본 1주
      }
    });
    // 취소는 만들지 않고 정리만 한다 (제스처가 끊긴 것)
    this.grid.addEventListener('pointercancel', () => { if (make) close(); });
  }

  /**
   * 지정 트랙/일자에 일정을 만들고 편집 패널을 연다.
   * endDay를 주면 그 날까지(끌어서 만든 길이), 없으면 기본 한 칸(1주).
   */
  createItem(trackId, startDay, endDay = null) {
    const origin = this.origin;
    const total = this.totalDays;
    const start = Math.max(0, Math.min(total - 1, startDay));
    const end = endDay == null
      ? Math.min(total - 1, start + LAYOUT.newItemDays - 1)
      : Math.min(total - 1, Math.max(start, endDay));

    const item = {
      id: newId('e'),
      s: dateAt(origin, start), e: dateAt(origin, end),
      ti: '새 일정', ty: DEFAULT_TYPE, st: DEFAULT_STATUS,
      og: this.store.orgs[0], pg: 0, dp: [], note: '',
      place: { t: trackId, sp: 1, align: 'middle', showNote: false, hd: null, x: null, w: null },
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
