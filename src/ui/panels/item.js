/**
 * 일정 편집 패널.
 * 제목·상태·트랙·유형·기간·병합폭·진척률·담당·선행일정·비고 (기획안 §5).
 */
import { shortMD, dayIndex, parseDate } from '../../core/dates.js';
import { newId } from '../../core/schema.js';
import { STATUSES, ITEM_TYPES } from '../../config/index.js';
import { $, el, clear } from '../dom.js';
import { toast } from '../toast.js';

const F = {
  title: 'i-title', track: 'i-track', type: 'i-type', start: 'i-start',
  end: 'i-end', span: 'i-span', prog: 'i-prog', org: 'i-org', note: 'i-note',
};

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
    track.value = item.t;
    $(F.type).value = item.ty;
    $(F.start).value = item.s;
    $(F.end).value = item.e;
    $(F.span).value = item.sp;
    $(F.span).max = String(Math.max(1, this.store.tracks.length));
    $(F.prog).value = item.pg;
    $(F.org).value = item.og;
    $(F.note).value = item.note ?? '';

    this.#syncStatus(item);
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
      .sort((a, b) => order(a.t) - order(b.t) || dayIndex(a.s, origin) - dayIndex(b.s, origin));

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
      const label = el('label', {}, [
        cb,
        el('span', { text: other.ti }, [el('em', { text: `${trackName} · ${shortMD(other.s)}` })]),
      ]);
      box.append(label);
    }
  }

  /** 폼 → 문서. 종료일 inclusive, 마일스톤 단일 일자, 병합폭 트랙 경계 (D-3) */
  apply() {
    const item = this.item;
    if (!item) return;

    this.store.commit('일정 편집', () => {
      item.ti = $(F.title).value;
      item.t = $(F.track).value;
      item.ty = $(F.type).value;
      item.s = $(F.start).value || item.s;
      item.e = $(F.end).value || item.s;
      if (item.e < item.s) item.e = item.s;
      if (item.ty === 'ms') item.e = item.s;

      const ti = this.store.trackIndex(item.t);
      const maxSpan = Math.max(1, this.store.tracks.length - ti);
      item.sp = Math.min(maxSpan, Math.max(1, Math.round(Number($(F.span).value) || 1)));

      item.pg = Math.min(100, Math.max(0, Math.round(Number($(F.prog).value) || 0)));
      item.og = $(F.org).value;
      item.note = $(F.note).value;
    });

    // 정규화 결과를 폼에 되돌려 보여 준다
    $(F.end).value = item.e;
    $(F.span).value = item.sp;
    $(F.prog).value = item.pg;
  }

  remove() {
    const item = this.item;
    if (!item) return;
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
