// 스모크 단계 'tabs' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'tabs',
  areas: ["tabs","db"],
  async run({ target, wrote }) {
    // 보드 탭 — 여러 보드를 탭으로 열고 전환/닫기 (#3). 마지막에 둔다(보드를 오가므로).
    let tabsCheck = null;
    if (wrote) {
      tabsCheck = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const b1 = r.adapter.projectId;
          const name1 = r.store.meta.name;
          const id2 = await r.adapter.duplicateProject(b1, '탭 테스트 보드');
          await r.tabs.openBoard(b1); await sleep(200);
          await r.tabs.openBoard(id2); await sleep(300);
          const tabCount = document.querySelectorAll('#tabbar .tab').length;
          const hasAdd = !!document.querySelector('#tabbar .tab-add');
          const name2 = r.store.meta.name;
          document.querySelectorAll('#tabbar .tab')[0].click(); await sleep(300);
          const nameBack = r.store.meta.name;
          r.tabs.boardClosed(id2); await sleep(150);
          const afterClose = document.querySelectorAll('#tabbar .tab').length;
          await r.adapter.deleteProject(id2);
          return { tabCount, hasAdd, name1, name2, nameBack, afterClose };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      console.log('[smoke] tabs ' + JSON.stringify(tabsCheck));
    }
    return tabsCheck;
  },
  check: (tabsCheck) => tabsCheck?.tabCount === 2
    && tabsCheck?.hasAdd === true
    && tabsCheck?.name2 === '탭 테스트 보드'
    && tabsCheck?.nameBack === tabsCheck?.name1
    && tabsCheck?.afterClose === 1,
};
