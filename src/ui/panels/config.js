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
import { DISPLAY_LIMITS, STATUSES, statusList } from '../../config/index.js';
import { $, el, clear, button, ICONS } from '../dom.js';
import { openCombinePicker, composedOf } from '../combine.js';
import { toast } from '../toast.js';

export class ConfigPanel {
  constructor({ store, view, panels, adapter }) {
    Object.assign(this, { store, view, panels, adapter });
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

    // 순서 축 토글 (초안) — 켜면 날짜가 아니라 선행 순서(rank)로 배치한다.
    $('v-order').addEventListener('change', (e) => {
      this.store.commit('축 모드', (doc) => {
        doc.meta.display.axis = e.target.checked ? 'order' : 'calendar';
      });
    });
  }

  #renderDisplay() {
    const display = this.store.meta.display ?? {};
    for (const [id, key, format] of this._displayFields) {
      $(id).value = display[key];
      $(`${id}-out`).textContent = format(display[key]);
    }
    $('v-order').checked = display.axis === 'order';
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
    this.#renderStatuses();
    this.#renderDisplay();
  }

  // ── 상태 이름 (보드별 표시) ──────────────────────────────

  /** 상태(계획·진행중·완료·지연·보류)를 이 보드에서 부를 이름을 편집. 키·색은 고정. */
  #renderStatuses() {
    const list = $('slist');
    if (!list) return;
    clear(list);
    for (const s of statusList(this.store.doc)) {
      const input = el('input', {
        value: s.label, attrs: { 'aria-label': `${s.key} 상태 이름` },
        on: { input: (e) => this.#setStatusLabel(s.key, e.target.value) },
      });
      list.append(el('div.trow', {}, [
        el('span.st-dot', { className: 'st-dot st-' + s.key }),
        el('div.names', {}, [input]),
      ]));
    }
  }

  #setStatusLabel(key, label) {
    this.store.commit('상태 이름', (doc) => {
      if (!doc.meta.statusLabels) doc.meta.statusLabels = {};
      const def = STATUSES.find((s) => s.key === key)?.label ?? key;
      const v = label.trim();
      if (!v || v === def) delete doc.meta.statusLabels[key];   // 기본과 같으면 재정의 안 남김
      else doc.meta.statusLabels[key] = v;
    });
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

      // 트랙도 이벤트다 — 여러 이벤트로 이 트랙을 이룰 수 있다(조합=구성, docs/SAVE.md §5).
      const combN = composedOf(this.store, track.id).size;
      const row = el('div.trow', { className: track.id === this.view.selectedTrack ? 'trow active' : 'trow' }, [
        el('div.names', {}, [lab, name]),
        button({ className: 'mini' + (combN ? ' on' : ''), iconPath: ICONS.plus, title: combN ? `조합 ${combN}개 — 편집` : '조합 — 여러 이벤트로 이 트랙을 이루기', onClick: () => this.#combine(track.id) }),
        button({ className: 'mini', iconPath: ICONS.up, title: '위로', onClick: () => this.move(i, -1) }),
        button({ className: 'mini', iconPath: ICONS.down, title: '아래로', onClick: () => this.move(i, +1) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.remove(i) }),
      ]);
      list.append(row);
    });
  }

  /** 이 트랙(=이벤트)을 이루는 조합 대상을 고른다(구성). 보드에 카드로 안 그린다. */
  async #combine(trackId) {
    const changed = await openCombinePicker(this.store, this.adapter, trackId);
    if (changed) this.#renderTracks();
  }

  move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.store.tracks.length) return;
    this.store.commit('트랙 순서', (doc) => {
      const [t] = doc.tracks.splice(index, 1);
      doc.tracks.splice(to, 0, t);
      // 순서가 바뀌면 병합 폭이 보드 밖으로 나갈 수 있다
      doc.items.forEach((it) => {
        const ti = doc.tracks.findIndex((x) => x.id === it.place.t);
        it.place.sp = Math.min(it.place.sp, doc.tracks.length - ti);
      });
    });
    this.render();
  }

  /**
   * 트랙을 보드에서 뺀다. 이 트랙에만 놓인 카드(와 그 안의 하위 카드)는 함께 빠지고, 다른 트랙에도
   * 소속된 카드는 남는다 — 소속에서 이 트랙만 지운다. 빠진 트랙·카드는 이벤트로 남아 휴지통(첫 화면)에
   * 구조째 간다(docs/SAVE.md §7). 방금 만든 것이면 바로 없어진다.
   */
  remove(index) {
    const track = this.store.tracks[index];
    if (this.store.tracks.length === 1) { toast('마지막 트랙은 삭제할 수 없습니다', 'warn'); return; }

    const membersOf = (it) => (Array.isArray(it.place.tracks) && it.place.tracks.length ? it.place.tracks : [it.place.t]);
    const only = this.store.items.filter((x) => !x.parent && membersOf(x).every((t) => t === track.id));
    const gone = new Set(only.map((x) => x.id));
    const walk = (pid) => { for (const x of this.store.items) if (x.parent === pid && !gone.has(x.id)) { gone.add(x.id); walk(x.id); } };
    for (const x of only) walk(x.id);
    const count = gone.size;
    const msg = count
      ? `'${track.name}' 트랙을 보드에서 뺍니다. 이 트랙에만 있던 일정 ${count}건도 함께 빠집니다(휴지통에서 영구 삭제). 계속할까요?`
      : `'${track.name}' 트랙을 보드에서 뺍니다. 계속할까요?`;
    if (!confirm(msg)) return;

    this.store.commit('트랙 빼기', (doc) => {
      doc.items = doc.items.filter((x) => !gone.has(x.id));
      doc.relations = (doc.relations ?? []).filter((r) => !gone.has(r.from) && !gone.has(r.to));
      doc.compose = (doc.compose ?? []).filter((c) => c.parent !== track.id && !gone.has(c.parent));
      doc.tracks.splice(index, 1);
      const order = new Map(doc.tracks.map((t, i) => [t.id, i]));
      const byId = new Map(doc.items.map((x) => [x.id, x]));
      // 다른 트랙에도 소속된 카드 — 이 트랙만 소속에서 지우고, 홈이 빠졌으면 남은 첫 트랙이 홈이다.
      for (const it of doc.items) {
        if (it.parent) continue;
        const left = membersOf(it).filter((t) => order.has(t)).sort((a, b) => order.get(a) - order.get(b));
        it.place.tracks = left;
        it.place.t = left[0];
        let run = 1;
        for (let k = 1; k < left.length; k += 1) { if (order.get(left[k]) === order.get(left[k - 1]) + 1) run += 1; else break; }
        it.place.sp = run;
      }
      // 하위 카드는 상위의 트랙을 따른다
      const homeOf = (it, guard = 0) => (it.parent && byId.has(it.parent) && guard < 64 ? homeOf(byId.get(it.parent), guard + 1) : it.place.t);
      for (const it of doc.items) if (it.parent) it.place.t = homeOf(it);
    });
    this.view.selectedTrack = null;
    this.render();
    toast(count ? `트랙과 일정 ${count}건을 보드에서 뺐습니다 — Ctrl+Z로 되돌립니다` : '트랙을 보드에서 뺐습니다');
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
