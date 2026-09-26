/**
 * 일정 편집 패널 — PPT 서식창처럼 탭으로 나눈다.
 *   속성   제목·상태·트랙·유형·기간·걸침·진척·담당·비고
 *   관계   선행·상위·별칭 — 셋 다 같은 "검색 리스트"로 통일 (엑셀 필터식)
 *   표시   글자 정렬·비고 표시·크기 강제 — 아이콘 토글
 *   태스크 순서 없는 할 일
 */
import { shortMD, dayIndex, parseDate, inclusiveDays } from '../../core/dates.js';
import { newId, ALIGNS } from '../../core/schema.js';
import { STATUSES, ITEM_TYPES } from '../../config/index.js';
import { $, el, clear, icon, ICONS } from '../dom.js';
import { createFilterList } from '../components/filter-list.js';
import { askConfirm } from '../dialog.js';
import { toast } from '../toast.js';

/** 값이 바로 문서로 반영되는 단순 입력들 (트랙·관계·별칭·진척은 매핑 탭 UI가 맡는다) */
const F = {
  title: 'i-title', type: 'i-type', start: 'i-start',
  end: 'i-end', org: 'i-org', note: 'i-note',
};

const ALIGN_ICON = { top: ICONS.alignTop, middle: ICONS.alignMiddle, bottom: ICONS.alignBottom };
const ALIGN_LABEL = { top: '위', middle: '가운데', bottom: '아래' };

/** 여러 줄 제목 입력이 내용에 맞게 높이를 늘리도록 */
function autogrow(node) {
  node.style.height = 'auto';
  node.style.height = node.scrollHeight + 'px';
}

export class ItemPanel {
  constructor({ store, view, panels, adapter, openProject, onChange }) {
    Object.assign(this, { store, view, panels, adapter, openProject, onChange });
    this.#buildStatic();
    this.#buildLists();
    this.#bind();
  }

  get item() { return this.view.selectedItem ? this.store.item(this.view.selectedItem) : null; }

  #buildStatic() {
    const type = $(F.type);
    clear(type);
    for (const t of ITEM_TYPES) type.append(el('option', { value: t.key, text: t.label }));

    const status = $('i-status');
    clear(status);
    for (const s of STATUSES) {
      status.append(el('button', {
        type: 'button', dataset: { st: s.key }, text: s.label,
        on: { click: () => this.#setStatus(s.key) },
      }));
    }

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

    // 표시 토글 아이콘
    $('i-shownote').append(icon(ICONS.note));
    $('i-fixedh').append(icon(ICONS.resize));
    // 탭
    for (const tab of $('pItem').querySelectorAll('.ptab')) {
      tab.addEventListener('click', () => this.#showTab(tab.dataset.tab));
    }
  }

  /** 관계 3종을 같은 검색 리스트로. 선택은 문서가 진실이라 isSelected를 매번 물어본다. */
  #buildLists() {
    this.depsList = createFilterList({
      mode: 'multi', placeholder: '선행 일정 검색…', emptyText: '선택할 다른 일정이 없습니다.',
      isSelected: (id) => this.store.relations.some((r) => r.type === 'dep' && r.from === id && r.to === this.item?.id),
      onChange: (id) => this.#toggleDep(id),
    });
    this.parentList = createFilterList({
      mode: 'single', placeholder: '상위 일정 검색…', emptyText: '품을 수 있는 일정이 없습니다.',
      isSelected: (id) => this.item?.parent === id,
      onChange: (id, next) => this.#setParent(next ? id : null),
    });
    // 동일·조합 = 이 이벤트를 다른 이벤트와 잇는다. 보드를 넘어 모든 카드·트랙·프로젝트가 후보.
    //   1개 고르면 → 같은 이벤트(동일). 본질을 공유하고, 이 보드 이름은 별칭으로 유지.
    //   2개 이상 → 이 이벤트가 그것들의 합(조합, §3.7). 각각을 품는다.
    this.sameList = createFilterList({
      mode: 'multi', placeholder: '다른 보드의 카드·트랙·프로젝트 검색…', emptyText: '이을 이벤트가 없습니다.',
      isSelected: (id) => this.#linkedTargets().has(id),
      onChange: (id, next) => this.#toggleSame(id, next),
    });
    $('i-deps').append(this.depsList.root);
    $('i-parent').append(this.parentList.root);
    $('i-same').append(this.sameList.root);
  }

