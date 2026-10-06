// 스모크 단계 'tab-window' — 탭을 탭 줄 밖으로 끌어 놓으면 따로 창으로, 다른 창 위에 놓으면 그 창의 탭으로(탭 하나뿐인 창은 닫힌다).
// 한 보드는 한 창에만(다른 창의 보드를 열면 거절). 창마다 저장 대상이 따로다(한 창의 저장이 다른 창 보드에 써지지 않는다).
import { BrowserWindow } from 'electron';

const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* 아직 */ }
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
};

export default {
  name: 'tab-window',
  areas: ['tabs', 'db'],
  async run({ target, db, BoardRepository }) {
    const js = (wc, code) => wc.executeJavaScript(code);
    const out = {};
    // 두 번째 보드를 탭으로 열고, 그 탭을 창 아래 밖으로 끌어 놓는다(실제 끌기 경로 — reorder.js)
    const pre = await js(target.webContents, `(async () => {
      const r = window.__roadmap, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const b1 = r.adapter.projectId;
      const b2 = await r.adapter.duplicateProject(b1, '창 테스트');
      await r.tabs.openBoard(b2); await sleep(300);
      const i = r.tabs.tabs.findIndex((t) => t.boardId === b2);
      const tab = document.querySelectorAll('#tabbar .tab')[i];
      const tb = tab.getBoundingClientRect();
      const sx = window.screenX + window.outerWidth + 300, sy = window.screenY + 200;     // 이 창 밖(빈 곳)
      const at = (x, y, sxx, syy) => ({ bubbles: true, clientX: x, clientY: y, screenX: sxx, screenY: syy, button: 0, pointerId: 11 });
      tab.dispatchEvent(new PointerEvent('pointerdown', at(tb.left + 10, tb.top + 8, 0, 0)));
      window.dispatchEvent(new PointerEvent('pointermove', at(tb.left + 30, tb.top + 8, 0, 0)));
      window.dispatchEvent(new PointerEvent('pointermove', at(tb.left + 30, innerHeight + 60, sx, sy)));
      const detachingCue = tab.classList.contains('detaching');
      window.dispatchEvent(new PointerEvent('pointerup', at(tb.left + 30, innerHeight + 60, sx, sy)));
      await sleep(600);
      return { b1, b2, detachingCue, tabsAfter: r.tabs.tabs.map((t) => t.boardId), active: r.adapter.projectId };
    })()`);
    Object.assign(out, pre);
    // 새 창이 그 보드로 떴다
    const w2 = await until(() => BrowserWindow.getAllWindows().find((w) => w.webContents.id !== target.webContents.id));
    out.windows = BrowserWindow.getAllWindows().length;
    const w2board = w2 ? await until(() => js(w2.webContents, 'window.__roadmap?.adapter?.projectId')) : null;
    out.newWindowBoard = w2board === pre.b2;
    out.movedOut = !pre.tabsAfter.includes(pre.b2) && pre.active === pre.b1;
    // 한 보드는 한 창에만 — 첫 창에서 b2를 열려 하면 거절
    out.claimBlocked = await js(target.webContents, `(async () => {
      const r = window.__roadmap; const n = r.tabs.tabs.length;
      const ok = await r.tabs.openBoard(${pre.b2});
      return ok === false && r.tabs.tabs.length === n && r.adapter.projectId === ${pre.b1};
    })()`);
    // 창마다 저장 대상 — 두 창에서 각자 첫 카드 제목을 고치면 각자 보드에만
    if (w2) {
      const mark = Date.now().toString(36);
      const t1 = await js(target.webContents, `(async () => { const r = window.__roadmap; const it = r.store.items[0]; const before = it.ti;
        r.store.commit('창1', () => { it.ti = 'W1-${mark}'; }); await new Promise((s) => setTimeout(s, 300)); return { id: it.id, before }; })()`);
      const t2 = await js(w2.webContents, `(async () => { const r = window.__roadmap; const it = r.store.items[0];
        r.store.commit('창2', () => { it.ti = 'W2-${mark}'; }); await new Promise((s) => setTimeout(s, 300)); return { id: it.id }; })()`);
      const repo = new BoardRepository(db);
      repo.open(pre.b1); const d1 = repo.load();
      repo.open(pre.b2); const d2 = repo.load();
      out.savesRouted = d1.items.find((x) => x.id === t1.id)?.ti === `W1-${mark}` && d2.items.find((x) => x.id === t2.id)?.ti === `W2-${mark}`
        && !d1.items.some((x) => x.ti === `W2-${mark}`) && !d2.items.some((x) => x.ti === `W1-${mark}`);
      await js(target.webContents, `(async () => { const r = window.__roadmap; const it = r.store.item(${JSON.stringify(t1.id)});
        if (it) r.store.commit('원복', () => { it.ti = ${JSON.stringify(t1.before)}; }); await new Promise((s) => setTimeout(s, 300)); return true; })()`);
      // 다시 합치기 — 두 번째 창의 (하나뿐인) 탭을 첫 창 위로 끌어 놓으면 첫 창의 탭이 되고, 두 번째 창은 닫힌다
      const b = target.getBounds();
      out.back = await js(w2.webContents, `(async () => {
        const r = window.__roadmap;
        const res = await r.tabs.detach(0, ${b.x + Math.round(b.width / 2)}, ${b.y + 60});
        return res?.to ?? null;
      })()`);
      await until(() => BrowserWindow.getAllWindows().length === 1, 5000);
      out.windowsAfter = BrowserWindow.getAllWindows().length;
      out.adopted = await until(() => js(target.webContents, `window.__roadmap.adapter.projectId === ${pre.b2} && window.__roadmap.tabs.tabs.some((t) => t.boardId === ${pre.b2})`), 5000);
    }
    // 정리 — 그 탭 닫고 보드 삭제, 첫 보드로
    await js(target.webContents, `(async () => {
      const r = window.__roadmap;
      const i = r.tabs.tabs.findIndex((t) => t.boardId === ${pre.b2});
      if (i >= 0) r.tabs.closeTab(i);
      await r.adapter.deleteProject(${pre.b2});
      await r.tabs.openBoard(${pre.b1});
      await new Promise((s) => setTimeout(s, 300));
      return true;
    })()`);
    console.log('[smoke] tab-window ' + JSON.stringify(out));
    return out;
  },
  check: (x) => x?.detachingCue === true && x?.windows === 2 && x?.newWindowBoard === true && x?.movedOut === true
    && x?.claimBlocked === true && x?.savesRouted === true && x?.back === 'window' && x?.windowsAfter === 1 && x?.adopted === true,
};
