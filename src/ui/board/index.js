/**
 * 보드 — 시간축 위에 트랙별 일정을 배치하는 메인 뷰.
 *
 * 렌더 단계
 *   1. layout   레인/컬럼 폭 계산 (순수 함수)
 *   2. head     트랙 헤더 + grid-template-columns
 *   3. axis     안쪽 칸 행선 · 바깥 칸(구간) · 오늘 기준선 — 눈금 모드마다 (docs/SCALE.md)
 *   4. cards    일정 카드
 *   5. arrows   실제 좌표를 읽어 선후행 경로를 그림  ← 반드시 1~4 뒤
 *
 * 화살표는 DOM 좌표를 읽으므로 컬럼 폭이 확정된 뒤에 그려야 한다.
 * (P0 시안은 buildHead()를 drawArrows() 뒤에 호출해 한 프레임 어긋났다.)
 */
import { parseDate, dayIndex } from '../../core/dates.js';
import { TimeScale, SlotScale } from '../../core/timescale.js';
import { DateTimeline, SlotTimeline } from '../../core/timeline.js';
import { computeLayout, gridTemplate } from '../../core/layout.js';
import { newId } from '../../core/schema.js';
import { DEFAULT_STATUS, DEFAULT_TYPE, UNIT_DAYS, LAYOUT } from '../../config/index.js';
import { el } from '../dom.js';
import { openCtxMenu } from '../ctxmenu.js';
import { toast } from '../toast.js';
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
      getTimeline: () => this.timeline,
      getZoom: () => this.zoom,
      onChange: () => this.rebuild(),
    });
    attachDrag(grid, {
      store, view,
      getZoom: () => this.zoom,
      getScale: () => this.scale,
      getTimeline: () => this.timeline,
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
      const startWidth = column ? column.offsetWidth : 200;       // 보드 px (확대와 무관)
      const startX = ev.clientX;
      let began = false;

      const move = (e) => {
        const next = Math.min(1200, Math.max(120, Math.round(startWidth + (e.clientX - startX) / this.zoom)));
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
        indicator.style.left = `${(x - headLeft) / this.zoom}px`;   // 헤더 안(확대된 곳)의 px
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
  /**
   * 축 길이 — 날짜 있는 보드는 일수, 날짜 없는 보드는 칸 수. 칸 수는 마지막 일정 뒤로 빈 칸을
   * 몇 개 더 둔다 — 끌어 내리거나 새로 만들 자리. 옮기면 축이 따라 늘고 줄어든다(날짜 축과 같이).
   */
  get totalDays() {
    if (!this.dated) {
      let max = -1;
      for (const it of this.store.items) { const p = this.timeline.pos(it); if (p && p.e > max) max = p.e; }
      return Math.max(12, max + 1 + 4);
    }
    return dayIndex(this.endDate, this.origin);
  }

  /** 보드 배율(Ctrl+휠, .cal의 CSS zoom). 마우스 좌표 차이(화면 px) ÷ zoom = 보드 px */
  get zoom() { return this.view.boardZoom || 1; }

  /** 날짜 있는 보드인가 (docs/SCALE.md §2) */
  get dated() { return this.store.meta.display?.dated !== false; }

  /**
   * 위치 읽기 — 날짜냐 칸이냐를 이것만 안다. 보드·드래그·레인 배치는 위치 인덱스만 다룬다.
   * 문서의 표시 설정·시작일이 바뀌지 않으면 같은 객체를 다시 쓴다.
   */
  get timeline() {
    const d = this.store.meta.display ?? {};
    const k = this.dated ? `d|${this.origin.getTime()}|${d.scale}|${d.slotUnit}` : 'slot';
    if (this._tlKey !== k) {
      this._tlKey = k;
      this._tl = this.dated ? new DateTimeline(this.origin, d) : new SlotTimeline();
    }
    return this._tl;
  }

  /** 펼쳐 들어간 이벤트 id (드릴다운). */
  get focus() { return this.view.focus ?? null; }

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
  /**
   * 스케일 = 위치 ↔ 픽셀. 확대 배율은 '한 행 높이'이고, 한 행이 뜻하는 단위는 눈금 모드가 정한다
   * (주-일 1일 · 월-주 1주 · 분기-월 1개월 · 눈금 없음 1칸). 구간(묶기·높이)은 이 모드의 것만 건다 —
   * 모드마다 따로 기억한다. 눈금 없음에는 바깥 칸이 없어 구간도 없다.
   */
  #buildScale() {
    const tl = this.timeline;
    if (!tl.dated) {
      this.scale = new SlotScale(this.totalDays, this.view.rowH, tl);
      return this.scale;
    }
    const mode = tl.mode;
    const rowDays = mode.key === 'none' ? UNIT_DAYS[tl.slotUnit] ?? 7 : mode.row;
    this.scale = new TimeScale(this.origin, this.totalDays, this.view.ppdFor(rowDays), this.#modeBands(), tl);
    return this.scale;
  }

  /** 지금 눈금 모드의 구간만 — 구간은 모드마다 따로 기억한다. 눈금 없음엔 없다. */
  #modeBands() {
    const key = this.timeline.mode.key;
    if (key === 'none') return [];
    return (this.store.doc.bands ?? []).filter((b) => (b.mode ?? 'month-week') === key);
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

  /** 마지막으로 축을 그린 범위·눈금과 지금이 다른가 */
  #rangeChanged() { return this._axis !== this.#axisKey(); }

  #axisKey() {
    const d = this.store.meta.display ?? {};
    return `${this.dated}|${d.scale}|${d.slotUnit}|${this.origin.getTime()}|${this.totalDays}|${this.scale?.ppd}`;
  }

  #columnsMatchTracks() {
    const tracks = this.store.tracks;
    if (this.columns.size !== tracks.length) return false;
    const rendered = [...this.grid.querySelectorAll('.col')].map((c) => c.dataset.t);
    return rendered.length === tracks.length && rendered.every((id, i) => id === tracks[i].id);
  }

  #computeLayout() {
    // 펼침(드릴다운)이면 focus의 자식이 최상위가 되고 자손만 보인다.
    this._scope = this.#focusScope();
    const visible = (i) => this.view.isVisible(i) && (this._scope === null || this._scope.has(i.id));
    this._layout = computeLayout(
      this.store.tracks, this.store.items, this.timeline, visible, this.focus, (i) => this.#pixelExtent(i),
    );
  }

  /**
   * 카드가 화면에서 차지하는 세로 범위 [s, e) px — card.js의 높이 규칙과 같다(최소 높이·카드 간격·크기 강제).
   * 레인을 이것으로 나눠, 날짜로는 안 겹쳐도 화면에서 겹치는 카드(접힌 구간·짧은 일정)가 서로 제목을 덮지 않게 한다.
   */
  #pixelExtent(item) {
    const tl = this.timeline, sc = this.scale;
    const p = tl.pos(item);
    if (!p) return null;
    const top = sc.y(p.s);
    if (tl.isPoint(item)) return { s: top, e: top + LAYOUT.pointCardHeight };
    const raw = item.place?.hd != null ? sc.extent(p.s, item.place.hd) : sc.heightOf(item);
    return { s: top, e: top + Math.max(LAYOUT.minCardHeight, raw - LAYOUT.cardGap) };
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
    const tl = this.timeline;
    renderAxis({
      lines: this.lines, gutM: this.gutM, gutW: this.gutW, grid: this.grid,
      origin: this.origin, endDate: this.endDate,
      totalDays: this.totalDays,
      bands: this.#modeBands(),
      scale: this.scale,
      timeline: tl,
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

    // 오늘선 — 날짜를 보이는 눈금에서만. 눈금 없음은 날짜 표시를 걷어 낸 보기다.
    if (tl.dated && tl.mode.key !== 'none') {
      const now = makeTodayLine(this.origin, this.totalDays, this.scale);
      if (now) this.grid.append(now);
    }

    // 다음 render()에서 범위/모드 변화를 감지하려고 방금 그린 축을 기록한다
    this._axis = this.#axisKey();
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
      ppd: this.scale.ppd,
      scale: this.scale,
      timeline: this.timeline,
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

      // 펼쳐 들어간 이벤트(focus)의 직속 자식은 최상위처럼 트랙 컬럼에 놓는다.
      const pid = (item.parent && item.parent !== focus) ? item.parent : null;
      const parent = pid ? byId.get(pid) : null;

      const common = {
        ...ctx,
        match: this.view.matches(item),
        parent,
        hasChildren: (childrenOf.get(item.id) ?? []).length > 0,
      };

      // 자식 카드: 상위 카드 안에 한 장.
      if (parent) {
        const host = cardEls.get(parent.id);
        if (!host) continue;
        const node = renderCard(item, {
          ...common, laneInfo: placement.get(item.id), laned: placement.has(item.id), spanBox: null,
        });
        host.append(node);
        cardEls.set(item.id, node);
        continue;
      }

      // 최상위 카드: 소속 트랙을 연속 구간(run)으로 나눈다. 붙은 트랙은 걸쳐서 한 장,
      // 떨어진 구간엔 같은 카드의 사본(echo)을 그 트랙에 따로 놓는다.
      const forced = item.place?.hd != null;
      const isMsPoint = ctx.timeline.isPoint(item);
      const runs = forced ? [[item.place.t]]
        : isMsPoint ? [this.#fillRange(item)] : this.#trackRuns(item);

      runs.forEach((run, r) => {
        const homeTrackId = run[0];
        const host = this.columns.get(homeTrackId);
        if (!host) return;
        const laneInfo = placement.get(`${item.id}@${homeTrackId}`) ?? placement.get(item.id);
        const spanBox = this.#spanBox(run, laneInfo, colWidth);
        const node = renderCard(item, {
          ...common, laneInfo, laned: !!laneInfo, spanBox, echo: r > 0,
        });
        host.append(node);
        if (r === 0) cardEls.set(item.id, node);
      });
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
   * 한 연속 구간(run, 붙어 있는 트랙 id들)에 걸치는 카드의 좌표를 실제 컬럼 너비로 계산한다.
   * 퍼센트로는 트랙마다 너비가 다른 경우를 표현할 수 없고, 레인 분할과도 뒤섞인다.
   * @param {string[]} run  붙어 있는 트랙 id들 (한 덩어리)
   * @returns {{left:number,width:number}|null} 한 칸이면 null (퍼센트 배치)
   */
  #spanBox(run, laneInfo, colWidth) {
    if (!run || run.length <= 1) return null;
    const lanes = Math.max(1, laneInfo?.lanes ?? 1);
    const lane = laneInfo?.lane ?? 0;
    const own = colWidth.get(run[0]) ?? 0;

    // 자기 트랙에서는 레인 몫만, 넘어가는 트랙은 통째로 차지한다
    let width = own / lanes;
    for (let k = 1; k < run.length; k += 1) width += colWidth.get(run[k]) ?? 0;
    return { left: (lane * own) / lanes, width };
  }

  /** 소속 트랙을 연속 구간(run)들로 나눈다 — 사이가 떨어지면 별도 구간. 각 run은 트랙 id 배열. */
  #trackRuns(item) {
    const tracks = this.store.tracks;
    const index = new Map(tracks.map((t, i) => [t.id, i]));
    const members = (Array.isArray(item.place?.tracks) && item.place.tracks.length
      ? item.place.tracks : [item.place?.t]).filter((id) => index.has(id));
    const idxs = [...new Set(members.map((id) => index.get(id)))].sort((a, b) => a - b);
    if (!idxs.length) return [];
    const runs = [];
    let run = [idxs[0]];
    for (let k = 1; k < idxs.length; k += 1) {
      if (idxs[k] === idxs[k - 1] + 1) run.push(idxs[k]);
      else { runs.push(run); run = [idxs[k]]; }
    }
    runs.push(run);
    return runs.map((r) => r.map((i) => tracks[i].id));
  }

  /** 소속 트랙의 최소~최대를 연속으로 채운 한 구간 (점 마일스톤은 한 표식으로 가로지른다). */
  #fillRange(item) {
    const tracks = this.store.tracks;
    const index = new Map(tracks.map((t, i) => [t.id, i]));
    const members = (Array.isArray(item.place?.tracks) && item.place.tracks.length
      ? item.place.tracks : [item.place?.t]).filter((id) => index.has(id));
    const idxs = members.map((id) => index.get(id)).sort((a, b) => a - b);
    if (!idxs.length) return [];
    const out = [];
    for (let i = idxs[0]; i <= idxs[idxs.length - 1]; i += 1) out.push(tracks[i].id);
    return out;
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
      const card = ev.target.closest('.ev');
      if (!card) return;
      const id = card.dataset.id;
      const hasChildren = this.store.items.some((i) => i.parent === id);
      if (hasChildren) { ev.stopPropagation(); this.view.setFocus(id); }
    });

    this.#attachCreate();

    // 우클릭 — 카드에서 '이벤트 복사', 빈 칸에서 '붙여넣기'. 보드를 넘나든다(클립보드는 인스턴스에).
    this.grid.addEventListener('contextmenu', (ev) => {
      if (this.store.readonly) return;
      const card = ev.target.closest('.ev');
      const col = ev.target.closest('.col');
      if (!card && !col) return;
      ev.preventDefault();
      const opts = [];
      if (card) {
        const id = card.dataset.id;
        opts.push({ label: '이벤트 복사', action: () => this.#copyEvent(id) });
      }
      if (col) {
        const at = this.timeline.snap(Math.max(0, Math.floor(this.scale.dayAt((ev.clientY - col.getBoundingClientRect().top) / this.zoom))));
        opts.push({ label: '여기에 붙여넣기', disabled: !this._clip, action: () => this.#pasteEvent(col.dataset.t, at) });
      }
      if (opts.length) openCtxMenu(ev.clientX, ev.clientY, opts);
    });

    this.grid.addEventListener('keydown', (ev) => {
      const card = ev.target.closest('.ev');
      if (card && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        this.handlers.openItem(card.dataset.id);
      }
    });
  }

  /**
   * 우클릭 '이벤트 복사' — 이 카드의 하위 트리(본질+태스크+하위 카드)를 인스턴스 클립보드에.
   * 위치는 이 보드 기준 위치(pos)로 담는다 — 날짜 없는 보드끼리·날짜 있는 보드끼리 상대 위치를 지킨다.
   */
  #copyEvent(id) {
    const tl = this.timeline;
    const serialize = (it) => ({
      ti: it.ti, s: it.s, e: it.e, ty: it.ty, st: it.st, og: it.og, pg: it.pg, note: it.note,
      pos: tl.pos(it), dated: tl.dated,
      tasks: (Array.isArray(it.tasks) ? it.tasks : []).map((t) => ({ text: t.text, done: t.done })),
      children: this.store.items.filter((x) => x.parent === it.id).map(serialize),
    });
    const it = this.store.item(id);
    if (!it) return;
    this._clip = serialize(it);
    toast('이벤트를 복사했습니다 — 빈 칸에서 우클릭 → 붙여넣기');
  }

  /**
   * 우클릭 '붙여넣기' — 복사한 트리를 새 id로 이 트랙·이 위치에 만든다(보드 넘나듦 가능).
   * 같은 종류 보드(날짜↔날짜, 칸↔칸)면 상대 위치를 지켜 옮기고, 종류가 다르면 각 일정을 이 위치에
   * 기본 길이로 놓는다(날짜와 칸은 서로 환산할 근거가 없다).
   */
  #pasteEvent(trackId, at) {
    const clip = this._clip;
    if (!clip || this.store.readonly) return;
    const tl = this.timeline;
    const same = clip.dated === tl.dated && clip.pos;
    const shift = same ? at - clip.pos.s : 0;
    let rootId = null;
    this.store.commit('붙여넣기', (doc) => {
      const build = (node, parent, home) => {
        const id = newId('e');
        if (!rootId) rootId = id;
        const item = {
          id, ti: node.ti ?? '', s: null, e: null,
          ty: node.ty ?? 'bar', st: node.st ?? 'plan', og: node.og ?? '', pg: node.pg ?? 0, note: node.note ?? '',
          parent, alias: null,
          tasks: (node.tasks ?? []).map((t) => ({ id: newId('k'), text: t.text ?? '', done: !!t.done })),
          place: { t: home, sp: 1, x: null, w: null, hd: null, align: 'middle', showNote: false, slot: null },
        };
        if (same && node.pos) tl.set(item, Math.max(0, node.pos.s + shift), Math.max(0, node.pos.e + shift));
        else tl.set(item, at, tl.newEnd(at));
        doc.items.push(item);
        for (const c of (node.children ?? [])) build(c, id, home);
      };
      build(clip, null, trackId);
    });
    if (rootId) { this.handlers.openItem(rootId); }
    toast('붙여넣었습니다');
  }

  /**
   * 빈 곳을 클릭·드래그해 일정을 만든다 (구글 캘린더식).
   *   클릭   기본 길이 카드 — 눈금 모드가 정한다(주-일 1일 · 월-주 1주 · 분기-월 1개월 · 눈금 없음 1칸)
   *   끌기   끈 길이만큼 카드 — 정밀도 단위(step)로 맞춘다
   * 끄는 동안 그 트랙에 미리보기 고스트를 띄운다. 카드 위 포인터다운은
   * 이동(drag.js)이 가져가므로 여기서는 무시한다.
   */
  #attachCreate() {
    let make = null;

    // 포인터가 든 행 — 반올림하면 한 행이 하루인 주-일 보기에서 아래 절반이 다음 날이 된다
    const dayAt = (col, clientY) =>
      Math.max(0, Math.floor(this.scale.dayAt((clientY - col.getBoundingClientRect().top) / this.zoom)));

    /** 끈 범위 [a, b] — 시작은 정밀도 단위의 처음으로, 끝은 그 단위의 끝으로 */
    const range = () => {
      const tl = this.timeline;
      const a = tl.snap(Math.min(make.startDay, make.curDay));
      const b = make.moved ? tl.add(tl.snap(Math.max(make.startDay, make.curDay)), 1) - 1 : tl.newEnd(a);
      return [a, Math.max(a, b)];
    };

    // 클릭(안 끈 상태)이면 기본 길이, 끌었으면 끈 범위를 미리보기로 보여 준다
    const layout = () => {
      const [a, b] = range();
      const top = this.scale.y(a);
      const height = this.scale.y(b) + this.scale.dayHeight(b) - top;
      make.preview.style.top = top + 'px';
      make.preview.style.height = Math.max(this.scale.dayHeight(a), height) + 'px';
    };

    this.grid.addEventListener('pointerdown', (ev) => {
      if (this.store.readonly || ev.button !== 0) return;
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
      const [a, b] = range();
      const m = close();
      this.createItem(m.trackId, a, m.moved ? b : null);   // 클릭 → 기본 길이
    });
    // 취소는 만들지 않고 정리만 한다 (제스처가 끊긴 것)
    this.grid.addEventListener('pointercancel', () => { if (make) close(); });
  }

  /**
   * 지정 트랙/위치에 일정을 만들고 편집 패널을 연다.
   * endPos를 주면 거기까지(끌어서 만든 길이), 없으면 눈금 모드의 기본 길이.
   * 위치는 날짜 있는 보드면 일 인덱스, 날짜 없는 보드면 칸 인덱스다.
   */
  createItem(trackId, startPos, endPos = null) {
    const tl = this.timeline;
    const start = Math.max(0, startPos);
    const end = Math.max(start, endPos == null ? tl.newEnd(start) : endPos);

    const item = {
      id: newId('e'),
      s: null, e: null,
      ti: '새 일정', ty: DEFAULT_TYPE, st: DEFAULT_STATUS,
      og: this.store.orgs[0], pg: 0, dp: [], note: '',
      place: { t: trackId, sp: 1, align: 'middle', showNote: false, hd: null, x: null, w: null, slot: null },
    };
    tl.set(item, start, end);
    this.store.commit('일정 추가', (doc) => { doc.items.push(item); });
    this.handlers.openItem(item.id);
    return item;
  }

  /** 오늘 위치로 스크롤 */
  scrollToToday(scroller) {
    if (!this.dated) { scroller.scrollTop = 0; return; }
    // 스크롤은 화면 px — 보드 px에 배율을 곱한다
    const i = Math.round((new Date().setHours(0, 0, 0, 0) - this.origin) / 86400000);
    scroller.scrollTop = Math.max(0, (this.scale?.y(i) ?? 0) * this.zoom - 80);
  }
}