  #bind() {
    for (const id of Object.values(F)) {
      $(id).addEventListener('change', () => this.apply());
    }
    // 제목은 입력 즉시 카드에 반영 (기획안 §5 즉시 반영) + 같은 이벤트에 전파.
    // 동시에 제목으로 검색하면 기존 카드를 "같은 것으로 연결" 후보로 드롭다운에 띄운다.
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

    // 별칭 — 이 보드에서 부를 다른 이름. 본질이 아니라 표시라 같은 카드로 전파하지 않는다.
    $('i-aliasname').addEventListener('input', () => {
      const item = this.item;
      if (!item) return;
      this.store.commit('별칭', () => { item.alias = $('i-aliasname').value.trim() || null; });
    });
    // 제목을 별칭으로 — 같은 이벤트로 묶인 카드가 이 보드에선 자기 이름을 유지하게 한다.
    $('i-alias-fromname').addEventListener('click', () => {
      const item = this.item;
      if (!item) return;
      const name = item.ti || '';
      this.store.commit('제목을 별칭으로', () => { item.alias = name || null; });
      $('i-aliasname').value = name;
    });

    // 표시 토글 — 아이콘 버튼(aria-pressed)
    $('i-shownote').addEventListener('click', () => {
      const item = this.item;
      if (!item) return;
      const next = $('i-shownote').getAttribute('aria-pressed') !== 'true';
      this.store.commit('비고 표시', () => { item.place.showNote = next; });
      $('i-shownote').setAttribute('aria-pressed', String(next));
    });
    // 크기 강제 — 켜면 현재 기간 길이(일)로 시작, 가로·세로를 드래그로. 끄면 자동 크기로.
    $('i-fixedh').addEventListener('click', () => {
      const item = this.item;
      if (!item) return;
      const next = $('i-fixedh').getAttribute('aria-pressed') !== 'true';
      this.store.commit('크기 강제', () => {
        if (next) {
          item.place.hd = Math.max(1, inclusiveDays(item.s, item.e));
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
    $('i-childadd').addEventListener('click', () => this.#addChild());
    $('i-del').addEventListener('click', () => this.remove());
    $('i-dup').addEventListener('click', () => this.duplicate());
  }

  #showTab(name) {
    for (const b of $('pItem').querySelectorAll('.ptab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === name));
    }
    for (const s of $('pItem').querySelectorAll('.ptab-panel')) {
      s.hidden = s.dataset.panel !== name;
    }
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
    $(F.start).value = item.s;
    $(F.end).value = item.e;
    $(F.org).value = item.og;
    $(F.note).value = item.note ?? '';
    $('i-aliasname').value = item.alias ?? '';
    $('i-title-drop').hidden = true;

    this.#syncStatus(item);
    this.#syncAlign(item);
    this.#renderTrackMap(item);
    $('i-shownote').setAttribute('aria-pressed', String(item.place?.showNote === true));
    $('i-fixedh').setAttribute('aria-pressed', String(item.place?.hd != null));

    this._allEvents = null;            // 다른 보드 이벤트는 아래에서 비동기로 받는다
    this.#renderDeps(item);
    this.#renderParents(item);
    this.#renderSame(item);            // 우선 로컬(빈 후보) — 로드 후 채운다
    this.#renderTasks(item);
    this.#renderChildren(item);        // 우선 로컬 하위 카드
    this.#syncProgUI(item);            // 우선 태스크 진행도
    this.#loadCrossBoard(item);        // 모든 보드 이벤트 로드 → 동일 후보·하위·진행도 갱신

    this.#showTab('attr');
    this.panels.open('pItem');
    this.onChange?.();
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
   * 트랙 매핑 — 이 이벤트가 덮을 트랙을 고른다(여럿 가능, §3.7). 트랙 칩을 눌러 켜고 끈다.
   * 여러 트랙을 고르면 그 최소~최대 범위를 덮는다(화면상 한 덩어리라 경계는 이어진다).
   * 자식 카드는 트랙이 상위를 따르므로 매핑하지 않는다.
   */
  #renderTrackMap(item) {
    const box = $('i-span');
    clear(box);
    if (item.parent) { box.append(el('span.muted', { text: '상위 일정 안에서는 트랙이 상위를 따릅니다.' })); return; }
    const tracks = this.store.tracks;
    const home = this.store.trackIndex(item.place.t);
    const sp = item.place.sp ?? 1;
    const covered = new Set();
    for (let k = 0; k < sp; k++) covered.add(home + k);
    tracks.forEach((t, i) => {
      box.append(el('button.seg-btn', {
        type: 'button', text: t.name, title: `${t.name} 매핑`,
        attrs: { 'aria-pressed': String(covered.has(i)) },
        on: { click: () => this.#toggleTrack(item, i) },
      }));
    });
  }

  #toggleTrack(item, idx) {
    const tracks = this.store.tracks;
    const home = this.store.trackIndex(item.place.t);
    const sp = item.place.sp ?? 1;
    const set = new Set();
    for (let k = 0; k < sp; k++) set.add(home + k);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    if (!set.size) set.add(idx);            // 최소 한 트랙엔 놓인다
    const min = Math.min(...set); const max = Math.max(...set);
    this.store.commit('트랙 매핑', () => {
      item.place.t = tracks[min].id;
      item.place.sp = max - min + 1;        // 고른 트랙들을 감싸는 범위(경계 포함)
    });
    this.#renderTrackMap(item);
  }

  // ── 관계 (선행·상위·별칭) ────────────────────────────────

  /** 선행 일정 — 트랙·시작일 순으로 후보를 늘어놓고, 검색으로 좁힌다. */
  #renderDeps(item) {
    const order = (tid) => this.store.trackIndex(tid);
    const origin = parseDate(this.store.meta.start);
    const options = this.store.items
      .filter((x) => x.id !== item.id)
      .sort((a, b) => order(a.place.t) - order(b.place.t) || dayIndex(a.s, origin) - dayIndex(b.s, origin))
      .map((x) => ({ id: x.id, label: x.ti || '(제목 없음)', sub: `${this.store.track(x.place.t)?.name ?? ''} · ${shortMD(x.s)}` }));
    this.depsList.render(options);
  }

  #toggleDep(otherId) {
    const item = this.item;
    if (!item) return;
    const dep = (r) => r.type === 'dep' && r.from === otherId && r.to === item.id;
    this.store.commit('선행 일정 변경', (doc) => {
      if (doc.relations.some(dep)) doc.relations = doc.relations.filter((r) => !dep(r));
      else doc.relations.push({ id: newId('r'), type: 'dep', from: otherId, to: item.id });
    });
  }

  // ── 동일 · 조합 = 이 이벤트를 다른 이벤트와 잇는다 (§3.4·§3.7, 보드를 넘나든다) ──

  /**
   * 동일·조합 후보 — 모든 단위가 이벤트다(§3.2). 카드·트랙·프로젝트(보드)를 모두 낸다.
   * this._allEvents는 open()에서 미리 받아 둔다. 자기 자신과는 잇지 않는다.
   */
  #renderSame(item) {
    this._sameOptions = new Map();
    const events = this._allEvents ?? [];
    const kindLabel = { board: '프로젝트', track: '트랙', card: '카드' };
    const excluded = this.#sameExcluded(item);
    const options = [];
    for (const ev of events) {
      if (excluded.has(ev.id)) continue;
      this._sameOptions.set(ev.id, ev);
      options.push({
        id: ev.id,
        label: ev.title || '(제목 없음)',
        sub: `${kindLabel[ev.kind] || ''}${ev.boardNames ? ' · ' + ev.boardNames : ''}`,
      });
    }
    this.sameList.render(options);
  }

  /** 동일·조합 후보에서 뺄 것: 자기 자신·자기가 걸친 트랙·조상(상위 일정)·자손. */
  #sameExcluded(item) {
    const out = new Set([item.id]);
    const home = this.store.trackIndex(item.place.t);
    const sp = item.place.sp ?? 1;
    for (let k = 0; k < sp; k += 1) { const t = this.store.tracks[home + k]; if (t) out.add(t.id); }
    let p = item.parent;
    while (p && !out.has(p)) { out.add(p); p = this.store.item(p)?.parent; }
    for (const d of this.#descendantsOf(item.id)) out.add(d);
    return out;
  }

  /** 이 이벤트가 same·combine로 이어 둔 대상 id 집합. 선택 상태의 진실. */
  #linkedTargets() {
    const id = this.item?.id;
    const set = new Set();
    if (!id) return set;
    for (const r of this.store.relations) {
      if (r.type === 'same' && (r.from === id || r.to === id)) set.add(r.from === id ? r.to : r.from);
      else if (r.type === 'combine' && r.from === id) set.add(r.to);
    }
    return set;
  }

  #toggleSame(targetId, next) {
    if (!this.item) return;
    const set = this.#linkedTargets();
    if (next) set.add(targetId); else set.delete(targetId);
    this.#applyLinks([...set]);
  }

