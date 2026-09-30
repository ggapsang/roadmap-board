/**
 * 일정 편집 패널 — PPT 서식창처럼 탭으로 나눈다.
 *   속성   제목·상태·소속 트랙·유형·기간·담당·비고
 *   매핑   항등·조합·모자관계·선행관계 설정 — 모두 '편집' 버튼 → 팝업 트리. 단 화면 말 ≠ 시스템 말:
 *          동일 = 두 이벤트를 하나로 '합치는 작업'(관계 아님, §7.2). 조합 = 구성(§7.1) — 여러 이벤트로
 *          이 이벤트가 이루어진 것(순서 없는 포함, 태스크와 다름). 관계 타입은 선행·포함뿐.
 *          (docs/SYSTEM.md, docs/SAVE.md §5)
 *   스타일 채우기(카드 면 색)·글자 정렬·비고 표시(기본 숨김)·크기 강제 — 이 보드에서의 표현(place)
 *   상세   태스크 + 세부내역(조합한 이벤트와 그 안쪽 카드, 조합이 없으면 하위 카드 트리)
 */
import { shortMD, dayIndex, parseDate, inclusiveDays } from '../../core/dates.js';
import { newId, ALIGNS } from '../../core/schema.js';
import { STATUSES, ITEM_TYPES, FILLS, statusList } from '../../config/index.js';
import { $, el, clear, icon, ICONS } from '../dom.js';
import { askConfirm, askChoice, askTree, askTreeTabs } from '../dialog.js';
import { openCombinePicker, pickEventForMerge, composedOf } from '../combine.js';
import { toast } from '../toast.js';
import { attachTabReorder } from '../reorder.js';
import { createNoteEditor } from '../noteEditor.js';

/** 편집 패널 탭 순서 — 사용자가 끌어 바꾼 순서를 이 PC에 영구 보관한다(문서가 아니라 사용자 설정). */
const TAB_ORDER_KEY = 'wolfpack:item-tab-order';

/** 값이 바로 문서로 반영되는 단순 입력들 (트랙·관계·별칭·진척은 매핑 탭 UI가 맡는다) */
const F = {
  title: 'i-title', type: 'i-type', start: 'i-start',
  end: 'i-end', org: 'i-org', note: 'i-note', slot: 'i-slot', slotLen: 'i-slotlen',
};

const ALIGN_ICON = { top: ICONS.alignTop, middle: ICONS.alignMiddle, bottom: ICONS.alignBottom };
const ALIGN_LABEL = { top: '위', middle: '가운데', bottom: '아래' };

/** 여러 줄 제목 입력이 내용에 맞게 높이를 늘리도록 */
function autogrow(node) {
  node.style.height = 'auto';
  node.style.height = node.scrollHeight + 'px';
}

export class ItemPanel {
  constructor({ store, view, panels, adapter, openProject, reloadBoard, onChange }) {
    Object.assign(this, { store, view, panels, adapter, openProject, reloadBoard, onChange });
    this._allEvents = [];          // 모든 보드의 이벤트 캐시 — 카드를 열 때마다 갱신하되 비우진 않는다
    this._extraEvents = new Map(); // 어느 보드 화면에도 없는 조합 대상의 본질(이름 표시용)
    this.#buildStatic();
    this.#buildLists();
    this.#bind();
    this.#primeEvents();           // 미리 한 번 받아 둔다 — 첫 카드에서도 조합·동일 후보가 바로 뜨게
  }

