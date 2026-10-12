/**
 * 공유(호스팅) 화면 — 호스트 창과 참가자 브라우저가 같이 쓴다 (docs/SHARE.md §4·§6).
 *
 *   위쪽 막대    연결 상태 · 보드 이름 · 참가자 · (참가자) 내 이름 · (호스트) 주소 복사 · 참가자 권한·내보내기 · 이력 · 멈춤
 *   이름 표식    다른 사람이 고른 카드 위에 이름 — 색은 상태를 뜻하므로 사람마다 색을 주지 않는다(규약 4·7)
 *
 * 호스팅 사본은 이벤트가 아니고 시스템에도 없다 — 이 화면은 사본만 고친다. 거두기는 호스트 PC의 첫 화면에서.
 */
import { $, el, clear } from './dom.js';
import { toast } from './toast.js';
import { askText, askConfirm, openSheet } from './dialog.js';

const NAME_KEY = 'wolfpack:guest-name';
const CID_KEY = 'wolfpack:guest-cid';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 이번에만 */ } },
};

/**
 * 참가자 — 묻지 않고 들어온다(입장 제약 없음, 2026-10-12 사용자). 이름은 호스트가 '참가자 N'으로 붙이고, 막대의 '내 이름'에서 바꾼다.
 * 바꾼 이름과 참가자 번호(cid)는 이 브라우저에 기억해 다시 들어오면 그대로.
 */
export async function joinAsGuest(adapter) {
  const h = await adapter.join(store.get(NAME_KEY) ?? '', store.get(CID_KEY));
  store.set(CID_KEY, h.cid);
  return h.name;
}

export class SessionUi {
  /**
   * @param {object} o
   * @param {import('../core/storage.js').HostedAdapter} o.adapter
   * @param {import('./board/index.js').Board} o.board
   */
  constructor({ adapter, board, view, onRole }) {
    Object.assign(this, { adapter, board, view, onRole });
    this.bar = $('sessionBar');
    this.bar.hidden = false;
    this.status = 'online';
    this.layer = el('div.presence-layer', { attrs: { 'aria-hidden': 'true' } });
    this.api = window.roadmapDB?.hosting ?? null;      // 호스트 창만
    this.id = adapter.t?.id ?? null;
  }

  get host() { return this.adapter.host; }

  setStatus(s, reason) {
    this.status = s;
    if (s === 'kicked') toast('호스트가 내보냈습니다', 'warn');
    if (s === 'closed') toast('호스트가 호스팅을 멈췄습니다 — 지금 화면은 더 이상 저장되지 않습니다', 'warn');
    this.render();
  }