  /**
   * 고른 대상 수로 뜻이 갈린다(사용자 규칙).
   *   1개 → 같은 이벤트(동일). 대상 본질을 물려받고, 이 보드 이름은 별칭으로 남긴다(§3.5).
   *   2개+ → 이 이벤트가 그것들의 합(조합, §3.7). combine로 각각을 품는다.
   *   0개 → 아무 연결도 없다.
   * 본질 공유는 저장 계층이 same 무리끼리 맞춰 준다(보드를 넘어).
   */
  #applyLinks(targets) {
    const item = this.item;
    if (!item) return;
    const id = item.id;
    const origName = item.ti;
    this.store.commit('동일·조합', (doc) => {
      const it = doc.items.find((x) => x.id === id) ?? item;
      // 이 이벤트가 걸어 둔 same·combine를 전부 걷어낸다 (다시 만든다)
      doc.relations = (doc.relations ?? []).filter((r) => {
        if (r.type === 'same' && (r.from === id || r.to === id)) return false;
        if (r.type === 'combine' && r.from === id) return false;
        return true;
      });
      if (targets.length === 1) {
        // 동일 — 이 카드가 그 이벤트다. 대상 본질을 물려받고, 이 보드 이름은 별칭으로 남긴다.
        const t = targets[0];
        const ev = this._sameOptions?.get(t);
        doc.relations.push({ id: newId('r'), type: 'same', from: id, to: t });
        if (ev) {
          if (!it.alias && origName && origName !== (ev.title ?? '')) it.alias = origName;
          it.ti = ev.title ?? it.ti; it.s = ev.s ?? it.s; it.e = ev.e ?? it.e;
          it.ty = ev.ty ?? it.ty; it.st = ev.st ?? it.st; it.og = ev.og ?? it.og;
          it.pg = ev.pg ?? it.pg; it.note = ev.note ?? it.note;
        }
      } else if (targets.length >= 2) {
        // 조합이 되는 순간 이건 부품 하나가 아니라 '그것들의 합'인 별개 이벤트다.
        // 동일 때 물려받은 이름(별칭에 원래 이름 보관)을 되돌려 제 정체성을 회복한다.
        if (it.alias) { it.ti = it.alias; it.alias = null; }
        for (const t of targets) doc.relations.push({ id: newId('r'), type: 'combine', from: id, to: t });
      } else if (it.alias) {
        // 0개 — 다시 독립 이벤트. 물려받아 가려졌던 원래 이름을 되돌린다.
        it.ti = it.alias; it.alias = null;
      }
    });
    this.#renderSame(item);
    if (this.item) {
      $('i-aliasname').value = this.item.alias ?? '';
      $(F.title).value = this.item.ti ?? '';
      autogrow($(F.title));
    }
  }

  /** 제목으로 검색하면 뜨는 "같은 카드로 연결" 후보(모든 보드). 평상시엔 숨김. */
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

  async #confirmLink(targetId) {
    const item = this.item;
    if (!item) return;
    $('i-title-drop').hidden = true;
    const ev = this._sameOptions?.get(targetId);
    const name = ev?.title || '(제목 없음)';
    const where = ev?.kind === 'board' ? '프로젝트' : (ev?.boardNames || '다른 보드');
    const ok = await askConfirm({
      title: '같은 이벤트로 연결', confirmLabel: '연결',
      message: `'${name}' (${where})와 같은 이벤트로 이을까요?`,
    });
    if (ok) {
      const set = this.#linkedTargets();
      set.add(targetId);
      this.#applyLinks([...set]);
    }
  }

  /** 상위 일정 후보 — 자기·자손·마일스톤을 뺀 것. 체크가 없으면 상위 없음(트랙에 직접). */
  #renderParents(item) {
    const descendants = this.#descendantsOf(item.id);
    const options = [];
    for (const other of this.store.items) {
      if (other.id === item.id || descendants.has(other.id) || other.ty === 'ms') continue;
      options.push({ id: other.id, label: other.ti || '(제목 없음)', sub: this.store.track(other.place.t)?.name ?? '' });
    }
    this.parentList.render(options);
  }

  #setParent(parentId) {
    const item = this.item;
    if (!item) return;
    this.store.commit('상위 일정 변경', () => {
      item.parent = parentId;
      if (parentId) {
        const host = this.store.item(parentId);
        if (host) { item.place.t = host.place.t; item.place.sp = 1; }
      }
      item.place.x = null;
      item.place.w = null;
    });
    // 상위에 담기면 트랙이 상위를 따르므로 트랙 매핑 표시도 갱신한다.
    this.#renderTrackMap(item);
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

  /** 이 카드가 어떤 보드(프로젝트)와 같은 이벤트면 그 보드 id, 아니면 null. */
  #linkedBoard(item) {
    const ev = (this._allEvents ?? []).find((e) => e.kind === 'board' && e.id === item?.id);
    return ev ? ev.boardId : null;
  }

  /** 이 보드에 속한(그 보드에 배치된) 카드들. */
  #boardCards(boardId) {
    return (this._allEvents ?? []).filter((e) => e.kind === 'card'
      && String(e.boardIds ?? '').split(',').map(Number).includes(boardId));
  }

  #syncProgUI(item) {
    const boardId = this.#linkedBoard(item);
    let pct = 0; let label;
    if (boardId != null) {
      // 이 카드는 그 프로젝트다 — 진행도는 그 보드에 속한 카드들의 완료율.
      const cards = this.#boardCards(boardId);
      const done = cards.filter((c) => c.st === 'done').length;
      pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
      label = cards.length ? `${done}/${cards.length} 카드` : '보드에 카드 없음';
    } else {
      const tasks = Array.isArray(item.tasks) ? item.tasks : [];
      pct = tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : 0;
      label = tasks.length ? `${pct}%` : '태스크로 계산';
    }
    $('i-progpct').textContent = label;
    $('i-progfill').style.width = `${pct}%`;
  }

  /**
   * 하위 카드 목록 — 투두 형태. 이 카드가 프로젝트(보드)와 같은 이벤트면 그 보드에 속한
   * 카드들이 나온다(펼치면 그 보드니까). 아니면 이 카드의 로컬 하위 카드.
   */
  #renderChildren(item) {
    const box = $('i-children');
    clear(box);
    const boardId = this.#linkedBoard(item);
    if (boardId != null) {
      $('i-childadd').hidden = true;
      const cards = this.#boardCards(boardId);
      if (!cards.length) { box.append(el('div.empty', { text: '그 보드에 카드가 없습니다.' })); return; }
      for (const c of cards) {
        const name = el('button.task-text.linklike', {
          type: 'button', text: c.title || '(제목 없음)', title: '그 보드 열기',
          on: { click: () => this.openProject?.(boardId) },
        });
        const row = el('label.task', {}, [el('span.st-dot', { className: 'st-dot st-' + c.st }), name]);
        if (c.st === 'done') row.classList.add('done');
        box.append(row);
      }
      return;
    }
    $('i-childadd').hidden = false;
    const kids = this.store.items.filter((x) => x.parent === item.id);
    if (!kids.length) { box.append(el('div.empty', { text: '하위 카드가 없습니다.' })); return; }
    for (const c of kids) {
      const cb = el('input', {
        type: 'checkbox', checked: c.st === 'done', title: '완료 표시',
        on: { change: (e) => { this.store.commit('하위 완료', () => { c.st = e.target.checked ? 'done' : 'run'; }); this.#renderChildren(this.item); } },
      });
      const name = el('button.task-text.linklike', {
        type: 'button', text: c.alias || c.ti || '(제목 없음)', title: '이 카드 열기',
        on: { click: () => this.open(c.id) },
      });
      const down = el('button.task-del.task-demote', {
        type: 'button', title: '태스크로 내림 (순서축에서 뺌 · 규칙 5, id 유지)',
        on: { click: (e) => { e.preventDefault(); this.#demoteChild(item, c); } },
      }, [icon(ICONS.down)]);
      const row = el('label.task', {}, [cb, name, down]);
      if (c.st === 'done') row.classList.add('done');
      box.append(row);
    }
  }

  /** 다른 보드의 이벤트(카드·트랙·프로젝트)를 받아 동일 후보·하위 카드·진행도를 갱신. */
  async #loadCrossBoard(item) {
    let events = [];
    try { events = (await this.adapter?.listEvents?.()) ?? []; } catch { events = []; }
    if (this.item?.id !== item.id) return;
    this._allEvents = events;
    this.#renderSame(item);
    this.#renderChildren(item);
    this.#syncProgUI(item);
  }

  #addChild() {
    const item = this.item;
    if (!item) return;
    const child = {
      id: newId('e'), ti: '새 하위 카드', s: item.s, e: item.e,
      ty: 'bar', st: 'plan', og: item.og, pg: 0, note: '', parent: item.id, alias: null, tasks: [],
      place: { t: item.place.t, sp: 1, x: null, w: null, hd: null, align: 'middle', showNote: false },
    };
    this.store.commit('하위 카드 추가', (doc) => { doc.items.push(child); });
    this.#renderChildren(this.item);
    this.open(child.id);   // 새 하위 카드를 바로 편집
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
        place: { t: parent.place.t, sp: 1, x: null, w: null, hd: null, align: 'middle', showNote: false },
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
      parent.tasks.push({ id: child.id, text: child.alias || child.ti || '', done: child.st === 'done' });   // id 유지
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
      item.s = $(F.start).value || item.s;
      item.e = $(F.end).value || item.s;
      if (item.e < item.s) item.e = item.s;
      item.og = $(F.org).value;
      item.note = $(F.note).value;
    });

    $(F.end).value = item.e;
  }

  remove() {
    const item = this.item;
    if (!item || this.store.readonly) return;
    const title = item.ti || '이름 없는 일정';
    this.store.commit('일정 삭제', (doc) => {
      doc.items = doc.items.filter((x) => x.id !== item.id);
      doc.relations = (doc.relations ?? []).filter((r) => r.from !== item.id && r.to !== item.id);
    });
    this.panels.close();
    toast(`'${title}'을(를) 삭제했습니다`);
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
