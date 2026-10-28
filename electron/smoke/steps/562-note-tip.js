// 스모크 단계 'note-tip' — 비고가 있는 카드에 커서를 올리면 카드 옆에 이름·날짜·주체와 그 밑에 비고(마크다운)가 뜬다(2026-10-15·10-28 사용자).
//   비고 없음 → 안 뜸 · 카드에 비고가 다 보이면 안 뜸 · 상위 일정은 제목 바에서만 · 휠·누르기면 닫힘 · 화면 안 · 문서는 그대로
export default {
  name: 'note-tip',
  areas: ['notetip', 'board'],
  requires: ['nesting'],   // 상위 일정 안쪽 빈 곳에서는 안 뜬다
  async run({ target, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const tip = () => document.querySelector('.note-tip');
        const shown = () => !!tip() && !tip().hidden;
        const card = (id) => document.querySelector('.col .ev[data-id="' + id + '"]');
        const over = (node) => node.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        const hover = async (node) => { r.board.noteTip.hide(); over(node); await sleep(650); return shown(); };
        const o = {};
        const plain = r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
        const [a, b] = plain;
        const keep = { a: { note: a.note, show: a.place.showNote }, b: { note: b.note, show: b.place.showNote } };
        r.store.commit('스모크 비고', () => { a.note = '**굵은 글** 비고\\n- 하나\\n- 둘'; a.place.showNote = false; b.note = ''; b.place.showNote = false; });
        await sleep(200);
        o.rev0 = r.store.rev;
        card(a.id).scrollIntoView({ block: 'center', inline: 'center' }); await sleep(150);
        o.shown = await hover(card(a.id).querySelector(':scope > .t'));
        o.markdown = !!tip()?.querySelector('.note-tip-body strong') && tip().querySelectorAll('.note-tip-body li').length === 2
          && tip().querySelector('.note-tip-title').textContent === (a.alias || a.ti);
        // 머리에 이름 밑으로 날짜·주체(카드 기본 툴팁과 같은 글), 띄운 동안 카드의 기본 툴팁은 비운다(겹쳐 뜨지 않게)
        o.head = tip().querySelectorAll('.note-tip-head .note-tip-meta').length >= 1 && card(a.id).title === '';
        const t = tip().getBoundingClientRect(); const c = card(a.id).getBoundingClientRect();
        o.inView = t.left >= 0 && t.top >= 0 && t.right <= document.documentElement.clientWidth && t.bottom <= document.documentElement.clientHeight;
        o.beside = t.left >= c.right || t.right <= c.left || t.top >= c.bottom || t.bottom <= c.top;
        o.noPointer = getComputedStyle(tip()).pointerEvents === 'none';
        card(a.id).dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }));
        o.closedOnDown = !shown();
        o.titleBack = card(a.id).title.startsWith(a.alias || a.ti);
        // 비고 없는 카드 — 안 뜬다
        o.emptyNone = !(await hover(card(b.id)));
        // 카드 위에 짧은 비고가 다 보이면 — 안 뜬다
        r.store.commit('스모크 비고 표시', () => { b.note = '짧은 비고'; b.place.showNote = true; b.hd = null; });
        await sleep(200);
        const bn = card(b.id).querySelector(':scope > .card-note');
        o.onCardNone = bn && !bn.hidden ? !(await hover(card(b.id))) : 'skip';
        // 상위 일정 — 안쪽 빈 곳에선 안 뜨고 제목 바에서는 뜬다
        const kid = r.store.items.find((x) => x.parent);
        const par = r.store.item(kid.parent);
        const parKeep = par.note;
        r.store.commit('스모크 상위 비고', () => { par.note = '상위 비고'; });
        await sleep(200);
        const pn = card(par.id);
        pn.scrollIntoView({ block: 'center' }); await sleep(150);
        o.containerBody = !(await hover(pn));
        o.containerTitle = await hover(pn.querySelector(':scope > .t'));
        r.board.noteTip.hide();
        o.docSame = r.store.rev === o.rev0 + 2;
        r.store.commit('스모크 비고 원복', () => {
          a.note = keep.a.note; a.place.showNote = keep.a.show; b.note = keep.b.note; b.place.showNote = keep.b.show; par.note = parKeep;
        });
        await r.store.flush();
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] note-tip ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.shown === true && o?.markdown === true && o?.inView === true && o?.beside === true && o?.noPointer === true
    && o?.closedOnDown === true && o?.emptyNone === true && (o?.onCardNone === true || o?.onCardNone === 'skip')
    && o?.containerBody === true && o?.containerTitle === true && o?.head === true && o?.titleBack === true,
};
