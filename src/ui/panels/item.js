/**
 * 일정 편집 패널 — PPT 서식창처럼 탭으로 나눈다.
 *   속성   제목·상태·트랙·유형·기간·걸침·진척·담당·비고
 *   관계   선행·상위·별칭 — 셋 다 같은 "검색 리스트"로 통일 (엑셀 필터식)
 *   표시   글자 정렬·비고 표시·크기 강제 — 아이콘 토글
 *   태스크 순서 없는 할 일
 */
import { shortMD, dayIndex, parseDate, inclusiveDays } from '../../core/dates.js';
import { newId, ALIGNS, propagateSame } from '../../core/schema.js';
import { STATUSES, ITEM_TYPES } from '../../config/index.js';
import { $, el, clear, icon, ICONS } from '../dom.js';
import { createFilterList } from '../components/filter-list.js';
import { askConfirm } from '../dialog.js';
import { toast } from '../toast.js';

/** 값이 바로 문서로 반영되는 단순 입력들 (관계·별칭은 별도 리스트가 맡는다) */
const F = {
  title: 'i-title', track: 'i-track', type: 'i-type', start: 'i-start',
  end: 'i-end', span: 'i-span', prog: 'i-prog', org: 'i-org', note: 'i-note',
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
    this.sameList = createFilterList({
      mode: 'multi', placeholder: '동일 카드 검색…', emptyText: '묶을 다른 일정이 없습니다.',
      isSelected: (id) => this.#isSame(id),
      onChange: (id) => this.#toggleSame(id),
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
      this.store.commit('제목 수정', (doc) => {
        item.ti = $(F.title).value;
        propagateSame(doc, item.id);
      });
      autogrow($(F.title));
      this.#renderTitleDrop();
    });
    // 줄바꿈은 Shift+Enter, 그냥 Enter는 편집 종료
    $(F.title).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $(F.title).blur(); }
    });
    // 평상시엔 드롭다운을 숨긴다 — 검색(입력) 중에만 뜬다.
    $(F.title).addEventListener('blur', () => setTimeout(() => { $('i-title-drop').hidden = true; }, 120));

    // 별칭 — 이 보드에서 부를 다른 이름. 본질이 아니라 표시라 같은 카드로 전파하지 않는다.
    $('i-aliasname').addEventListener('input', () => {
      const item = this.item;
      if (!item) return;
      this.store.commit('별칭', () => { item.alias = $('i-aliasname').value.trim() || null; });
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
        if (next) { item.place.hd = Math.max(1, inclusiveDays(item.s, item.e)); }
        else { item.place.hd = null; item.place.x = null; item.place.w = null; }
      });
      $('i-fixedh').setAttribute('aria-pressed', String(next));
    });

    $('i-taskadd').addEventListener('click', () => this.#addTask());
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

    const track = $(F.track);
    clear(track);
    for (const t of this.store.tracks) track.append(el('option', { value: t.id, text: t.name }));

    const org = $(F.org);
    clear(org);
    for (const o of this.store.orgs) org.append(el('option', { value: o, text: o }));

    $(F.title).value = item.ti;
    autogrow($(F.title));
    track.value = item.place.t;
    $(F.type).value = item.ty;
    $(F.start).value = item.s;
    $(F.end).value = item.e;
    $(F.span).value = item.place.sp;
    $(F.span).max = String(Math.max(1, this.store.tracks.length));
    $(F.prog).value = item.pg;
    $(F.org).value = item.og;
    $(F.note).value = item.note ?? '';
    $('i-aliasname').value = item.alias ?? '';
    $('i-title-drop').hidden = true;

    this.#syncStatus(item);
    this.#syncAlign(item);
    $('i-shownote').setAttribute('aria-pressed', String(item.place?.showNote === true));
    $('i-fixedh').setAttribute('aria-pressed', String(item.place?.hd != null));

    this.#renderDeps(item);
    this.#renderParents(item);
    this.#renderSame(item);
    this.#renderTasks(item);

    this.#showTab('attr');
    this.panels.open('pItem');
    this.onChange?.();
  }

  #setStatus(key) {
    const item = this.item;
    if (!item) return;
    this.store.commit('상태 변경', (doc) => { item.st = key; propagateSame(doc, item.id); });
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

  // ── 동일 카드 (same) — 두 카드가 같은 이벤트. 본질을 공유한다 (§3.4) ──

  #isSame(otherId) {
    const id = this.item?.id;
    return this.store.relations.some((r) => r.type === 'same'
      && ((r.from === otherId && r.to === id) || (r.to === otherId && r.from === id)));
  }

  /** 동일 카드 후보 — 자기 뺀 모든 카드(별칭이 있으면 별칭으로 보인다). */
  #renderSame(item) {
    const options = this.store.items
      .filter((x) => x.id !== item.id)
      .map((x) => ({ id: x.id, label: x.alias || x.ti || '(제목 없음)', sub: this.store.track(x.place.t)?.name ?? '' }));
    this.sameList.render(options);
  }

  /** other를 이 카드와 같은 이벤트로 묶거나 푼다. 묶을 땐 other의 본질을 이 카드가 물려받는다. */
  #toggleSame(otherId) {
    const item = this.item;
    if (!item) return;
    const link = (r) => r.type === 'same'
      && ((r.from === otherId && r.to === item.id) || (r.to === otherId && r.from === item.id));
    this.store.commit('동일 카드', (doc) => {
      if (doc.relations.some(link)) {
        doc.relations = doc.relations.filter((r) => !link(r));
      } else {
        doc.relations.push({ id: newId('r'), type: 'same', from: otherId, to: item.id });
        propagateSame(doc, otherId);   // 기존 카드(other)의 본질을 묶인 무리(=이 카드)로 맞춘다
      }
    });
    this.open(item.id);   // 본질이 바뀌었을 수 있어 폼을 다시 채운다
  }

  /** 제목으로 검색하면 뜨는 "같은 카드로 연결" 후보 드롭다운. 평상시엔 숨김. */
  #renderTitleDrop() {
    const drop = $('i-title-drop');
    drop.replaceChildren();
    const item = this.item;
    const q = $(F.title).value.trim().toLowerCase();
    if (!item || !q) { drop.hidden = true; return; }
    const matches = this.store.items
      .filter((x) => x.id !== item.id && !this.#isSame(x.id)
        && (x.alias || x.ti || '').toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { drop.hidden = true; return; }
    for (const m of matches) {
      const row = el('button.title-drop-opt', {
        type: 'button',
        // mousedown(포커스 유지) + preventDefault로 textarea blur 전에 처리
        on: { mousedown: (e) => { e.preventDefault(); this.#confirmLink(m.id); } },
      }, [
        el('span.tdo-name', { text: m.alias || m.ti || '(제목 없음)' }),
        el('em', { text: this.store.track(m.place.t)?.name ?? '' }),
      ]);
      drop.append(row);
    }
    drop.hidden = false;
  }

  async #confirmLink(otherId) {
    const item = this.item;
    if (!item) return;
    $('i-title-drop').hidden = true;
    const other = this.store.item(otherId);
    const name = other?.alias || other?.ti || '(제목 없음)';
    const ok = await askConfirm({
      title: '같은 카드로 연결', confirmLabel: '연결',
      message: `'${name}' 카드와 같은 것으로 연결하시겠습니까? 두 카드가 본질(제목·상태·기간 등)을 공유합니다.`,
    });
    if (ok) this.#toggleSame(otherId);
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
    // 트랙이 상위를 따라 바뀌었으면 속성 탭 선택도 맞춘다
    $(F.track).value = item.place.t;
    $(F.span).value = item.place.sp;
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
            this.store.commit('태스크 완료', () => { t.done = e.target.checked; });
            this.#renderTasks(this.item);
          },
        },
      });
      const text = el('input.task-text', {
        type: 'text', value: t.text, placeholder: '할 일',
        on: { input: (e) => { this.store.commit('태스크 수정', () => { t.text = e.target.value; }); } },
      });
      const rm = el('button.task-del', {
        type: 'button', title: '태스크 삭제',
        on: {
          click: () => {
            this.store.commit('태스크 삭제', () => { item.tasks = item.tasks.filter((x) => x.id !== t.id); });
            this.#renderTasks(this.item);
          },
        },
      }, [icon(ICONS.close)]);
      const row = el('label.task', {}, [cb, text, rm]);
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
    });
    this.#renderTasks(this.item);
    const inputs = $('i-tasks').querySelectorAll('.task-text');
    inputs[inputs.length - 1]?.focus();
  }

  // ── 폼 적용 ─────────────────────────────────────────────

  /** 속성 탭의 단순 입력 → 문서. 관계·별칭은 각 리스트가 직접 반영한다. */
  apply() {
    const item = this.item;
    if (!item) return;

    this.store.commit('일정 편집', (doc) => {
      item.ti = $(F.title).value;
      item.place.t = $(F.track).value;
      item.ty = $(F.type).value;
      item.s = $(F.start).value || item.s;
      item.e = $(F.end).value || item.s;
      if (item.e < item.s) item.e = item.s;

      const ti = this.store.trackIndex(item.place.t);
      const maxSpan = Math.max(1, this.store.tracks.length - ti);
      item.place.sp = Math.min(maxSpan, Math.max(1, Math.round(Number($(F.span).value) || 1)));

      item.pg = Math.min(100, Math.max(0, Math.round(Number($(F.prog).value) || 0)));
      item.og = $(F.org).value;
      item.note = $(F.note).value;
      propagateSame(doc, item.id);   // 같은 이벤트로 묶인 카드들에 본질을 맞춘다
    });

    $(F.end).value = item.e;
    $(F.span).value = item.place.sp;
    $(F.prog).value = item.pg;
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