  render() {
    const a = this.adapter;
    const others = (a.people ?? []).filter((p) => p.cid !== a.cid);
    const stateText = a.closed ? (this.status === 'kicked' ? '나가짐' : '호스팅 끝남')
      : this.status === 'online' ? (this.host ? '호스팅 중' : '연결됨') : this.status === 'offline' ? '다시 연결하는 중…' : '연결 끊김';
    const ok = !a.closed && this.status === 'online';
    clear(this.bar);
    const parts = [
      el('span.sess-dot', { className: ok ? 'sess-dot on' : 'sess-dot' }),
      el('b.sess-state', { text: stateText }),
      el('span.sess-name', { text: a.hostInfo?.name || '' }),
      el('span.muted', { text: this.host ? `포트 ${a.hostInfo?.port ?? ''} · 원래 보드와 따로 운영되는 사본입니다` : '호스트 PC의 사본을 함께 고치는 중' }),
      el('div.grow'),
      a.role === 'view' && !a.closed ? el('span.sess-chip', { text: '보기 전용' }) : null,
      !this.host ? el('button.btn.sm.outline', { type: 'button', text: `내 이름: ${a.me || '참가자'}`, title: '다른 사람에게 보이는 이름 바꾸기', on: { click: () => this.#rename() } }) : null,
      el('button.btn.sm.outline', {
        type: 'button', text: `참가자 ${others.length}`, title: '함께 보는 사람',
        on: { click: () => this.#people() },
      }),
      this.host ? el('button.btn.sm.outline', { type: 'button', text: '주소 복사', title: '사내망 주소 — 크롬 등 브라우저로 이 주소를 열면 바로 들어옵니다', on: { click: () => this.#copyLink() } }) : null,
      this.host ? el('button.btn.sm.outline', { type: 'button', text: '이력', on: { click: () => this.#history() } }) : null,
      this.host && !a.closed ? el('button.btn.sm.outline', { type: 'button', text: '호스팅 멈춤', title: '참가자 연결을 닫습니다. 사본과 이력은 남고, 첫 화면에서 다시 열거나 거둘 수 있습니다', on: { click: () => this.#pause() } }) : null,
    ];
    this.bar.append(...parts.filter(Boolean));
    document.title = `${a.hostInfo?.name || 'WOLFPACK'} · ${this.host ? '호스팅' : '공유'}`;
  }

  async #copyLink() {
    const urls = this.adapter.hostInfo?.urls ?? [];
    if (!urls.length) { toast('사내망 주소를 찾지 못했습니다 — 네트워크 연결을 확인하세요', 'warn'); return; }
    const url = urls[0];
    try { await navigator.clipboard.writeText(url); toast(`복사했습니다 — ${url}`); }
    catch { await askText({ title: '주소', label: '아래 주소를 복사해 보내세요 — 크롬 등 브라우저로 열면 바로 들어옵니다', value: url, confirmLabel: '닫기' }); }
  }

  async #people() {
    const a = this.adapter;
    const list = el('div.sess-people');
    const paint = () => {
      clear(list);
      for (const p of a.people ?? []) {
        const me = p.cid === a.cid;
        list.append(el('div.sess-person', {}, [
          el('span', { text: `${p.name}${me ? ' (나)' : ''}${p.host ? ' · 호스트' : ''}` }),
          el('em.muted', { text: p.role === 'view' ? '보기 전용' : '편집' }),
          this.host && !p.host ? el('button.btn.sm.outline', {
            type: 'button', text: p.role === 'view' ? '편집 허용' : '보기 전용으로',
            on: { click: async () => { await this.api.role(this.id, p.cid, p.role === 'view' ? 'edit' : 'view'); setTimeout(paint, 100); } },
          }) : null,
          this.host && !p.host ? el('button.btn.sm.danger', {
            type: 'button', text: '내보내기',
            on: { click: async () => { if (await askConfirm({ title: '내보내기', message: `${p.name}의 연결을 끊습니다. 이 호스팅이 열려 있는 동안 그 PC에서는 다시 들어오지 못합니다.`, confirmLabel: '내보내기', danger: true })) { await this.api.kick(this.id, p.cid); } } },
          }) : null,
        ]));
      }
    };
    paint();
    await openSheet({ title: '참가자', content: list, actions: [{ key: 'close', label: '닫기', cta: true }] });
  }

  /** 참가자 — 다른 사람에게 보이는 이름 바꾸기(이 브라우저에 기억) */
  async #rename() {
    const name = await askText({ title: '내 이름', label: '다른 사람에게 이렇게 보입니다', value: this.adapter.me ?? '', confirmLabel: '바꾸기' });
    if (!name || !name.trim()) return;
    store.set(NAME_KEY, name.trim());
    await this.adapter.join(name.trim(), this.adapter.cid);
    this.render();
  }

  async #history() {
    const rows = await this.api.history(this.id);
    const list = el('div.sess-history');
    if (!rows.length) list.append(el('div.empty', { text: '아직 바뀐 것이 없습니다.' }));
    for (const r of rows) {
      list.append(el('div.sess-hrow', {}, [
        el('em.muted', { text: `#${r.seq} · ${r.at}` }),
        el('b', { text: r.author }),
        el('span', { text: r.summary || `변경 ${r.n}개` }),
      ]));
    }
    await openSheet({ title: '호스팅 이력', message: '누가·언제·무엇을 — 최근 것부터', content: list, wide: true });
  }

  async #pause() {
    const ok = await askConfirm({ title: '호스팅 멈춤', message: '참가자 연결을 닫습니다. 사본과 이력은 이 PC에 남고, 첫 화면의 호스팅 목록에서 다시 열거나 거둘 수 있습니다.', confirmLabel: '멈춤' });
    if (ok) await this.api.pause(this.id);
  }

  /** 다른 사람이 고른 카드 위에 이름 — 보드를 다시 그린 뒤와 참가자 정보가 바뀔 때 */
  drawPresence() {
    const grid = this.board.grid;
    if (this.layer.parentNode !== grid) grid.append(this.layer);
    clear(this.layer);
    const others = (this.adapter.people ?? []).filter((p) => p.cid !== this.adapter.cid && p.sel);
    const bySel = new Map();
    for (const p of others) { if (!bySel.has(p.sel)) bySel.set(p.sel, []); bySel.get(p.sel).push(p.name); }
    for (const n of grid.querySelectorAll('.ev.peer-sel')) n.classList.remove('peer-sel');
    const z = this.board.zoom || 1;
    const g = grid.getBoundingClientRect();
    for (const [id, names] of bySel) {
      const card = grid.querySelector(`.ev[data-id="${CSS.escape(id)}"]`);
      if (!card) continue;
      const r = card.getBoundingClientRect();
      const tag = el('div.presence-tag', { text: names.join(', '), title: `${names.join(', ')} — 이 카드를 보고 있습니다` });
      tag.style.left = `${(r.left - g.left) / z}px`;
      tag.style.top = `${(r.top - g.top) / z}px`;
      this.layer.append(tag);
      card.classList.add('peer-sel');
    }
  }
}
