/**
 * 일정 편집 패널.
 * 제목·상태·트랙·유형·기간·병합폭·진척률·담당·선행일정·비고 (기획안 §5).
 */
import { shortMD, dayIndex, parseDate, inclusiveDays } from '../../core/dates.js';
import { newId, ALIGNS } from '../../core/schema.js';
import { STATUSES, ITEM_TYPES } from '../../config/index.js';
import { $, el, clear } from '../dom.js';
import { toast } from '../toast.js';

const F = {
  title: 'i-title', track: 'i-track', type: 'i-type', start: 'i-start',
  end: 'i-end', span: 'i-span', prog: 'i-prog', org: 'i-org', note: 'i-note',
  parent: 'i-parent',
};

const ALIGN_LABELS = { top: '위', middle: '가운데', bottom: '아래' };

/** 여러 줄 제목 입력이 내용에 맞게 높이를 늘리도록 */
function autogrow(node) {
  node.style.height = 'auto';
  node.style.height = node.scrollHeight + 'px';
}

export class ItemPanel {
  constructor({ store, view, panels, onChange }) {
    Object.assign(this, { store, view, panels, onChange });
    this.#buildStatic();
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

    const align = $('i-align');
    clear(align);
    for (const key of ALIGNS) {
      align.append(el('button', {
        type: 'button', dataset: { align: key }, text: ALIGN_LABELS[key],
        on: { click: () => this.#setAlign(key) },
      }));
    }
  }

  #bind() {
    for (const id of Object.values(F)) {
      $(id).addEventListener('change', () => this.apply());
    }
    // 제목은 입력 즉시 카드에 반영 (기획안 §5 즉시 반영)
    $(F.title).addEventListener('input', () => {
      const item = this.item;
      if (!item) return;
      this.store.commit('제목 수정', () => { item.ti = $(F.title).value; });
      autogrow($(F.title));
    });
    // 제목은 여러 줄을 담는다. 줄바꿈은 Shift+Enter, 그냥 Enter는 편집 종료(줄바꿈 X).
    $(F.title).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $(F.title).blur();
      }
    });

    $('i-shownote').addEventListener('change', (e) => {
      const item = this.item;
      if (!item) return;
      this.store.commit('비고 표시', () => { item.place.showNote = e.target.checked; });
    });
    // 크기 강제 — 켜면 현재 기간 길이(일)로 시작하고 가로·세로를 드래그로 조절한다.
    // 끄면 강제 높이(hd)와 강제 폭(x/w)을 모두 비워 원래(자동) 크기로 돌아온다.
    $('i-fixedh').addEventListener('change', (e) => {
      const item = this.item;
      if (!item) return;
      this.store.commit('크기 강제', () => {
        if (e.target.checked) {
          item.place.hd = Math.max(1, inclusiveDays(item.s, item.e));
        } else {
          item.place.hd = null;
          item.place.x = null;
          item.place.w = null;
        }
      });
    });
    $('i-del').addEventListener('click', () => this.remove());
    $('i-dup').addEventListener('click', () => this.duplicate());
  }

  open(id) {
    this.view.selectedItem = id;
    this.view.selectedTrack = null;
    const item = this.item;
    if (!item) return;

    const track = $(F.track);
    clear(track);
    for (const t of this.store.tracks) track.append(el('option', { value: t.id, text: t.name }));

    // 조직 목록은 문서가 들고 있고 런타임에 바뀐다 — 열 때마다 다시 만든다
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

    this.#renderParents(item);
    this.#syncStatus(item);
    this.#syncAlign(item);
    $('i-shownote').checked = item.place?.showNote === true;
    $('i-fixedh').checked = item.place?.hd != null;
    this.#renderDeps(item);
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
    for (const b of $('i-align').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.align === item.place?.align));
    }
  }

  /**
   * 상위 일정 후보 — 같은 트랙에서 이 일정을 기간 안에 품을 수 있고,
   * 자기 자신이나 자기 자손이 아닌 것.
   */
  #renderParents(item) {
    const select = $(F.parent);
    clear(select);
    select.append(el('option', { value: '', text: '— 없음 (트랙에 직접) —' }));

    const descendants = this.#descendantsOf(item.id);
    for (const other of this.store.items) {
      if (other.id === item.id || descendants.has(other.id)) continue;
      if (other.ty === 'ms') continue;                 // 마일스톤은 품을 수 없다
      if (other.place.t !== item.place.t && !item.parent) continue; // 다른 트랙은 후보에서 뺀다
      const track = this.store.track(other.t)?.name ?? '';
      select.append(el('option', { value: other.id, text: `${other.ti} · ${track}` }));
    }
    select.value = item.parent ?? '';
  }

  #descendantsOf(id) {
    const out = new Set();
    const walk = (parentId) => {
      for (const child of this.store.items) {
        if (child.parent === parentId && !out.has(child.id)) {
          out.add(child.id);
          walk(child.id);
        }
      }
    };
    walk(id);
    return out;
  }

  #syncStatus(item) {
    for (const b of $('i-status').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.st === item.st));
    }
  }

  #renderDeps(item) {
    const box = $('i-deps');
    clear(box);
    const order = (tid) => this.store.trackIndex(tid);
    const origin = parseDate(this.store.meta.start);
    const others = this.store.items
      .filter((x) => x.id !== item.id)
      .sort((a, b) => order(a.place.t) - order(b.place.t) || dayIndex(a.s, origin) - dayIndex(b.s, origin));

    if (!others.length) {
      box.append(el('div.empty', { text: '선택할 다른 일정이 없습니다.' }));
      return;
    }

    for (const other of others) {
      const trackName = this.store.track(other.t)?.name ?? '';
      const cb = el('input', {
        type: 'checkbox',
        checked: item.dp.includes(other.id),
        on: {
          change: (e) => {
            this.store.commit('선행 일정 변경', () => {
              item.dp = e.target.checked
                ? [...new Set([...item.dp, other.id])]
                : item.dp.filter((d) => d !== other.id);
            });
          },
        },
      });
      box.append(el('label', {}, [
        cb,
        el('span', {}, [
          document.createTextNode(other.ti || '(제목 없음)'),
          el('em', { text: `${trackName} · ${shortMD(other.s)}` }),
        ]),
      ]));
    }
  }

  /** 폼 → 문서. 종료일 inclusive, 마일스톤도 기간 허용, 병합폭 트랙 경계 (D-3) */
  apply() {
    const item = this.item;
    if (!item) return;

    this.store.commit('일정 편집', () => {
      item.ti = $(F.title).value;
      item.place.t = $(F.track).value;
      item.ty = $(F.type).value;
      item.s = $(F.start).value || item.s;
      item.e = $(F.end).value || item.s;
      if (item.e < item.s) item.e = item.s;
      // 마일스톤도 기간을 가질 수 있다 — 종료일을 강제로 시작일에 맞추지 않는다.

      const ti = this.store.trackIndex(item.place.t);
      const maxSpan = Math.max(1, this.store.tracks.length - ti);
      item.place.sp = Math.min(maxSpan, Math.max(1, Math.round(Number($(F.span).value) || 1)));

      item.pg = Math.min(100, Math.max(0, Math.round(Number($(F.prog).value) || 0)));
      item.og = $(F.org).value;
      item.note = $(F.note).value;

      const parent = $(F.parent).value || null;
      if (parent !== item.parent) {
        item.parent = parent;
        // 담기면 트랙과 가로 배치를 상위에 맞춘다
        if (parent) {
          const host = this.store.item(parent);
          if (host) { item.place.t = host.place.t; item.place.sp = 1; }
        }
        item.place.x = null;
        item.place.w = null;
      }
    });

    // 정규화 결과를 폼에 되돌려 보여 준다
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
      for (const x of doc.items) x.dp = x.dp.filter((d) => d !== item.id);
    });
    this.panels.close();
    toast(`'${title}'을(를) 삭제했습니다`);
  }

  duplicate() {
    const item = this.item;
    if (!item) return;
    const copy = { ...structuredClone(item), id: newId('e'), ti: item.ti + ' (복사)' };
    this.store.commit('일정 복제', (doc) => { doc.items.push(copy); });
    this.open(copy.id);
  }
}
