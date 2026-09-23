/**
 * 보드 구성 패널 — 트랙과 담당 조직.
 *
 * 트랙 축에는 시스템이 의미를 강제하지 않는다. 요구사항으로 쓰든 작업패키지로
 * 쓰든 조직으로 쓰든 사용자가 정한다. `lab`은 그저 위에 작게 붙는 자유 라벨이다.
 *
 * 담당 조직은 일정의 `og`에 **문자열 값**으로 들어간다 (트랙처럼 id 참조가 아니다).
 * 반출한 JSON을 사람이 읽을 수 있게 하려는 선택이라, 이름을 바꿀 때는
 * 그 조직을 쓰는 일정을 함께 갱신해야 한다. #renameOrg가 그 일을 한다.
 */
import { newId } from '../../core/schema.js';
import { DISPLAY_LIMITS } from '../../config/index.js';
import { $, el, clear, button, ICONS } from '../dom.js';
import { toast } from '../toast.js';

export class ConfigPanel {
  constructor({ store, view, panels }) {
    Object.assign(this, { store, view, panels });
    $('t-add').addEventListener('click', () => this.add());
    $('o-add').addEventListener('click', () => this.#addOrg());
    $('o-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.#addOrg(); });
    this.#bindDisplay();
  }

  // ── 표시 설정 ───────────────────────────────────────────

  #bindDisplay() {
    const fields = [
      ['v-arrow', 'arrowWidth', (v) => `${v}px`],
      ['v-head', 'arrowHead', (v) => `×${Number(v).toFixed(1)}`],
      ['v-bite', 'arrowBite', (v) => `${v}px`],
      ['v-font', 'fontScale', (v) => `${Math.round(v * 100)}%`],
    ];
    for (const [id, key, format] of fields) {
      const input = $(id);
      const lim = DISPLAY_LIMITS[key];
      input.min = lim.min; input.max = lim.max; input.step = lim.step;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        $(`${id}-out`).textContent = format(value);
        this.store.commit('표시 설정', (doc) => { doc.meta.display[key] = value; });
      });
    }
    this._displayFields = fields;
  }

  #renderDisplay() {
    const display = this.store.meta.display ?? {};
    for (const [id, key, format] of this._displayFields) {
      $(id).value = display[key];
      $(`${id}-out`).textContent = format(display[key]);
    }
  }

  open(trackId = null) {
    this.view.selectedTrack = trackId;
    this.view.selectedItem = null;
    this.render();
    this.panels.open('pTrack');
  }

  render() {
    this.#renderTracks();
    this.#renderOrgs();
    this.#renderDisplay();
  }

  // ── 트랙 ────────────────────────────────────────────────

  #renderTracks() {
    const list = $('tlist');
    clear(list);

    this.store.tracks.forEach((track, i) => {
      const name = el('input', {
        value: track.name, attrs: { 'aria-label': '트랙 이름' },
        on: { input: (e) => this.store.commit('트랙 이름', () => { track.name = e.target.value; }) },
      });
      const lab = el('input.lab', {
        value: track.lab ?? '', attrs: { 'aria-label': '분류 라벨', placeholder: '분류 (예: 요구사항 4)' },
        on: { input: (e) => this.store.commit('트랙 라벨', () => { track.lab = e.target.value; }) },
      });

      const row = el('div.trow', { className: track.id === this.view.selectedTrack ? 'trow active' : 'trow' }, [
        el('div.names', {}, [lab, name]),
        button({ className: 'mini', iconPath: ICONS.up, title: '위로', onClick: () => this.move(i, -1) }),
        button({ className: 'mini', iconPath: ICONS.down, title: '아래로', onClick: () => this.move(i, +1) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.remove(i) }),
      ]);
      list.append(row);
    });
  }

  move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.store.tracks.length) return;
    this.store.commit('트랙 순서', (doc) => {
      const [t] = doc.tracks.splice(index, 1);
      doc.tracks.splice(to, 0, t);
      // 순서가 바뀌면 병합 폭이 보드 밖으로 나갈 수 있다
      doc.items.forEach((it) => {
        const ti = doc.tracks.findIndex((x) => x.id === it.t);
        it.sp = Math.min(it.sp, doc.tracks.length - ti);
      });
    });
    this.render();
  }

  remove(index) {
    const track = this.store.tracks[index];
    if (this.store.tracks.length === 1) { toast('마지막 트랙은 삭제할 수 없습니다', 'warn'); return; }

    const count = this.store.items.filter((x) => x.t === track.id).length;
    const msg = count
      ? `'${track.name}' 트랙과 일정 ${count}건을 삭제합니다. 계속할까요?`
      : `'${track.name}' 트랙을 삭제합니다. 계속할까요?`;
    if (!confirm(msg)) return;

    this.store.commit('트랙 삭제', (doc) => {
      const removed = new Set(doc.items.filter((x) => x.t === track.id).map((x) => x.id));
      doc.items = doc.items.filter((x) => x.t !== track.id);
      for (const x of doc.items) x.dp = x.dp.filter((d) => !removed.has(d));
      doc.tracks.splice(index, 1);
      doc.items.forEach((it) => {
        const ti = doc.tracks.findIndex((x) => x.id === it.t);
        it.sp = Math.min(it.sp, doc.tracks.length - ti);
      });
    });
    this.view.selectedTrack = null;
    this.render();
    toast(count ? `트랙과 일정 ${count}건을 삭제했습니다` : '트랙을 삭제했습니다');
  }

  add() {
    const track = { id: newId('t'), lab: '', name: `새 트랙 ${this.store.tracks.length + 1}` };
    this.store.commit('트랙 추가', (doc) => { doc.tracks.push(track); });
    this.view.selectedTrack = track.id;
    this.render();
    this.panels.open('pTrack');
  }

  // ── 담당 조직 ───────────────────────────────────────────

  #renderOrgs() {
    const list = $('olist');
    clear(list);

    const counts = new Map();
    for (const it of this.store.items) counts.set(it.og, (counts.get(it.og) ?? 0) + 1);

    this.store.orgs.forEach((org, i) => {
      const input = el('input', {
        value: org,
        attrs: { 'aria-label': '조직 이름' },
        // 이름 변경은 일정 참조를 함께 고쳐야 해서 blur(change) 시점에 한 번만 처리한다
        on: { change: (e) => this.#renameOrg(i, e.target.value, e.target) },
      });

      list.append(el('div.trow', {}, [
        el('div.names', {}, [input]),
        el('span', {
          text: String(counts.get(org) ?? 0),
          style: { fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '16px', textAlign: 'right' },
          title: '이 조직이 담당한 일정 수',
        }),
        button({ className: 'mini', iconPath: ICONS.up, title: '위로', onClick: () => this.#moveOrg(i, -1) }),
        button({ className: 'mini', iconPath: ICONS.down, title: '아래로', onClick: () => this.#moveOrg(i, +1) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.#removeOrg(i) }),
      ]));
    });
  }

  /** 조직명 변경 + 그 조직을 쓰는 일정의 og 일괄 갱신 */
  #renameOrg(index, raw, input) {
    const next = raw.trim();
    const prev = this.store.orgs[index];
    if (!next) { input.value = prev; toast('조직 이름은 비울 수 없습니다', 'warn'); return; }
    if (next === prev) return;
    if (this.store.orgs.some((o, i) => i !== index && o === next)) {
      input.value = prev;
      toast(`'${next}'은(는) 이미 있습니다`, 'warn');
      return;
    }

    let moved = 0;
    this.store.commit('조직 이름', (doc) => {
      doc.orgs[index] = next;
      for (const it of doc.items) if (it.og === prev) { it.og = next; moved++; }
    });
    this.#renderOrgs();
    if (moved) toast(`일정 ${moved}건의 담당을 함께 바꿨습니다`);
  }

  #moveOrg(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.store.orgs.length) return;
    this.store.commit('조직 순서', (doc) => {
      const [o] = doc.orgs.splice(index, 1);
      doc.orgs.splice(to, 0, o);
    });
    this.#renderOrgs();
  }

  #removeOrg(index) {
    if (this.store.orgs.length === 1) { toast('마지막 조직은 삭제할 수 없습니다', 'warn'); return; }

    const org = this.store.orgs[index];
    const using = this.store.items.filter((i) => i.og === org);
    const fallback = this.store.orgs[index === 0 ? 1 : 0];

    const message = using.length
      ? `'${org}'을(를) 삭제합니다. 이 조직이 담당한 일정 ${using.length}건은 '${fallback}'으로 옮겨집니다. 계속할까요?`
      : `'${org}'을(를) 삭제합니다. 계속할까요?`;
    if (!confirm(message)) return;

    this.store.commit('조직 삭제', (doc) => {
      doc.orgs.splice(index, 1);
      for (const it of doc.items) if (it.og === org) it.og = fallback;
    });
    this.view.orgFilter.delete(org);
    this.#renderOrgs();
    toast(using.length ? `일정 ${using.length}건을 '${fallback}'으로 옮겼습니다` : '조직을 삭제했습니다');
  }

  #addOrg() {
    const input = $('o-new');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (this.store.orgs.includes(name)) { toast(`'${name}'은(는) 이미 있습니다`, 'warn'); return; }

    this.store.commit('조직 추가', (doc) => { doc.orgs.push(name); });
    input.value = '';
    this.#renderOrgs();
    input.focus();
  }
}
