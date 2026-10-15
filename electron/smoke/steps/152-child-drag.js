// 스모크 단계 'child-drag' — 하위 카드(모자관계)를 다른 트랙으로 끌기(2026-10-15 사용자).
//   끄는 동안 놓을 칸 표시 · 놓으면 '모자관계 해제'를 한 번 묻는다 · 취소 → 그대로 · 확인 → 상위에서 빠져 그 트랙 최상위 ·
//   되돌리기 한 번에 끌기·해제가 같이 돌아온다
export default {
  name: 'child-drag',
  areas: ['drag'],
  requires: ['nesting'],
  async run({ target, wrote, withTimeout }) {
    if (!wrote) return null;
    const out = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const o = {};
      const child = r.store.items.find((x) => x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
      if (!child) return { error: '하위 카드 없음' };
      const id = child.id;
      const parentId = child.parent;
      const home = r.store.trackIndex(child.place.t);
      const k = home === 0 ? 1 : 0;
      const card = () => document.querySelector('.col .ev[data-id="' + id + '"]');
      const grid = document.getElementById('grid');
      const drag = async (answer) => {
        card().scrollIntoView({ block: 'center' }); await sleep(150);
        const t = card().querySelector(':scope > .t').getBoundingClientRect();
        const cols = [...document.querySelectorAll('.col')].map((c) => c.getBoundingClientRect());
        const y = t.top + t.height / 2;
        const at = (x) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerType: 'mouse' });
        card().querySelector(':scope > .t').dispatchEvent(new PointerEvent('pointerdown', at(t.left + 4)));
        const x = cols[k].left + cols[k].width / 2;
        grid.dispatchEvent(new PointerEvent('pointermove', at(x)));
        await sleep(120);
        const marked = document.querySelectorAll('.col')[k].classList.contains('drop-leave');
        const pinned = r.store.item(id).parent === parentId;
        grid.dispatchEvent(new PointerEvent('pointerup', at(x)));
        await sleep(250);
        const dlg = document.querySelector('.dlg-scrim:not([hidden]) .dlg');
        const asked = !!dlg && dlg.textContent.includes('모자관계');
        const unmarked = !document.querySelector('.col.drop-leave');
        dlg?.querySelector(answer ? '.dlg-actions .btn.cta' : '.dlg-actions .btn:not(.cta)')?.click();
        await sleep(250);
        return { marked, pinned, asked, unmarked };
      };
      const a = await drag(false);
      o.marked = a.marked; o.pinnedWhileDragging = a.pinned; o.asked = a.asked; o.unmarked = a.unmarked;
      o.cancelKeeps = r.store.item(id).parent === parentId && r.store.trackIndex(r.store.item(id).place.t) === home;
      const b = await drag(true);
      o.askedAgain = b.asked;
      const it = r.store.item(id);
      o.detached = it.parent === null && r.store.trackIndex(it.place.t) === k;
      const node = card();
      o.topLevelInCol = !!node && node.parentElement === document.querySelectorAll('.col')[k];
      r.store.undo(); await sleep(200);
      const back = r.store.item(id);
      o.undoOne = back.parent === parentId && r.store.trackIndex(back.place.t) === home;
      await r.store.flush();
      return o;
    })()`), 20000, 'child-drag');
    console.log('[smoke] child-drag ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.marked === true && o?.pinnedWhileDragging === true && o?.asked === true && o?.unmarked === true && o?.cancelKeeps === true
    && o?.askedAgain === true && o?.detached === true && o?.topLevelInCol === true && o?.undoOne === true,
};