  /** 다른 보드 이벤트 목록을 미리 채워 둔다(첫 열림 지연 방지). 실패해도 조용히 넘어간다. */
  async #primeEvents() {
    try { const ev = await this.adapter?.listEvents?.(); if (Array.isArray(ev)) this._allEvents = ev; } catch { /* 다음 열림에서 다시 시도 */ }
  }

  get item() { return this.view.selectedItem ? this.store.item(this.view.selectedItem) : null; }

  #buildStatic() {
    const type = $(F.type);
    clear(type);
    for (const t of ITEM_TYPES) type.append(el('option', { value: t.key, text: t.label }));

    this.#renderStatusButtons();

    // 글자 세로 정렬 — 아이콘 세그먼트
    const align = $('i-align');
    clear(align);
    for (const key of ALIGNS) {
      align.append(el('button', {
        type: 'button', className: 'seg-btn', dataset: { align: key },
        title: `글자 ${ALIGN_LABEL[key]} 정렬`, attrs: { 'aria-label': `글자 ${ALIGN_LABEL[key]} 정렬` },
      }, [icon(ALIGN_ICON[key])]));
    }
    align.querySelectorAll('.seg-btn').forEach((b) =>
      b.addEventListener('click', () => this.#setAlign(b.dataset.align)));

    // 채우기 팔레트 — '없음' + FILLS. 색은 토큰(--fill-*)이 테마별로 정한다.
    const pal = $('i-fill');
    clear(pal);
    pal.append(el('button.fill-sw.none', {
      type: 'button', title: '채우기 없음', dataset: { fill: '' },
      attrs: { role: 'radio', 'aria-label': '채우기 없음', 'aria-checked': 'false' },
    }, [icon(ICONS.close)]));
    for (const f of FILLS) {
      pal.append(el('button.fill-sw', {
        type: 'button', title: f.label, dataset: { fill: f.key },
        attrs: { role: 'radio', 'aria-label': `채우기 ${f.label}`, 'aria-checked': 'false' },
      }));
    }
    pal.querySelectorAll('.fill-sw').forEach((b) =>
      b.addEventListener('click', () => this.#setFill(b.dataset.fill || null)));

    // 비고 표시 — 숨김(기본) / 카드에 표시
    const nb = $('i-shownote');
    clear(nb);
    for (const [val, text] of [['off', '숨김'], ['on', '카드에 표시']]) {
      nb.append(el('button.seg-btn', {
        type: 'button', text, dataset: { note: val },
        attrs: { role: 'radio', 'aria-pressed': 'false' },
        on: { click: () => this.#setShowNote(val === 'on') },
      }));
    }
    $('i-fixedh').append(icon(ICONS.resize));
    this.#bindNote();
    // 탭 — 저장된 순서가 있으면 그 순서로, 끌어서 바꾸면 그 순서를 영구 보관한다.
    const bar = $('pItem').querySelector('.ptabs');
    this.#applyTabOrder(bar);
    for (const tab of bar.querySelectorAll('.ptab')) {
      tab.addEventListener('click', () => this.#showTab(tab.dataset.tab));
    }
    attachTabReorder(bar, {
      item: '.ptab',
      onReorder: (from, to) => {
        const tabs = [...bar.querySelectorAll('.ptab')];
        const [moved] = tabs.splice(from, 1);
        tabs.splice(to, 0, moved);
        bar.append(...tabs);
        try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabs.map((t) => t.dataset.tab))); } catch { /* 저장 못 해도 이번 실행엔 적용 */ }
      },
    });
  }

  /** 관계 3종을 같은 검색 리스트로. 선택은 문서가 진실이라 isSelected를 매번 물어본다. */
  #buildLists() {
    // 동일·조합·상위·선행 모두 팝업 트리 버튼으로 다룬다(각 #render*가 버튼+요약을 그린다).
  }

  /**
   * 이 보드를 트랙 → 카드 트리 노드로. 선행·모자관계 후보 고르기에 쓴다(같은 보드 안).
   * tracks를 주면 그 트랙들만 — 모자관계는 트랙 안에서만 정한다(표현 계층의 기능 단위).
   */
  #boardTreeNodes({ exclude = new Set(), noMs = false, tracks = null, self = null } = {}) {
    const childrenOf = (pid) => this.store.items.filter((x) => x.parent === pid);
    const build = (it) => ({
      id: it.id, label: it.ti || '(제목 없음)',
      sub: it.id === self ? '이 카드' : it.ty === 'ms' ? '마일스톤' : '',
      checkable: !exclude.has(it.id) && !(noMs && it.ty === 'ms'),
      children: childrenOf(it.id).map(build),
    });
    const list = tracks ? this.store.tracks.filter((tr) => tracks.has(tr.id)) : this.store.tracks;
    return list.map((tr) => ({
      id: tr.id, label: tr.name || '(트랙)', sub: '트랙', checkable: false,
      children: this.store.items.filter((x) => !x.parent && x.place?.t === tr.id).map(build),
    }));
  }

  #bind() {
    for (const id of Object.values(F)) {
      $(id).addEventListener('change', () => this.apply());
    }
    // 제목은 입력 즉시 이 카드에만 반영한다 (기획안 §5). 이벤트마다 자기 이름을 지키므로
    // 절대 다른 이벤트로 전파·동기화하지 않는다. 제목으로 검색하면 기존 이벤트를 "같은
    // 이벤트로 연결" 후보로 드롭다운에 띄운다(동일 관계 추가).
    $(F.title).addEventListener('input', () => {
      const item = this.item;
      if (!item) return;
      this.store.commit('제목 수정', () => { item.ti = $(F.title).value; });
      autogrow($(F.title));
      this.#renderTitleDrop();
    });
    // 연결 후보 드롭다운 키보드 조작: ↓/↑로 훑고 Enter로 연결. 드롭다운이 없으면
    // 그냥 Enter는 편집 종료(줄바꿈은 Shift+Enter).
    $(F.title).addEventListener('keydown', (e) => {
      const open = !$('i-title-drop').hidden;
      if (e.key === 'ArrowDown') { if (this.#dropNav(1)) e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { if (this.#dropNav(-1)) e.preventDefault(); return; }
      if (e.key === 'Escape' && open) { e.preventDefault(); $('i-title-drop').hidden = true; return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const m = open && this._dropIdx >= 0 ? this._dropMatches?.[this._dropIdx] : null;
        if (m) this.#confirmLink(m.id); else $(F.title).blur();
      }
    });
    // 평상시엔 드롭다운을 숨긴다 — 검색(입력) 중에만 뜬다.
    $(F.title).addEventListener('blur', () => setTimeout(() => { $('i-title-drop').hidden = true; }, 120));

    // 크기 강제 — 켜면 현재 기간 길이(일)로 시작, 가로·세로를 드래그로. 끄면 자동 크기로.
    $('i-fixedh').addEventListener('click', () => {
      const item = this.item;
      if (!item) return;
      const next = $('i-fixedh').getAttribute('aria-pressed') !== 'true';
      this.store.commit('크기 강제', () => {
        if (next) {
          // 날짜 없는 보드는 칸 길이로(위치 단위가 칸이다)
          item.place.hd = item.place.slot ? Math.max(1, item.place.slot.len)
            : Math.max(1, inclusiveDays(item.s, item.e));
          // 걸치던 칸 수(sp)만큼 폭을 잡아 둔다 — 강제해도 한 칸으로 안 무너진다.
          // w는 컬럼 기준 비율이라 1보다 크면 옆 트랙까지 넘나든다.
          item.place.x = 0;
          item.place.w = Math.max(1, item.place.sp ?? 1);
        } else {
          item.place.hd = null; item.place.x = null; item.place.w = null;
        }
      });
      $('i-fixedh').setAttribute('aria-pressed', String(next));
    });

    $('i-taskadd').addEventListener('click', () => this.#addTask());
    $('i-del').addEventListener('click', () => this.remove());
    $('i-dup').addEventListener('click', () => this.duplicate());
  }

  // ── 비고 (마크다운, 라이브 미리보기) ─────────────────────

  /**
   * 비고는 마크다운 원문 그대로 item.note에 둔다. 편집기(ui/noteEditor.js)는 옵시디언식 — 커서가 있는 줄만 원문, 나머지는 서식.
   * 숨긴 textarea(#i-note)가 원문을 들고 있어 apply()가 다른 칸과 같은 길로 저장한다. 저장은 편집기에서 나갈 때(blur).
   */
  #bindNote() {
    const ta = $(F.note);
    this.noteEditor = createNoteEditor($('i-note-editor'), {
      onChange: (text) => { ta.value = text; },
      onBlur: () => { if (this.item && ta.value !== (this.item.note ?? '')) this.apply(); },
    });
  }

  /** 저장된 탭 순서를 적용한다. 모르는 탭은 버리고, 저장 뒤 새로 생긴 탭은 제자리(뒤)에 둔다. */
  #applyTabOrder(bar) {
    let order = null;
    try { order = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? 'null'); } catch { order = null; }
    if (!Array.isArray(order)) return;
    const tabs = [...bar.querySelectorAll('.ptab')];
    const rank = (t) => { const i = order.indexOf(t.dataset.tab); return i < 0 ? order.length + tabs.indexOf(t) : i; };
    bar.append(...tabs.sort((a, b) => rank(a) - rank(b)));
  }

  #showTab(name) {
    this._tab = name;                  // 다른 카드를 열어도 이 탭을 그대로 보여 준다
    for (const b of $('pItem').querySelectorAll('.ptab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === name));
    }
    for (const s of $('pItem').querySelectorAll('.ptab-panel')) {
      s.hidden = s.dataset.panel !== name;
    }
    // 매핑·상세 탭을 열 때마다 다른 보드 이벤트를 다시 읽어 최신 이름을 보여 준다(실시간 반영).
    if ((name === 'rel' || name === 'task') && this.item) this.#loadCrossBoard(this.item);
  }

  open(id) {
    this.view.selectedItem = id;
    this.view.selectedTrack = null;
    const item = this.item;
    if (!item) return;

    const org = $(F.org);
    clear(org);
    for (const o of this.store.orgs) org.append(el('option', { value: o, text: o }));

    $(F.title).value = item.ti;
    autogrow($(F.title));
    $(F.type).value = item.ty;
    // 날짜 없는 보드는 날짜 대신 칸 위치·길이를 고친다 — 위치는 사람이 읽는 1부터
    const dated = this.store.meta.display?.dated !== false;
    $('i-dates').hidden = !dated;
    $('i-slots').hidden = dated;
    $(F.start).value = item.s ?? '';
    $(F.end).value = item.e ?? '';
    $(F.slot).value = item.place?.slot ? String(item.place.slot.s + 1) : '1';
    $(F.slotLen).value = item.place?.slot ? String(item.place.slot.len) : '1';
    $(F.org).value = item.og;
    $(F.note).value = item.note ?? '';
    // 다른 카드를 열면 되돌리기 기록도 새로 — 이 카드 비고에서 Ctrl+Z로 다른 카드 비고가 나오지 않게.
    // 같은 카드를 쓰는 중(포커스)에 저장·새로 그리기로 다시 열리면 건드리지 않는다(커서·기록 유지).
    const ed = this.noteEditor;
    if (ed && !(ed.view.hasFocus && this._noteFor === item.id)) ed.setValue(item.note ?? '', { resetHistory: this._noteFor !== item.id });
    this._noteFor = item.id;
    $('i-title-drop').hidden = true;

    this.#renderStatusButtons();   // 보드별 상태 이름 반영
    this.#syncStatus(item);
    this.#syncAlign(item);
    this.#renderTrackMap(item);
    this.#syncStyle(item);
    $('i-fixedh').setAttribute('aria-pressed', String(item.place?.hd != null));

    // 다른 보드 이벤트 목록은 캐시를 그대로 두고 아래 #loadCrossBoard가 새로 받아 갱신한다.
    // null로 비우면 목록을 다시 받기 전까지 동일·조합 후보(다른 보드 트랙들)가 잠깐 사라진다 —
    // 이름을 바꾸고 매핑 탭을 다시 열 때 "트랙이 안 뜬다"로 보이는 원인이라 비우지 않는다.
    if (!Array.isArray(this._allEvents)) this._allEvents = [];
    this.#renderDeps(item);
    this.#renderParents(item);
    this.#renderSame(item);            // 동일 후보 (자기 자신 항상 체크)
    this.#renderCombine(item);         // 조합 후보
    this.#renderTasks(item);
    this.#renderChildren(item);        // 상세 — 자기·동일·조합 카드
    this.#loadCrossBoard(item);        // 모든 보드 이벤트 로드 → 후보·상세 갱신

    // 탭은 초기화하지 않는다 — 스타일 탭을 보다가 다른 카드를 누르면 그 카드도 스타일 탭으로 연다.
    this.#showTab(this._tab ?? 'attr');
    this.panels.open('pItem');
    this.onChange?.();
  }

  /** 상태 버튼을 이 보드의 상태 이름으로 다시 그린다(키·색은 고정, 이름만 보드별). */
  #renderStatusButtons() {
    const box = $('i-status');
    clear(box);
    for (const s of statusList(this.store.doc)) {
      box.append(el('button', {
        type: 'button', dataset: { st: s.key }, text: s.label,
        on: { click: () => this.#setStatus(s.key) },
      }));
    }
  }

  #setStatus(key) {
    const item = this.item;
    if (!item) return;
    this.store.commit('상태 변경', () => { item.st = key; });
    this.#syncStatus(item);
  }

  #setAlign(key) {
    const item = this.item;
    if (!item) return;
    this.store.commit('글자 정렬', () => { item.place.align = key; });
    this.#syncAlign(item);
  }

  /** 채우기 — 팔레트 key 또는 null(없음). 이 보드에서의 표현이라 place에 둔다. */
  #setFill(key) {
    const item = this.item;
    if (!item) return;
    this.store.commit('채우기', () => { item.place.fill = key; });
    this.#syncStyle(item);
  }

  /** 비고를 보드 카드에 보일지 (기본 숨김) */
  #setShowNote(on) {
    const item = this.item;
    if (!item) return;
    this.store.commit('비고 표시', () => { item.place.showNote = on; });
    this.#syncStyle(item);
    if (on && !(item.note ?? '').trim()) toast('비고가 비어 있습니다 — 속성 탭에서 비고를 쓰면 카드에 보입니다');
  }

  #syncStyle(item) {
    const fill = item.place?.fill ?? '';
    for (const b of $('i-fill').querySelectorAll('.fill-sw')) {
      b.setAttribute('aria-checked', String((b.dataset.fill || '') === fill));
    }
    const on = item.place?.showNote === true;
    for (const b of $('i-shownote').querySelectorAll('.seg-btn')) {
      b.setAttribute('aria-pressed', String((b.dataset.note === 'on') === on));
    }
  }

  #syncAlign(item) {
    for (const b of $('i-align').querySelectorAll('.seg-btn')) {
      b.setAttribute('aria-pressed', String(b.dataset.align === item.place?.align));
    }
  }

  #syncStatus(item) {
    for (const b of $('i-status').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.st === item.st));
    }
  }

  /**
   * 소속 트랙 — 이 카드가 든 트랙을 고른다(여럿 가능). 붙어 있는 트랙끼리는 걸쳐서 한
   * 덩어리로, 떨어진 트랙에는 같은 카드가 따로 표시된다. 고른 트랙만 소속이다 — 사이의
   * 트랙이 자동으로 끼어들지 않는다. 자식 카드는 트랙이 상위를 따르므로 매핑하지 않는다.
   */
  #renderTrackMap(item) {
    const box = $('i-span');
    clear(box);
    if (item.parent) { box.append(el('span.muted', { text: '상위 일정 안에서는 트랙이 상위를 따릅니다.' })); return; }
    const member = new Set(this.#memberTracks(item));
    for (const t of this.store.tracks) {
      box.append(el('button.seg-btn', {
        type: 'button', text: t.name, title: `${t.name} 소속`,
        attrs: { 'aria-pressed': String(member.has(t.id)) },
        on: { click: () => this.#toggleTrack(item, t.id) },
      }));
    }
  }

  /** 이 카드가 실제로 소속된 트랙 id들 (존재하는 것만). */
  #memberTracks(item) {
    const list = Array.isArray(item.place.tracks) && item.place.tracks.length
      ? item.place.tracks : [item.place.t];
    return list.filter((id) => this.store.trackIndex(id) >= 0);
  }

  #toggleTrack(item, trackId) {
    const set = new Set(this.#memberTracks(item));
    if (set.has(trackId)) set.delete(trackId); else set.add(trackId);
    if (!set.size) set.add(trackId);              // 최소 한 트랙엔 놓인다
    // 트랙 인덱스 순서로 정렬 — 고른 것만, 사이는 안 채운다.
    const ordered = this.store.tracks.filter((t) => set.has(t.id)).map((t) => t.id);
    this.store.commit('소속 트랙', () => {
      item.place.tracks = ordered;
      item.place.t = ordered[0];
      item.place.sp = this.#homeRunLen(ordered);  // 홈부터 연속으로 몇 칸인지(레거시 표시용)
    });
    this.#renderTrackMap(item);
  }

  /** 정렬된 소속 트랙에서 홈(첫째)부터 연속된 칸 수. */
  #homeRunLen(orderedIds) {
    const idx = orderedIds.map((id) => this.store.trackIndex(id));
    let n = 1;
    for (let k = 1; k < idx.length; k += 1) { if (idx[k] === idx[k - 1] + 1) n += 1; else break; }
    return n;
  }

  // ── 관계 (선행·상위) — 같은 보드 안, 팝업 트리 버튼 ────────

  /** 선행 일정 — '고르기' 버튼 + 현재 선행 요약. 팝업 트리(여럿)에서 이 보드 카드를 고른다. */
  #renderDeps(item) {
    const box = $('i-deps');
    clear(box);
    box.append(el('button.btn.outline.sm', { type: 'button', text: '편집', title: '선행관계설정 — 먼저 끝나야 하는 일정 고르기', on: { click: () => this.#openDepsPicker() } }));
    const cur = this.store.relations.filter((r) => r.type === 'dep' && r.to === item.id).map((r) => r.from);
    const list = el('div.combine-summary');
    if (!cur.length) list.append(el('div.empty', { text: '선행 일정이 없습니다.' }));
    for (const id of cur) {
      list.append(el('div.combine-chip', {}, [
        el('span.combine-chip-name', { text: this.store.item(id)?.ti || '(제목 없음)' }),
        el('button.task-del', { type: 'button', title: '선행에서 빼기', on: { click: () => this.#toggleDep(id) } }, [icon(ICONS.close)]),
      ]));
    }
    box.append(list);
  }

  async #openDepsPicker() {
    const item = this.item;
    if (!item || this.store.readonly) return;
    const checked = new Set(this.store.relations.filter((r) => r.type === 'dep' && r.to === item.id).map((r) => r.from));
    const nodes = this.#boardTreeNodes({ self: item.id, exclude: new Set([item.id]) });
    const result = await askTree({ title: '선행관계설정', message: '먼저 끝나야 하는 일정들(같은 보드)을 고르세요.', nodes, checked, select: 'multi' });
    if (!result) return;
    this.store.commit('선행 일정 변경', (doc) => {
      doc.relations = (doc.relations ?? []).filter((r) => !(r.type === 'dep' && r.to === item.id));
      for (const from of result) if (from !== item.id) doc.relations.push({ id: newId('r'), type: 'dep', from, to: item.id });
    });
    this.#renderDeps(item);
  }

  #toggleDep(otherId) {
    const item = this.item;
    if (!item) return;
    const dep = (r) => r.type === 'dep' && r.from === otherId && r.to === item.id;
    this.store.commit('선행 일정 변경', (doc) => {
      if (doc.relations.some(dep)) doc.relations = doc.relations.filter((r) => !dep(r));
      else doc.relations.push({ id: newId('r'), type: 'dep', from: otherId, to: item.id });
    });
    this.#renderDeps(item);
  }

  // ── 동일(합치기 작업) · 조합(구성) — docs/SYSTEM.md §7.1·§7.2 ──

  /** 이 이벤트를 이루는 조합 대상 id들 (doc.compose). 공용 모듈에 위임. */
  #composedOf() {
    return composedOf(this.store, this.item?.id);
  }

  /** 조합 대상의 본질 — 모든 보드 이벤트 목록에 없으면(어느 보드 화면에도 없음) 따로 받아 둔 것 */
  #eventInfo(id) {
    return (this._allEvents ?? []).find((e) => e.id === id) ?? this._extraEvents.get(id) ?? null;
  }

  /**
   * 동일(합치기) UI — 팝업 버튼. 누르면 다른 프로젝트의 이벤트를 트리로 펼쳐 하나 고르고, 본질을
   * 어느 쪽으로 남길지 물은 뒤 두 이벤트를 하나로 합친다. 인라인 목록이 아니다.
   */
  #renderSame(item) {
    const box = $('i-same');
    clear(box);
    box.append(el('button.btn.outline.sm', {
      type: 'button', text: '편집', title: '항등설정 — 같은 이벤트로 합칠 대상 고르기',
      on: { click: () => this.#openMergePicker() },
    }));
    // 제목 검색 드롭다운(합치기 후보) 재료 — 자기 자신 제외한 모든 보드 이벤트.
    this._sameOptions = new Map((this._allEvents ?? []).filter((e) => e.id !== item.id).map((e) => [e.id, e]));
  }

  /** 동일 팝업 → 대상 하나 고르면 본질 선택 후 합친다. */
  async #openMergePicker() {
    const item = this.item;
    if (!item || this.store.readonly) return;
    const targetId = await pickEventForMerge(this.adapter, item.id);
    if (targetId) await this.#confirmMerge(targetId);
  }

  /**
   * 조합(구성) UI — 팝업 버튼 + 이 이벤트를 이루는 것 요약(읽기 전용). 해제는 요약이 아니라 팝업에서
   * 체크를 풀어서 한다(조합은 둘 이상의 묶음이라 요약에서 하나씩 빼면 규칙이 깨진다).
   */
  #renderCombine(item) {
    const box = $('i-combine');
    clear(box);
    box.append(el('button.btn.outline.sm', {
      type: 'button', text: '편집', title: '조합설정 — 이 이벤트를 이루는 이벤트 고르기',
      on: { click: () => this.#openCombinePicker() },
    }));
    const children = [...this.#composedOf()];
    const list = el('div.combine-summary');
    if (!children.length) list.append(el('div.empty', { text: '조합한 이벤트가 없습니다.' }));
    for (const cid of children) {
      const ev = this.#eventInfo(cid);
      const kindLabel = ev?.kind === 'track' ? '트랙' : ev?.kind === 'board' ? '프로젝트' : '카드';
      list.append(el('div.combine-chip', {}, [
        el('span.combine-chip-name', { text: (ev?.title || '(다른 보드 이벤트)') }),
        el('em.muted', { text: `${kindLabel}${ev?.boardNames ? ' · ' + ev.boardNames : ''}` }),
      ]));
    }
    box.append(list);
  }

  /** 조합 트리 팝업 — 체크한 이벤트들로 이 이벤트를 이룬다(구성, 둘 이상). */
  async #openCombinePicker() {
    const item = this.item;
    if (!item) return;
    const changed = await openCombinePicker(this.store, this.adapter, item.id);
    if (changed) { this.#renderCombine(item); this.#renderChildren(item); }
  }

  /**
   * 동일 매핑 = 두 이벤트를 하나로 합치는 작업(docs/SYSTEM.md §7.2). 남길 본질을 매번 고르게 하고
   * (안 고른 이름은 사라짐 — 별칭 보존은 후속), repository가 관계를 합치고 순환이면 거부한다.
   * 합친 뒤 현재 보드를 다시 읽어 반영한다. 되돌리기 스냅샷은 보관한다.
   */
  async #confirmMerge(targetId) {
    const item = this.item;
    if (!item || targetId === item.id || this.store.readonly) return;
    const ev = (this._sameOptions?.get(targetId)) || (this._allEvents ?? []).find((e) => e.id === targetId);
    const mine = item.ti || '(제목 없음)';
    const theirs = ev?.title || '(제목 없음)';
    const choice = await askChoice({
      title: '항등설정 — 같은 이벤트로 합치기',
      message: '두 이벤트를 하나로 합칩니다. 남길 본질(제목·상태·날짜)을 고르세요.',
      choices: [
        { key: 'mine', label: '이 이벤트를 남긴다', sub: mine },
        { key: 'theirs', label: '상대 이벤트를 남긴다', sub: theirs },
      ],
    });
    if (!choice) return;
    const keepId = choice === 'mine' ? item.id : targetId;
    const dropId = choice === 'mine' ? targetId : item.id;
    let res;
    try { res = await this.adapter?.mergeEvents?.(keepId, dropId); }
    catch (e) { toast('합치기 실패: ' + String(e.message || e), 'warn'); return; }
    if (!res || res.ok !== true) { toast(res?.rejected ? '합칠 수 없음: ' + res.rejected : '합치기 실패', 'warn'); return; }
    this._lastMergeUndo = res.undo;
    // 합치기는 DB 전역 변경 — 현재 보드를 다시 읽고(정규화 포함), 다른 탭은 돌아갈 때 다시 읽는다.
    this.panels.close();
    await this.reloadBoard?.();
    toast('같은 이벤트로 합쳤습니다', '', { label: '되돌리기', on: () => this.#undoMerge() });
  }

  /** 방금 합친 것을 되돌린다(§7.2). repository가 합치기 전 스냅샷으로 복원하고 보드를 다시 읽는다. */
  async #undoMerge() {
    const snap = this._lastMergeUndo;
    if (!snap) return;
    this._lastMergeUndo = null;
    let res;
    try { res = await this.adapter?.unmergeEvents?.(snap); }
    catch (e) { toast('되돌리기 실패: ' + String(e.message || e), 'warn'); return; }
    if (!res || res.ok !== true) { toast('되돌리기 실패', 'warn'); return; }
    await this.reloadBoard?.();
    toast('합치기를 되돌렸습니다');
  }

  /** 제목으로 검색하면 뜨는 "같은 이벤트로 연결" 후보(모든 보드). 평상시엔 숨김. */
  #renderTitleDrop() {
    const drop = $('i-title-drop');
    drop.replaceChildren();
    this._dropMatches = [];
    this._dropIdx = -1;
    const item = this.item;
    const q = $(F.title).value.trim().toLowerCase();
    if (!item || !q || !this._sameOptions) { drop.hidden = true; return; }
    const matches = [...this._sameOptions.values()]
      .filter((ev) => ev.id !== item.id && (ev.title || '').toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { drop.hidden = true; return; }
    this._dropMatches = matches;
    matches.forEach((m) => {
      const row = el('button.title-drop-opt', {
        type: 'button',
        on: { mousedown: (e) => { e.preventDefault(); this.#confirmLink(m.id); } },
      }, [
        el('span.tdo-name', { text: m.title || '(제목 없음)' }),
        el('em', { text: m.kind === 'board' ? '프로젝트' : (m.boardNames || '') }),
      ]);
      drop.append(row);
    });
    drop.hidden = false;
  }

  /** 드롭다운을 ↓/↑로 훑는다. 열려 있으면 true(기본 동작 막기용). */
  #dropNav(delta) {
    const drop = $('i-title-drop');
    if (drop.hidden || !this._dropMatches?.length) return false;
    const n = this._dropMatches.length;
    this._dropIdx = (this._dropIdx + delta + n) % n;
    const rows = [...drop.querySelectorAll('.title-drop-opt')];
    rows.forEach((r, i) => r.classList.toggle('active', i === this._dropIdx));
    rows[this._dropIdx]?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** 제목 검색 드롭다운에서 고른 기존 이벤트와 '같은 이벤트로 합치기'(동일 매핑)를 연다. */
  async #confirmLink(targetId) {
    const item = this.item;
    if (!item || targetId === item.id) return;
    $('i-title-drop').hidden = true;
    await this.#confirmMerge(targetId);
  }

  /**
   * 모자관계 — '편집' 버튼 + 지금의 부모·자식 요약. 팝업에서 부모 설정 / 자식 설정을 함께 고친다.
   * 카드 하나를 만들고 그 안에 들 카드들을 한꺼번에 고르는 경우가 많아 자식 쪽에서도 정할 수 있게 한다.
   */
  #renderParents(item) {
    const box = $('i-parent');
    clear(box);
    box.append(el('button.btn.outline.sm', { type: 'button', text: '편집', title: '모자관계설정 — 부모(품는 카드)·자식(품을 카드) 고르기', on: { click: () => this.#openParentChildPicker() } }));
    const list = el('div.combine-summary');
    const chip = (text, title, onRemove) => el('div.combine-chip', {}, [
      el('span.combine-chip-name', { text }),
      el('button.task-del', { type: 'button', title, on: { click: onRemove } }, [icon(ICONS.close)]),
    ]);
    list.append(el('div.pc-head', { text: '부모' }));
    if (!item.parent) list.append(el('div.empty', { text: '없음 (트랙에 직접)' }));
    else list.append(chip(this.store.item(item.parent)?.ti || '(제목 없음)', '부모에서 빼기', () => this.#applyParentChild(item, { parent: null })));
    const kids = this.store.items.filter((x) => x.parent === item.id);
    list.append(el('div.pc-head', { text: `자식${kids.length ? ` ${kids.length}` : ''}` }));
    if (!kids.length) list.append(el('div.empty', { text: '없음' }));
    for (const k of kids) {
      list.append(chip(k.ti || '(제목 없음)', '자식에서 빼기', () => {
        this.#applyParentChild(item, { children: new Set(kids.filter((x) => x.id !== k.id).map((x) => x.id)) });
      }));
    }
    box.append(list);
  }

  /** 이 카드가 놓인 트랙들 — 모자관계 후보는 이 트랙 안의 카드뿐이다(하위 카드면 상위의 트랙). */
  #homeTracks(item) {
    if (item.parent) return new Set([item.place.t]);
    return new Set(this.#memberTracks(item));
  }

  #ancestorsOf(id) {
    const out = new Set();
    let cur = this.store.item(id);
    let guard = 0;
    while (cur?.parent && guard++ < 256) { out.add(cur.parent); cur = this.store.item(cur.parent); }
    return out;
  }

  async #openParentChildPicker() {
    const item = this.item;
    if (!item || this.store.readonly) return;
    const tracks = this.#homeTracks(item);
    // 부모 후보: 같은 트랙, 자기·자손 제외(순환), 점 마일스톤 제외(품을 몸이 없다)
    const parentNodes = this.#boardTreeNodes({ tracks, self: item.id, noMs: true, exclude: new Set([item.id, ...this.#descendantsOf(item.id)]) });
    // 자식 후보: 같은 트랙, 자기·조상 제외(순환)
    const childNodes = this.#boardTreeNodes({ tracks, self: item.id, exclude: new Set([item.id, ...this.#ancestorsOf(item.id)]) });
    const res = await askTreeTabs({
      title: '모자관계설정',
      initial: 'children',
      tabs: [
        {
          key: 'parent', label: '부모 설정', select: 'radio', nodes: parentNodes,
          checked: new Set(item.parent ? [item.parent] : []),
          message: '이 카드를 품을 카드를 고릅니다(같은 트랙 안). 고른 것을 다시 누르면 부모 없음.',
          emptyText: '같은 트랙에 부모로 둘 카드가 없습니다.',
        },
        {
          key: 'children', label: '자식 설정', select: 'multi', nodes: childNodes,
          checked: new Set(this.store.items.filter((x) => x.parent === item.id).map((x) => x.id)),
          message: '이 카드 안에 넣을 카드들을 한꺼번에 고릅니다(같은 트랙 안). 체크를 풀면 트랙으로 나옵니다.',
          emptyText: '같은 트랙에 자식으로 넣을 카드가 없습니다.',
        },
      ],
    });
    if (!res) return;
    this.#applyParentChild(item, { parent: [...res.parent][0] ?? null, children: res.children });
  }

  /**
   * 부모·자식을 한 번에 바꾼다(되돌리기 1단계). 넣으면 트랙은 부모를 따르고, 빼면 그 트랙 최상위로 나온다.
   * 결과가 순환이면(고른 부모를 자식으로도 고른 경우 등) 바꾸지 않는다.
   * @param {{parent?: string|null, children?: Set<string>}} next  빠진 쪽은 그대로
   */
  #applyParentChild(item, next) {
    if (!item || this.store.readonly) return;
    const byId = new Map(this.store.items.map((x) => [x.id, x]));
    const parentOf = new Map(this.store.items.map((x) => [x.id, x.parent ?? null]));
    const curKids = new Set(this.store.items.filter((x) => x.parent === item.id).map((x) => x.id));
    if ('parent' in next) parentOf.set(item.id, next.parent);
    if (next.children) {
      for (const id of next.children) parentOf.set(id, item.id);
      for (const id of curKids) if (!next.children.has(id)) parentOf.set(id, null);
    }
    // 순환 검사 — 모든 카드가 부모 사슬을 따라 최상위에 닿아야 한다
    for (const id of parentOf.keys()) {
      const seen = new Set([id]);
      let p = parentOf.get(id);
      while (p) {
        if (seen.has(p)) { toast('부모와 자식이 서로를 품게 되어 적용하지 않았습니다', 'warn'); return; }
        seen.add(p); p = parentOf.get(p);
      }
    }
    const changed = [...parentOf].filter(([id, p]) => (byId.get(id)?.parent ?? null) !== p);
    if (!changed.length) return;
    this.store.commit('모자관계 설정', (doc) => {
      const d = new Map(doc.items.map((x) => [x.id, x]));
      for (const [id, p] of changed) {
        const x = d.get(id);
        if (!x) continue;
        x.parent = p;
        x.place.x = null; x.place.w = null; x.place.sp = 1;
        if (!p) x.place.tracks = [x.place.t];            // 빼면 그 트랙 최상위로
      }
      // 트랙은 최상위 조상을 따른다(자손까지)
      const top = (x, g = 0) => (x.parent && d.has(x.parent) && g < 256 ? top(d.get(x.parent), g + 1) : x);
      for (const x of doc.items) {
        if (!x.parent) continue;
        const root = top(x);
        x.place.t = root.place.t;
        x.place.tracks = [root.place.t];
      }
    });
    this.#renderTrackMap(item);
    this.#renderParents(item);
    this.#renderChildren(item);
  }

  #descendantsOf(id) {
    const out = new Set();
    const walk = (parentId) => {
      for (const child of this.store.items) {
        if (child.parent === parentId && !out.has(child.id)) { out.add(child.id); walk(child.id); }
      }
    };
    walk(id);
    return out;
  }

  // ── 태스크 ──────────────────────────────────────────────

  #renderTasks(item) {
    const box = $('i-tasks');
    clear(box);
    const tasks = Array.isArray(item.tasks) ? item.tasks : [];

    const done = tasks.filter((t) => t.done).length;
    $('i-taskcount').textContent = tasks.length ? `${done}/${tasks.length}` : '';

    if (!tasks.length) {
      box.append(el('div.empty', { text: '아직 태스크가 없습니다.' }));
      return;
    }

    for (const t of tasks) {
      const cb = el('input', {
        type: 'checkbox', checked: t.done,
        on: {
          change: (e) => {
            this.store.commit('태스크 완료', () => { t.done = e.target.checked; this.#syncProgress(item); });
            this.#renderTasks(this.item);
            this.#syncProgUI(this.item);
          },
        },
      });
      const text = el('input.task-text', {
        type: 'text', value: t.text, placeholder: '할 일',
        on: { input: (e) => { this.store.commit('태스크 수정', () => { t.text = e.target.value; }); } },
      });
      const up = el('button.task-del.task-promote', {
        type: 'button', title: '하위 카드로 승격 (순서축에 올림 · 규칙 5, id 유지)',
        on: { click: (e) => { e.preventDefault(); this.#promoteTask(item, t); } },
      }, [icon(ICONS.up)]);
      const rm = el('button.task-del', {
        type: 'button', title: '태스크 삭제',
        on: {
          click: () => {
            this.store.commit('태스크 삭제', () => { item.tasks = item.tasks.filter((x) => x.id !== t.id); this.#syncProgress(item); });
            this.#renderTasks(this.item);
            this.#syncProgUI(this.item);
          },
        },
      }, [icon(ICONS.close)]);
      const row = el('label.task', {}, [cb, text, up, rm]);
      if (t.done) row.classList.add('done');
      box.append(row);
    }
  }

  #addTask() {
    const item = this.item;
    if (!item) return;
    const task = { id: newId('k'), text: '', done: false };
    this.store.commit('태스크 추가', () => {
      if (!Array.isArray(item.tasks)) item.tasks = [];
      item.tasks.push(task);
      this.#syncProgress(item);
    });
    this.#renderTasks(this.item);
    this.#syncProgUI(this.item);
    const inputs = $('i-tasks').querySelectorAll('.task-text');
    inputs[inputs.length - 1]?.focus();
  }

  // ── 진행도 (태스크 완료율) + 하위 카드 목록 ──────────────

  /** 진척률 = 태스크 완료 비율. 태스크가 있으면 자동 계산해 item.pg에 반영. */
  #syncProgress(item) {
    const tasks = Array.isArray(item.tasks) ? item.tasks : [];
    if (!tasks.length) { item.pg = 0; return; }
    item.pg = Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
  }

  /** 진행도 바는 제거됨 — 호출부 호환용 no-op. */
  #syncProgUI() {}

  /**
   * 세부내역 — 조합한 이벤트가 있으면 그것을, 없으면 하위 카드를 트리로 보여 준다(같은 모양:
   * [▸] 상태점 이름 (열기)). 자식이 있으면 헤더를 눌러 펼치고 접는다. 여기서 카드를 새로 만들지
   * 않는다 — 보드에서 만든다.
   */
  #renderChildren(item) {
    const box = $('i-children');
    clear(box);
    const gen = (this._detailGen = (this._detailGen ?? 0) + 1);

    // 공통 노드. hasKids면 접기 그룹(헤더+자식칸), 아니면 잎 행.
    const node = ({ title, status = 'plan', onOpen, tag, hasKids }) => {
      const chev = hasKids ? el('span.tw', {}, [icon(ICONS.down)]) : el('span.tw-none');
      const name = onOpen
        ? el('button.task-text.linklike.no-toggle', { type: 'button', text: title || '(제목 없음)', title: '열기', on: { click: (e) => { e.stopPropagation(); onOpen(); } } })
        : el('span.task-text', { text: title || '(제목 없음)' });
      const head = el('div.task.detail-row', {}, [
        chev, el('span.st-dot', { className: 'st-dot st-' + status }), name,
        tag ? (tag.nodeType ? tag : el('em.muted', { text: tag })) : null,
      ]);
      if (status === 'done') head.classList.add('done');
      if (!hasKids) return { row: head, kids: null };
      const group = el('div.detail-group');
      const kids = el('div.detail-kids');
      head.classList.add('detail-parent');
      head.addEventListener('click', (e) => { if (!e.target.closest('.no-toggle')) group.classList.toggle('collapsed'); });
      group.append(head, kids);
      return { row: group, kids };
    };

    // 세부내역 — 조합한 이벤트가 있으면 그것(이 이벤트를 이루는 것)을, 없으면 하위 카드를 보여 준다.
    const refs = (this.store.doc.compose ?? []).filter((r) => r.parent === item.id);

    // (1) 조합한 다른 보드 이벤트 — doc.compose(메모리)에서 바로 읽는다(해제하면 즉시 사라짐).
    //     각 대상은 접기 그룹으로, 그 안쪽 카드는 eventCards(DB, 최신)로 채운다.
    if (refs.length) {
      for (const ref of refs) {
        const pev = this.#eventInfo(ref.child);
        const partBoard = pev ? (pev.boardId ?? (Number(String(pev.boardIds ?? '').split(',')[0]) || null)) : null;
        const { row, kids } = node({
          title: pev?.title || '(다른 보드 이벤트)', status: pev?.st ?? 'plan', tag: '조합', hasKids: true,
          onOpen: partBoard ? () => this.openProject?.(partBoard) : null,
        });
        box.append(row);
        kids.append(el('div.empty', { text: '불러오는 중…' }));
        this.adapter?.eventCards?.(ref.child).then((cards) => {
          if (this._detailGen !== gen || this.item?.id !== item.id) return;
          clear(kids);
          if (!(cards && cards.length)) { kids.append(el('div.empty', { text: '하위 일정 없음' })); return; }
          for (const c of cards) {
            const r = node({ title: c.title, status: c.status, hasKids: false, onOpen: partBoard ? () => this.openProject?.(partBoard) : null });
            if (c.depth) r.row.style.paddingLeft = `${8 + c.depth * 14}px`;
            kids.append(r.row);
          }
        }).catch(() => { if (this._detailGen === gen && this.item?.id === item.id) { clear(kids); kids.append(el('div.empty', { text: '불러오지 못함' })); } });
      }
      return;
    }

    // (2) 조합이 없으면 — 같은 보드 하위 카드 트리. '태스크로 내림'을 뒤에 붙인다.
    const renderKid = (c, container) => {
      const subKids = this.store.items.filter((x) => x.parent === c.id);
      const demote = el('button.task-del.task-demote.no-toggle', {
        type: 'button', title: '태스크로 내림 (규칙 5, id 유지)',
        on: { click: (e) => { e.preventDefault(); e.stopPropagation(); this.#demoteChild(this.item, c); } },
      }, [icon(ICONS.down)]);
      const { row, kids } = node({
        title: c.ti, status: c.st, onOpen: () => this.open(c.id), tag: demote, hasKids: subKids.length > 0,
      });
      container.append(row);
      if (kids) for (const s of subKids) renderKid(s, kids);
    };
    const own = this.store.items.filter((x) => x.parent === item.id);
    for (const c of own) renderKid(c, box);

    if (!own.length) box.append(el('div.empty', { text: '세부내역이 없습니다 — 조합한 이벤트도, 하위 카드도 없습니다.' }));
  }

  /** 다른 보드의 이벤트(카드·트랙·프로젝트)를 받아 동일·조합 후보·구성 일정을 갱신. */
  async #loadCrossBoard(item) {
    let events = null;
    try { events = await this.adapter?.listEvents?.(); } catch { events = null; }
    if (this.item?.id !== item.id) return;
    // 새로 받았을 때만 갈아끼운다. 실패·미지원이면 이전 목록을 지키고 빈 목록으로 만들지
    // 않는다 — 한 번 삐끗해도 동일·조합의 다른 보드 트랙들이 사라지지 않게.
    if (Array.isArray(events)) this._allEvents = events;
    else if (!Array.isArray(this._allEvents)) this._allEvents = [];
    // 어느 보드 화면에도 없는 조합 대상은 목록에 없다 — 이름만 따로 받아 둔다.
    const known = new Set(this._allEvents.map((e) => e.id));
    const unknown = [...this.#composedOf()].filter((id) => !known.has(id) && !this._extraEvents.has(id));
    if (unknown.length) {
      try { for (const e of (await this.adapter?.eventsById?.(unknown)) ?? []) this._extraEvents.set(e.id, e); } catch { /* 이름 없이 둔다 */ }
      if (this.item?.id !== item.id) return;
    }
    this.#renderSame(item);
    this.#renderCombine(item);
    this.#renderChildren(item);
  }

  /**
   * 태스크↔하위 카드 전환 — 규칙 5. 하위 카드와 태스크는 '순서축에 놓이는가'로만 갈린다.
   * 전환은 배치만 바뀌고 **id는 그대로** (삭제 후 생성이 아니다).
   */
  #promoteTask(item, task) {
    if (!item || this.store.readonly) return;
    this.store.commit('태스크를 하위 카드로', (doc) => {
      const parent = doc.items.find((x) => x.id === item.id);
      if (!parent) return;
      parent.tasks = (Array.isArray(parent.tasks) ? parent.tasks : []).filter((t) => t.id !== task.id);
      doc.items.push({
        id: task.id,                                   // id 유지
        ti: task.text || '새 카드', s: parent.s, e: parent.e,
        ty: 'bar', st: task.done ? 'done' : 'plan', og: parent.og, pg: 0, note: '',
        parent: parent.id, alias: null, tasks: [],
        place: {
          t: parent.place.t, sp: 1, x: null, w: null, hd: null, align: 'middle', showNote: false,
          slot: parent.place.slot ? { ...parent.place.slot } : null,     // 날짜 없는 보드 — 부모 칸 그대로
        },
      });
      this.#syncProgress(parent);
    });
    this.#renderTasks(this.item);
    this.#renderChildren(this.item);
    this.#syncProgUI(this.item);
  }

  #demoteChild(item, child) {
    if (!item || this.store.readonly) return;
    // 태스크는 순서 없는 잎이다 — 자손을 가진 카드는 내리면 그 층을 잃으므로 막는다.
    if (this.store.items.some((x) => x.parent === child.id)) { toast('하위 카드가 있는 카드는 태스크로 내릴 수 없습니다'); return; }
    this.store.commit('하위 카드를 태스크로', (doc) => {
      doc.items = doc.items.filter((x) => x.id !== child.id);
      const parent = doc.items.find((x) => x.id === item.id);
      if (!parent) return;
      if (!Array.isArray(parent.tasks)) parent.tasks = [];
      parent.tasks.push({ id: child.id, text: child.ti || '', done: child.st === 'done' });   // id 유지
      this.#syncProgress(parent);
    });
    this.#renderTasks(this.item);
    this.#renderChildren(this.item);
    this.#syncProgUI(this.item);
  }

  // ── 폼 적용 ─────────────────────────────────────────────

  /** 속성 탭의 단순 입력 → 문서. 관계·별칭은 각 리스트가 직접 반영한다. */
  apply() {
    const item = this.item;
    if (!item) return;

    this.store.commit('일정 편집', () => {
      item.ti = $(F.title).value;
      item.ty = $(F.type).value;
      if (this.store.meta.display?.dated !== false) {
        item.s = $(F.start).value || item.s;
        item.e = $(F.end).value || item.s;
        if (item.e < item.s) item.e = item.s;
      } else {
        const s = Math.max(1, Math.round(Number($(F.slot).value) || 1)) - 1;
        const len = Math.max(1, Math.round(Number($(F.slotLen).value) || 1));
        item.place.slot = { s, len };
      }
      item.og = $(F.org).value;
      item.note = $(F.note).value;
    });

    $(F.end).value = item.e ?? '';
    if (item.place?.slot) {
      $(F.slot).value = String(item.place.slot.s + 1);
      $(F.slotLen).value = String(item.place.slot.len);
    }
  }

  /**
   * 보드에서 빼기 (Delete) — 이 카드와 그 안에 든 하위 카드를 이 보드에서 뺀다. 이벤트는 지우지 않는다:
   * 부모를 모두 잃으면 휴지통(첫 화면)에 구조째 가고, 방금 만든 것이면 바로 없어진다(docs/SAVE.md §7).
   * 관계는 보드 밖 대상이라 저장이 지우지 않는다 — 화면에서만 걷어 낸다.
   */
  remove() {
    const item = this.item;
    if (!item || this.store.readonly) return;
    const title = item.ti || '이름 없는 일정';
    const gone = new Set([item.id, ...this.#descendantsOf(item.id)]);
    this.store.commit('보드에서 빼기', (doc) => {
      doc.items = doc.items.filter((x) => !gone.has(x.id));
      doc.relations = (doc.relations ?? []).filter((r) => !gone.has(r.from) && !gone.has(r.to));
      doc.compose = (doc.compose ?? []).filter((c) => !gone.has(c.parent));
    });
    this.panels.close();
    const inner = gone.size - 1;
    toast(`'${title}'${inner ? ` 외 ${inner}건` : ''}을(를) 보드에서 뺐습니다 — Ctrl+Z로 되돌립니다`);
  }

  duplicate() {
    const item = this.item;
    if (!item) return;
    // 복제본은 별개 이벤트다 — 새 id·별칭 없음. 동일(same) 링크는 이어받지 않는다.
    const copy = { ...structuredClone(item), id: newId('e'), ti: item.ti + ' (복사)', alias: null };
    copy.tasks = (Array.isArray(item.tasks) ? item.tasks : []).map((t) => ({ ...t, id: newId('k') }));
    this.store.commit('일정 복제', (doc) => {
      doc.items.push(copy);
      // 원본으로 들어오던 '선행'만 복제본에도 (같은 선행을 가진 새 일정). 동일/기타는 제외.
      const incoming = (doc.relations ?? []).filter((r) => r.to === item.id && r.type === 'dep');
      for (const r of incoming) doc.relations.push({ id: newId('r'), type: 'dep', from: r.from, to: copy.id });
    });
    this.open(copy.id);
  }
}
