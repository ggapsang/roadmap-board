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
import { parseDate, dayIndex, shortMD } from '../../core/dates.js';
import { TimeScale, SlotScale, topOffset } from '../../core/timescale.js';
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
import { anchorPoint, anchorFromPoint, elbowRoute, overrideFromRoute } from '../../core/arrow-geometry.js';
import { attachDrag } from './drag.js';
import { MemoLayer } from './memos.js';

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
    this.memos = new MemoLayer({ grid, store, view, board: () => this });
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
      this.scale = new SlotScale(this.totalDays, this.view.rowH, tl, this.store.meta.display?.slotRows ?? {});
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
    this._hidden = this.#hiddenSet();
    const visible = (i) => this.view.isVisible(i) && !this._hidden.has(i.id) && (this._scope === null || this._scope.has(i.id));
    this._layout = computeLayout(
      this.store.tracks, this.store.items, this.timeline, visible, this.focus, (i) => this.#pixelExtent(i),
    );
  }

  /**
   * 이 보드에서 숨긴 하위 카드(모자관계설정의 눈, meta.hidden)와 그 안에 든 것 — 포함은 그대로, 그리지만 않는다.
   * 다른 보드에서는 보인다(보드 표시 값).
   */
  #hiddenSet() {
    const marked = new Set(this.store.meta.hidden ?? []);
    const out = new Set();
    if (!marked.size) return out;
    for (const it of this.store.items) {
      let cur = it;
      let guard = 0;
      while (cur && guard++ < 256) {
        if (marked.has(cur.id)) { out.add(it.id); break; }
        cur = cur.parent ? this.store.item(cur.parent) : null;
      }
    }
    return out;
  }

  /** 숨기지 않은 자식이 있는가(다 숨겼으면 보통 카드로 그린다) */
  hasShownChildren(id) {
    return this.store.items.some((i) => i.parent === id && !this._hidden?.has(i.id));
  }

  /**
   * 카드가 화면에서 차지하는 세로 범위 [s, e) px — card.js의 높이 규칙과 같다(최소 높이·카드 간격·크기 강제).
   * 레인을 이것으로 나눠, 날짜로는 안 겹쳐도 화면에서 겹치는 카드(접힌 구간·짧은 일정)가 서로 제목을 덮지 않게 한다.
   */
  #pixelExtent(item) {
    const tl = this.timeline, sc = this.scale;
    const p = tl.pos(item);
    if (!p) return null;
    const off = topOffset(item);
    const top = sc.y(p.s + off);
    if (tl.isPoint(item)) return { s: top, e: top + LAYOUT.pointCardHeight };
    const raw = item.place?.hd != null ? sc.extent(p.s + off, item.place.hd) : sc.heightOf(item);
    return { s: top, e: top + Math.max(LAYOUT.minCardHeight, raw - LAYOUT.cardGap) };
  }

  /**
   * 트랙 머리 위쪽에 쓰는 기간 — 트랙도 이벤트라 기간이 있다. 보드 기간과 같으면(따로 정하지 않은 것 — 트랙을 만들 때 보드
   * 기간이 들어간다) 쓰지 않는다. 날짜 없는 보드에선 쓰지 않는다.
   */
  #trackDates(t) {
    if (!this.timeline.dated || !t.s) return '';
    const e = t.e ?? t.s;
    const m = this.store.meta;
    if (t.s === m.start && e === m.end) return '';
    return t.s === e ? shortMD(t.s) : `${shortMD(t.s)} – ${shortMD(e)}`;
  }

  /** 트랙 칸 채우기(스타일 탭) — 칸은 골격이 바뀔 때만 새로 만들므로 그릴 때마다 표시를 맞춘다 */
  #syncColumnFill() {
    for (const t of this.store.tracks) {
      const col = this.columns.get(t.id);
      if (!col) continue;
      if (t.fill) col.dataset.fill = t.fill; else delete col.dataset.fill;
    }
  }

  #renderHead() {
    this.#syncColumnFill();
    const template = gridTemplate(this.store.tracks, this._layout.trackLanes);
    this.grid.style.gridTemplateColumns = template;
    renderHead(this.head, {
      tracks: this.store.tracks,
      items: this.store.items,
      selectedTrack: this.view.selectedTrack,
      template,
      onSelect: (id) => { if (!this._suppressHeadClick) this.handlers.openTrack(id); },
      dateLabel: (t) => this.#trackDates(t),
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

    for (const node of this.grid.querySelectorAll('.col,.pad,.now,.arrows,.memos')) node.remove();
    this.columns.clear();

    for (const track of this.store.tracks) {
      const col = el('div.col', { dataset: { t: track.id } });
      this.columns.set(track.id, col);
      this.grid.append(col);
    }
    this.grid.append(el('div.pad'));
    this.grid.append(this.arrowLayer);
    this.grid.append(this.memos.layer);

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
      if (this._hidden?.has(item.id)) continue;                  // 이 보드에서 숨긴 하위 카드(관계는 그대로)
      if (this._scope && !this._scope.has(item.id)) continue;   // 펼침 범위 밖은 숨긴다

      // 펼쳐 들어간 이벤트(focus)의 직속 자식은 최상위처럼 트랙 컬럼에 놓는다.
      const pid = (item.parent && item.parent !== focus) ? item.parent : null;
      const parent = pid ? byId.get(pid) : null;

      const common = {
        ...ctx,
        fontScale: this.store.meta.display?.fontScale ?? 1,
        match: this.view.matches(item),
        parent,
        hasChildren: (childrenOf.get(item.id) ?? []).some((k) => !this._hidden?.has(k.id)),
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
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.relations, this.store.meta.display, this.store.meta.arrows ?? {}, this.#arrowForms());
    this.#linkHighlight(this._hoverId ?? null);
    this.#markSelectedRel();
    this.#drawArrowHandles();
    // 메모(포스트잇) — 컬럼 폭이 정해진 뒤에 자리를 잰다
    this.memos.draw();
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
    drawArrows(this.arrowLayer, this.grid, this.store.items, this.store.relations, this.store.meta.display, this.store.meta.arrows ?? {}, this.#arrowForms());
    this.#linkHighlight(this._hoverId ?? null);
    this.#markSelectedRel();
    this.#drawArrowHandles();
  }

  /**
   * 화살표 고르기 — 누르면 그 관계가 골라지고(강조) Delete로 지운다(Delete는 고른 화살표가 먼저 — src/main.js). 열린 편집 창은
   * 그대로 둔다 — 닫으면 보드 폭이 바뀌어 화살표 자리가 옮겨지고, 이어 누른 두 번째 클릭(더블클릭 = 모양 고치기)이 빗나간다.
   * 다시 그리지 않고 표시만 바꾼다. null이면 고른 것 없음.
   */
  selectRel(id) {
    this.view.selectedRel = id ?? null;
    this.#markSelectedRel();
  }

  #markSelectedRel() {
    const id = this.view.selectedRel;
    let found = false;
    for (const p of this.arrowLayer.querySelectorAll('.arrow, .ref-line')) {
      const on = !!id && p.dataset.rel === id;
      p.classList.toggle('selected', on);
      if (on) found = true;
    }
    if (id && !found) this.view.selectedRel = null;      // 지워졌거나 안 보인다
  }

  /** 관계 지우기(화살표·참조 선 Delete · 우클릭) — 선행이면 이 보드의 고친 화살표 모양도 함께. 되돌리기 1단계 */
  deleteRel(id) {
    if (!id || this.store.readonly) return false;
    const rel = this.store.relations.find((r) => r.id === id);
    if (!rel) return false;
    const kind = rel.type === 'ref' ? '참조' : '선행관계';
    this.store.commit(`${kind} 삭제`, (doc) => {
      doc.relations = (doc.relations ?? []).filter((r) => r.id !== id);
      if (doc.meta.arrows?.[id]) { const next = { ...doc.meta.arrows }; delete next[id]; doc.meta.arrows = next; }
    });
    if (this._arrowEdit === id) this.endArrowEdit();
    this.view.selectedRel = null;
    const name = (x) => this.store.item(x)?.ti || '(제목 없음)';
    toast(rel.type === 'ref'
      ? `참조를 지웠습니다 — ${name(rel.from)} — ${name(rel.to)} (Ctrl+Z로 되돌립니다)`
      : `선행관계를 지웠습니다 — ${name(rel.from)} → ${name(rel.to)} (Ctrl+Z로 되돌립니다)`);
    return true;
  }

  /**
   * 이어진 카드 강조 — 카드에 커서를 올리면 그 카드의 **계보**를 따라간다(2026-09-30 사용자 결정): 선행 화살표를 거슬러
   * 앞선 일을 끝까지(선행의 선행…), 따라서 뒤따르는 일을 끝까지(후행의 후행…). 옆으로 새지 않는다 — 앞선 일의 다른 후행
   * (사촌)이나 뒤따르는 일의 다른 선행은 넣지 않는다. 지나간 화살표를 채워 칠하고(.hl) 계보의 카드 테두리를 밝힌다(.linked).
   * 화살표가 없는 카드는 아무것도 하지 않는다. 화면 표시일 뿐(문서·되돌리기와 무관). 이 보드에 그려진 화살표만 따른다.
   * 다시 그려도(renderCards·redrawArrows) 커서가 올라가 있던 카드 기준으로 다시 건다.
   */
  #linkHighlight(id) {
    this._hoverId = id;
    for (const n of this.arrowLayer.querySelectorAll('.arrow.hl')) n.classList.remove('hl');
    for (const n of this.grid.querySelectorAll('.ev.linked')) n.classList.remove('linked');
    if (!id) return;
    const paths = [...this.arrowLayer.querySelectorAll('.arrow')];
    const into = new Map(), out = new Map();                  // 카드 → 들어오는/나가는 화살표
    for (const p of paths) {
      if (!into.has(p.dataset.to)) into.set(p.dataset.to, []);
      into.get(p.dataset.to).push(p);
      if (!out.has(p.dataset.from)) out.set(p.dataset.from, []);
      out.get(p.dataset.from).push(p);
    }
    const ids = new Set([id]);
    const lit = new Set();
    // 한 방향으로만 끝까지 — 위로는 들어오는 화살표만, 아래로는 나가는 화살표만 따른다(사촌으로 새지 않는다)
    const walk = (start, edges, next) => {
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop();
        for (const p of edges.get(cur) ?? []) {
          lit.add(p);
          const k = next(p);
          ids.add(k);
          if (!seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
    };
    walk(id, into, (p) => p.dataset.from);                     // 앞선 일들
    walk(id, out, (p) => p.dataset.to);                        // 뒤따르는 일들
    if (!lit.size) return;
    for (const p of lit) { p.classList.add('hl'); p.parentNode.append(p); }   // 다른 화살표 위로
    for (const n of this.grid.querySelectorAll('.ev')) if (ids.has(n.dataset.id)) n.classList.add('linked');
  }

  // ── 화살표 모양 고치기 (꺾은선 연결선) ─────────────────────
  // 화살표를 더블클릭하면 편집 — 양 끝 손잡이를 끌면 그 끝이 **연결된 카드의 테두리**를 따라 움직이고(가장 가까운 테두리 점),
  // 가운데 마름모 손잡이는 파워포인트 꺾은선 화살표처럼 가운데 구간의 위치를 옮긴다. 값은 카드에 대한 비율이라 카드가
  // 움직여도 모양이 따라간다. 보드 표시 값(doc.meta.arrows, 되돌리기 가능). Esc·빈 곳 클릭으로 끝, 우클릭 '자동 경로로'.
  // 끌기 리스너는 window에(규약 14 — 손잡이는 다시 그릴 때마다 새로 만든다). 마우스 좌표 ÷ 보드 배율(규약 24).

  /**
   * 화살표 상대 모양 보관 — 문서가 바뀌거나(store.rev) 보이는 범위가 바뀌면(펼침·필터) 비우고 새로 고른다. 확대·축소·행 높이·
   * 창 크기·패널 열기처럼 **크기만** 바뀐 그리기에서는 그대로 이어 써서 꺾임이 튀지 않게 한다.
   */
  #arrowForms() {
    const v = this.view;
    const key = [this.store.rev, this.focus ?? '', [...v.statusFilter].sort().join(','), [...v.orgFilter].sort().join(',')].join('|');
    if (this._formsKey !== key) { this._formsKey = key; this._forms = new Map(); }
    return this._forms;
  }

  /** 이 관계의 지금 모양 — 고친 값이 있으면 그려진 그대로(꼴 포함), 없으면 자동 경로를 고칠 수 있는 꼴로 옮긴 값 */
  #arrowShape(relId) {
    const g = this.arrowLayer._geom?.get(relId);
    if (!g) return null;
    return g.form ? structuredClone(g.form) : overrideFromRoute(g.points, g.box.from, g.box.to);
  }

  editArrow(relId) {
    if (this.store.readonly || !this.arrowLayer._geom?.has(relId)) return;
    this._arrowEdit = relId;
    this.#drawArrowHandles();
    if (this._arrowEditOff) return;
    // 끝내기 — Esc, 손잡이·그 화살표 밖을 누르면
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.endArrowEdit(); } };
    const onDown = (e) => {
      if (e.target.closest?.('.arrow-handles .ah')) return;
      if (e.target.closest?.('.arrow, .ref-line')?.dataset.rel === this._arrowEdit) return;
      this.endArrowEdit();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    this._arrowEditOff = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }

  endArrowEdit() {
    this._arrowEdit = null;
    this._arrowEditOff?.();
    this._arrowEditOff = null;
    this.#drawArrowHandles();
  }

  /** 편집 중인 화살표의 손잡이 — 양 끝(동그라미)과, 가운데 구간을 옮길 수 있으면 마름모 */
  #drawArrowHandles() {
    this.grid.querySelector(':scope > .arrow-handles')?.remove();
    for (const p of this.arrowLayer.querySelectorAll('.arrow.editing, .ref-line.editing')) p.classList.remove('editing');
    const id = this._arrowEdit;
    if (!id) return;
    const g = this.arrowLayer._geom?.get(id);
    if (!g) { this._arrowEdit = null; this._arrowEditOff?.(); this._arrowEditOff = null; return; }   // 관계·카드가 사라졌다
    // 손잡이는 그려진 경로 그대로에서(꼴·가운데 위치). 아직 고치지 않은 자동 경로는 고칠 수 있는 꼴로 옮겨서
    let A = g.A, B = g.B, r = g.route;
    if (!g.form) {
      const shape = this.#arrowShape(id);
      A = anchorPoint(g.box.from, shape.a); B = anchorPoint(g.box.to, shape.b);
      r = elbowRoute(A, B, shape.m, [g.box.from, g.box.to], shape.f);
    }
    this.arrowLayer.querySelector(`.arrow[data-rel="${CSS.escape(id)}"], .ref-line[data-rel="${CSS.escape(id)}"]`)?.classList.add('editing');
    const layer = el('div.arrow-handles', { attrs: { 'aria-hidden': 'true' } });
    const handle = (cls, p, part, title) => {
      const h = el(`div.ah.${cls}`, { title, style: { left: `${p.x}px`, top: `${p.y}px` }, dataset: { part } });
      h.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.#dragArrowHandle(id, part, e); });
      layer.append(h);
    };
    // 양 끝 손잡이는 실제로 그려진 끝에(곧은 선으로 맞춰지면 테두리 위에서 조금 옮겨진다)
    handle('ah-end', r.points[0] ?? A, 'a', '시작 — 끌면 선행 카드 테두리를 따라 움직입니다');
    handle('ah-end', r.points[r.points.length - 1] ?? B, 'b', '끝 — 끌면 후행 카드 테두리를 따라 움직입니다');
    if (r.axis) handle(`ah-mid.ah-${r.axis}`, r.mid, 'm', '가운데 구간 — 끌어서 꺾이는 위치를 옮깁니다');
    this.grid.append(layer);
  }

  #dragArrowHandle(id, part, ev) {
    if (this.store.readonly) return;
    const g0 = this.arrowLayer._geom?.get(id);
    if (!g0) return;
    let began = false;
    const toBoard = (e) => {
      const gr = this.grid.getBoundingClientRect();
      return { x: (e.clientX - gr.left) / this.zoom, y: (e.clientY - gr.top) / this.zoom };
    };
    const move = (e) => {
      const g = this.arrowLayer._geom?.get(id) ?? g0;
      const p = toBoard(e);
      const next = this.#arrowShape(id);
      if (!next) return;
      const boxes = [g.box.from, g.box.to];
      if (part === 'a' || part === 'b') {
        // 끝을 옮기면 꼴도 새로 고른다(옮긴 자리에 맞는 첫 꼴) — 그 꼴을 기억해 확대·축소에도 지킨다
        if (part === 'a') next.a = anchorFromPoint(g.box.from, p); else next.b = anchorFromPoint(g.box.to, p);
        next.f = elbowRoute(anchorPoint(g.box.from, next.a), anchorPoint(g.box.to, next.b), next.m, boxes).form;
      } else {
        // 가운데는 지금 꼴 그대로 위치만
        const r = elbowRoute(anchorPoint(g.box.from, next.a), anchorPoint(g.box.to, next.b), next.m, boxes, next.f);
        const adj = r.adj;
        if (!adj || Math.abs(adj.to - adj.from) < 0.5) return;
        next.m = Math.round((((adj.axis === 'x' ? p.x : p.y) - adj.from) / (adj.to - adj.from)) * 1000) / 1000;
        // 연결선으로 맞지 않는 모양(카드를 가로지르거나 머리가 바깥을 향함)이 되는 자리로는 옮기지 않는다
        if (!elbowRoute(anchorPoint(g.box.from, next.a), anchorPoint(g.box.to, next.b), next.m, boxes, next.f).valid) return;
      }
      if (!began) { this.store.begin('화살표 모양'); began = true; }
      this.store.commit('화살표 모양', (doc) => { doc.meta.arrows = { ...(doc.meta.arrows ?? {}), [id]: next }; });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging-arrow');
      if (began) this.store.end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.body.classList.add('dragging-arrow');
  }

  /** 자동 경로로 되돌리기 — 고친 모양을 지운다 */
  resetArrow(relId) {
    if (!this.store.meta.arrows?.[relId]) return;
    this.store.commit('화살표 자동 경로', (doc) => {
      const next = { ...(doc.meta.arrows ?? {}) };
      delete next[relId];
      doc.meta.arrows = next;
    });
  }

  // ── 입력 ────────────────────────────────────────────────

  #attachEvents() {
    // 이어진 카드 강조 — 가장 안쪽 카드 기준(하위 카드에 올리면 그 하위 카드)
    this.grid.addEventListener('pointerover', (ev) => {
      const id = ev.target.closest?.('.ev')?.dataset.id ?? null;
      if (id !== (this._hoverId ?? null)) this.#linkHighlight(id);
    });
    this.grid.addEventListener('pointerleave', () => this.#linkHighlight(null));

    this.grid.addEventListener('click', (ev) => {
      // 텍스트 선택 모드에서는 패널을 열지 않는다.
      // 열면 재렌더가 일어나 카드가 새로 그려지고 긁어 둔 선택이 날아간다.
      if (this.view.textSelect) return;
      if (this.view.selectedMemo) this.memos.select(null);     // 메모 밖을 누르면 메모 고르기를 푼다(메모 클릭은 메모 층이 막는다)
      // 화살표·참조 선을 누르면 그 관계를 고른다(Delete로 지운다)
      const arrow = ev.target.closest?.('.arrow, .ref-line');
      if (arrow?.dataset.rel) {
        const id = arrow.dataset.rel;
        // 같은 화살표를 곧 다시 누르면 더블클릭 — 모양 고치기. 첫 클릭(고르기)이 다시 그리기를 부르면 화살표 요소가 바뀌어
        // 브라우저가 dblclick을 안 보내는 때가 있어 직접 센다(우클릭 '화살표 모양 고치기'는 그대로)
        const now = performance.now();
        const again = this._lastArrowClick?.id === id && now - this._lastArrowClick.t < 450;
        this._lastArrowClick = { id, t: now };
        if (again) { this.editArrow(id); return; }
        this.selectRel(id);
        return;
      }
      if (this.view.selectedRel) this.selectRel(null);
      const card = ev.target.closest('.ev');
      // Alt+클릭 — 지금 고른 카드(선행) → 누른 카드(후행) 선행관계를 잇는다(이미 있으면 푼다). 고른 카드가 없으면 그냥 고른다.
      if (card && ev.altKey && this.view.selectedItem && this.view.selectedItem !== card.dataset.id) {
        ev.preventDefault();
        window.roadmapDB?.altUsed?.();
        this.toggleDep(this.view.selectedItem, card.dataset.id);
        return;
      }
      if (card) this.handlers.openItem(card.dataset.id);
    });

    // 자식 카드의 가로 폭 손잡이를 더블클릭하면 자동 배치로 되돌린다
    this.grid.addEventListener('dblclick', (ev) => {
      const arrow = ev.target.closest?.('.arrow, .ref-line');
      if (arrow?.dataset.rel) { ev.stopPropagation(); this.editArrow(arrow.dataset.rel); return; }
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
      if (this.hasShownChildren(id)) { ev.stopPropagation(); this.view.setFocus(id); }
    });

    this.#attachCreate();

    // 우클릭 — 카드에서 '이벤트 복사', 빈 칸에서 '붙여넣기'. 보드를 넘나든다(클립보드는 인스턴스에).
    this.grid.addEventListener('contextmenu', (ev) => {
      if (this.store.readonly) return;
      const arrow = ev.target.closest?.('.arrow');
      if (arrow?.dataset.rel) {
        ev.preventDefault();
        const id = arrow.dataset.rel;
        openCtxMenu(ev.clientX, ev.clientY, [
          { label: '화살표 모양 고치기', action: () => this.editArrow(id) },
          { label: '자동 경로로 되돌리기', disabled: !this.store.meta.arrows?.[id], action: () => { this.resetArrow(id); this.endArrowEdit(); } },
          { label: '선행관계 삭제', action: () => this.deleteRel(id) },
        ]);
        return;
      }
      const refHit = ev.target.closest?.('.ref-line');
      if (refHit?.dataset.rel) {
        ev.preventDefault();
        const id = refHit.dataset.rel;
        this.selectRel(id);
        openCtxMenu(ev.clientX, ev.clientY, [
          { label: '선 모양 고치기', action: () => this.editArrow(id) },
          { label: '자동 경로로 되돌리기', disabled: !this.store.meta.arrows?.[id], action: () => { this.resetArrow(id); this.endArrowEdit(); } },
          { label: '참조 삭제', action: () => this.deleteRel(id) },
        ]);
        return;
      }
      const card = ev.target.closest('.ev');
      const col = ev.target.closest('.col');
      const pad = ev.target.closest('.pad');
      if (!card && !col && !pad) return;
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
      // 빈 곳 — 메모(포스트잇) 붙이기. 메모는 이벤트가 아니다(보드 표시)
      if (!card) {
        const { clientX, clientY } = ev;
        opts.push({ label: '메모 붙이기', action: () => this.memos.create(clientX, clientY) });
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
        this.#forceSizeIfDateless(item);
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
  /**
   * 날짜 없는 보드(처음부터 눈금 없이 만든 보드)의 새 카드는 '사이즈 수동 설정'(크기 강제)을 켠 채로 만든다 — 칸은 순서일 뿐이라
   * 기간대로 늘어나는 자동 크기보다 손으로 맞추는 쪽이 맞다(2026-10-06 사용자). 높이는 칸 길이, 폭은 그 트랙 한 칸.
   * 날짜 있는 보드는 그대로 자동 크기. 패널의 '크기 강제' 켜기와 같은 값이다.
   */
  #forceSizeIfDateless(item) {
    if (this.timeline.dated) return;
    item.place.hd = Math.max(1, item.place.slot?.len ?? 1);
    item.place.x = 0;
    item.place.w = Math.max(1, item.place.sp ?? 1);
  }

  createItem(trackId, startPos, endPos = null) {
    const tl = this.timeline;
    const start = Math.max(0, startPos);
    const end = Math.max(start, endPos == null ? tl.newEnd(start) : endPos);

    const item = {
      id: newId('e'),
      s: null, e: null,
      ti: '새 이벤트', ty: DEFAULT_TYPE, st: DEFAULT_STATUS,
      og: this.store.orgs[0], pg: 0, dp: [], note: '',
      place: { t: trackId, sp: 1, align: 'middle', showNote: false, hd: null, x: null, w: null, slot: null },
    };
    tl.set(item, start, end);
    this.#forceSizeIfDateless(item);
    this.store.commit('일정 추가', (doc) => { doc.items.push(item); });
    this.handlers.openItem(item.id);
    return item;
  }

  /**
   * 선행관계 잇기·풀기 — from(선행) → to(후행). Alt+클릭 단축(지금 고른 카드가 선행). 이미 있으면 푼다. 선행이 돌고 돌게 되면
   * (to에서 선행을 따라 from에 닿으면) 잇지 않는다. 되돌리기 1단계. 고른 카드(선행)는 그대로 고른 채 — 이어서 여러 후행을 잇는다.
   */
  toggleDep(from, to) {
    if (this.store.readonly || !from || !to || from === to) return false;
    if (!this.store.item(from) || !this.store.item(to)) return false;
    const deps = this.store.relations.filter((r) => r.type === 'dep');
    const name = (x) => this.store.item(x)?.ti || '(제목 없음)';
    const had = deps.find((r) => r.from === from && r.to === to);
    if (had) {
      this.store.commit('선행관계 풀기', (doc) => {
        doc.relations = (doc.relations ?? []).filter((r) => r.id !== had.id);
        if (doc.meta.arrows?.[had.id]) { const a = { ...doc.meta.arrows }; delete a[had.id]; doc.meta.arrows = a; }
      });
      toast(`선행관계를 풀었습니다 — ${name(from)} → ${name(to)}`);
    } else {
      // to에서 선행을 따라가 from에 닿으면 순환
      const next = new Map();
      for (const r of deps) { if (!next.has(r.from)) next.set(r.from, []); next.get(r.from).push(r.to); }
      const seen = new Set([to]);
      const stack = [to];
      while (stack.length) {
        const n = stack.pop();
        if (n === from) { toast('선행이 돌고 돌게 되어(순환) 잇지 않았습니다', 'warn'); return false; }
        for (const m of next.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      this.store.commit('선행관계 잇기', (doc) => {
        doc.relations = [...(doc.relations ?? []), { id: newId('r'), type: 'dep', from, to }];
      });
      toast(`선행관계를 이었습니다 — ${name(from)} → ${name(to)} (Alt+클릭으로 풉니다)`);
    }
    this.handlers.openItem(from);      // 편집 창(선행 카드)의 선행·후행 목록도 새로
    return true;
  }

  /** 카드가 보이게 스크롤한다(참조 목록에서 그 카드로 갈 때) */
  revealItem(id) {
    const node = this.grid.querySelector(`.ev[data-id="${CSS.escape(id)}"]`);
    node?.scrollIntoView({ block: 'center', inline: 'center' });
  }

  /** 오늘 위치로 스크롤 */
  scrollToToday(scroller) {
    if (!this.dated) { scroller.scrollTop = 0; return; }
    // 스크롤은 화면 px — 보드 px에 배율을 곱한다
    const i = Math.round((new Date().setHours(0, 0, 0, 0) - this.origin) / 86400000);
    scroller.scrollTop = Math.max(0, (this.scale?.y(i) ?? 0) * this.zoom - 80);
  }
}
