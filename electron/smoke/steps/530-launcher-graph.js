// 스모크 단계 'launcher-graph' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'launcher-graph',
  areas: ["launcher","graph"],
  async run({ target, wrote }) {
    // 첫 화면 오른쪽 위 — 그래프 · 테마 · 휴지통 순, 그래프는 첫 화면 위로 열린다
    let launcherGraph = null;
    if (wrote) {
      launcherGraph = await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        await r.launcher.show({ closable: true });
        await sleep(150);
        const order = [...document.querySelectorAll('#launcher .lhead .btn.icon')].filter((b) => !b.hidden).map((b) => b.id);
        // 새 보드 — 이름 다음 눈금 고르기. 보기 설명 글자가 상자 밖으로 튀어나오지 않는다(줄바꿈)
        document.getElementById('l-new-blank').click(); await sleep(120);
        document.querySelector('.dlg .btn.cta')?.click(); await sleep(150);          // 이름 '새 보드' 그대로 만들기
        const choices = [...document.querySelectorAll('.dlg-choice')];
        const newBoard = {
          n: choices.length,
          fits: choices.length > 0 && choices.every((c) => {
            const box = c.getBoundingClientRect();
            return c.scrollWidth <= c.clientWidth + 1
              && [...c.children].every((k) => k.getBoundingClientRect().right <= box.right + 0.5);
          }),
        };
        [...document.querySelectorAll('.dlg .btn.outline')].find((x) => x.textContent === '취소')?.click(); await sleep(120);
        newBoard.cancelled = !document.querySelector('.dlg-choice');
        // 도움말 — 팝업, 절마다 목차, 표, 시스템 개념 이야기는 없다, Esc로 닫고 F1로 연다
        document.getElementById('l-help').click();
        for (let i = 0; i < 30 && !document.querySelector('.help-sec h3'); i += 1) await sleep(100);
        const hb = document.querySelector('.help-body');
        const help = {
          sections: document.querySelectorAll('.help-sec').length,
          toc: document.querySelectorAll('.help-toc-item').length,
          tables: document.querySelectorAll('.help-body table').length,
          noSystemTalk: !/순서 기반 이벤트|전개 시스템/.test(hb?.textContent ?? ''),
        };
        // 글자 크기 — 가＋ 두 번, Ctrl - 한 번 = 110%. 보드 글자 크기는 그대로(도움말이 가로챈다)
        const savedHelp = localStorage.getItem('wolfpack:help-view');
        localStorage.removeItem('wolfpack:help-view');
        const zoomBtns = [...document.querySelectorAll('.help-zoom .seg-btn')];
        zoomBtns[1].click();                                         // 원래 크기(100%)부터
        const boardFs = r.store.meta.display.fontScale;
        const px = () => parseFloat(getComputedStyle(hb).fontSize);
        const px0 = px();
        zoomBtns[2].click(); zoomBtns[2].click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }));
        await sleep(50);
        help.fontLabel = document.querySelector('.help-fs').textContent;
        help.fontGrew = Math.abs(px() - px0 * 1.1) < 0.2;
        help.boardFontKept = r.store.meta.display.fontScale === boardFs;
        // 크기 조절 — 모서리를 끌면 커지고, 왼쪽 위 모서리는 제자리
        const dlg = document.querySelector('.help-dlg');
        const grip = document.querySelector('.help-resize');
        const b0 = dlg.getBoundingClientRect();
        const g = grip.getBoundingClientRect();
        const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 13 });
        grip.dispatchEvent(new PointerEvent('pointerdown', at(g.left + 5, g.top + 5)));
        window.dispatchEvent(new PointerEvent('pointermove', at(g.left - 95, g.top - 55)));
        window.dispatchEvent(new PointerEvent('pointerup', at(g.left - 95, g.top - 55)));
        await sleep(50);
        const b1 = dlg.getBoundingClientRect();
        help.resized = Math.round(b0.width - b1.width) === 100 && Math.round(b0.height - b1.height) === 60;
        help.cornerKept = Math.abs(b1.left - b0.left) < 1 && Math.abs(b1.top - b0.top) < 1;
        // 크기 조절 뒤 끌어 옮겨도 튀지 않는다(위치를 매번 style에서 읽음)
        const h2 = dlg.querySelector('h2').getBoundingClientRect();
        dlg.querySelector('h2').dispatchEvent(new PointerEvent('pointerdown', at(h2.left + 5, h2.top + 5)));
        window.dispatchEvent(new PointerEvent('pointermove', at(h2.left + 45, h2.top + 25)));
        window.dispatchEvent(new PointerEvent('pointerup', at(h2.left + 45, h2.top + 25)));
        const b2 = dlg.getBoundingClientRect();
        help.moveAfterResize = Math.round(b2.left - b1.left) === 40 && Math.round(b2.top - b1.top) === 20;
        const pref = JSON.parse(localStorage.getItem('wolfpack:help-view') ?? '{}');
        help.remembered = pref.fs === 1.1 && Math.round(pref.w) === Math.round(b1.width);
        if (savedHelp == null) localStorage.removeItem('wolfpack:help-view'); else localStorage.setItem('wolfpack:help-view', savedHelp);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(80);
        help.escClosed = !document.querySelector('.help-scrim');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
        for (let i = 0; i < 20 && !document.querySelector('.help-sec'); i += 1) await sleep(50);
        help.f1 = !!document.querySelector('.help-scrim');
        document.querySelector('.help-scrim')?.remove();
        const boardBefore = r.adapter.projectId;
        const tabsBefore = r.tabs.tabs.length;
        document.getElementById('l-graph').click();
        await sleep(700);
        const gv = document.getElementById('graphView');
        const gTab = r.tabs.tabs.findIndex((t) => t.kind === 'graph');
        const ownTab = gTab >= 0 && r.tabs.active === gTab && r.tabs.tabs[gTab].boardId == null
          && document.querySelectorAll('#tabbar .tab.tab-graph').length === 1 && r.tabs.tabs.length === tabsBefore + 1;
        const shown = !gv.hidden && document.getElementById('launcher').hidden;
        const nodes = document.querySelectorAll('#graphView .gv-node').length;
        // 툴바에서 다시 눌러도 그래프 탭은 하나
        document.getElementById('btnGraph').click();
        await sleep(200);
        const single = r.tabs.tabs.filter((t) => t.kind === 'graph').length === 1;
        // 그래프 탭에선 보드 단축키가 뒤의 보드에 가지 않는다
        const undoBefore = r.store.canUndo;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        const noBoardKeys = r.store.canUndo === undoBefore;
        // 탭 ×로 닫으면 보던 보드 탭으로
        document.querySelector('#tabbar .tab.tab-graph .tab-x').click();
        await sleep(300);
        const closed = gv.hidden && !r.tabs.tabs.some((t) => t.kind === 'graph') && r.adapter.projectId === boardBefore;
        return { newBoard,  order, help, ownTab, shown, nodes, single, noBoardKeys, closed };
      })()`);
      console.log('[smoke] launcher-graph ' + JSON.stringify(launcherGraph));
    }
    return launcherGraph;
  },
  check: (launcherGraph) => JSON.stringify(launcherGraph?.order) === JSON.stringify(['l-help', 'l-graph', 'l-theme', 'l-trash', 'l-close'])
    && launcherGraph?.help?.sections >= 8
    && launcherGraph?.help?.toc === launcherGraph?.help?.sections - 1
    && launcherGraph?.help?.tables >= 3
    && launcherGraph?.help?.noSystemTalk === true
    && launcherGraph?.help?.escClosed === true
    && launcherGraph?.help?.f1 === true
    && launcherGraph?.newBoard?.n === 4
    && launcherGraph?.newBoard?.fits === true
    && launcherGraph?.newBoard?.cancelled === true
    && launcherGraph?.help?.fontLabel === '110%'
    && launcherGraph?.help?.fontGrew === true
    && launcherGraph?.help?.boardFontKept === true
    && launcherGraph?.help?.resized === true
    && launcherGraph?.help?.cornerKept === true
    && launcherGraph?.help?.moveAfterResize === true
    && launcherGraph?.help?.remembered === true
    && launcherGraph?.ownTab === true
    && launcherGraph?.shown === true
    && launcherGraph?.nodes > 0
    && launcherGraph?.single === true
    && launcherGraph?.noBoardKeys === true
    && launcherGraph?.closed === true,
};
