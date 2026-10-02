// 스모크 단계 'stale-tab' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'stale-tab',
  areas: ["tabs","db"],
  async run({ target, wrote }) {
    let staleTab = null;
    if (wrote) {
      staleTab = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const b1 = r.adapter.projectId;
          const b2 = await r.adapter.duplicateProject(b1, '낡음 테스트');
          await r.tabs.openBoard(b2); await sleep(250);
          const keep = r.store.items.find((x) => !x.parent && x.ty !== 'ms').id;
          await r.tabs.openBoard(b1); await sleep(250);
          const drop = r.store.items.find((x) => !x.parent && x.ty !== 'ms').id;
          const res = await r.adapter.mergeEvents(keep, drop);       // b1 카드를 b2 카드로 합쳐 공유
          r.tabs.markAllStale();
          await r.tabs.reloadActive(); await sleep(150);             // 합치기 뒤 활성 보드를 다시 읽는다(패널과 같은 길)
          await r.tabs.openBoard(b2); await sleep(250);              // b2도 한 번 새로 읽어 둔다
          await r.tabs.openBoard(b1); await sleep(250);
          r.store.commit('공유 편집', (doc) => { const it = doc.items.find((x) => x.id === keep); if (it) it.ti = it.ti + ' ·'; });
          await sleep(250);
          const marked = r.tabs.stale.has(b2);                        // b2가 같은 이벤트를 보고 있다 → 낡음
          await r.tabs.openBoard(b2); await sleep(300);
          const fresh = r.store.items.find((x) => x.id === keep)?.ti.endsWith(' ·') === true;
          const cleared = !r.tabs.stale.has(b2);
          await r.tabs.openBoard(b1); await sleep(200);
          r.store.commit('원복', (doc) => { const it = doc.items.find((x) => x.id === keep); if (it) it.ti = it.ti.replace(/ ·$/, ''); });
          r.tabs.boardClosed(b2);
          await r.adapter.deleteProject(b2);
          return { merged: res?.ok === true, marked, fresh, cleared };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      console.log('[smoke] stale-tab ' + JSON.stringify(staleTab));
    }
    return staleTab;
  },
  check: (staleTab) => staleTab?.merged === true
    && staleTab?.marked === true
    && staleTab?.fresh === true
    && staleTab?.cleared === true,
};
