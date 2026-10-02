// 스모크 단계 'tab-ui' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'tab-ui',
  areas: ["tabs","panel"],
  async run({ target, wrote }) {
    // 탭 끌어 순서 바꾸기(보드 탭줄·편집 패널 탭) · 패널 탭 순서 영구 보관 · 카드를 바꿔도 탭 유지 · 비고 높이
    let tabUi = null;
    if (wrote) {
      tabUi = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const KEY = 'wolfpack:item-tab-order';
          const saved = localStorage.getItem(KEY);          // 스모크는 실제 앱과 localStorage를 같이 쓴다 — 끝나고 되돌린다
          const drag = async (elFrom, toX) => {
            const b = elFrom.getBoundingClientRect();
            const y = b.top + b.height / 2;
            const at = (x) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 9 });
            elFrom.dispatchEvent(new PointerEvent('pointerdown', at(b.left + 10)));
            for (const x of [b.left + 30, (b.left + toX) / 2, toX]) { window.dispatchEvent(new PointerEvent('pointermove', at(x))); await sleep(20); }
            window.dispatchEvent(new PointerEvent('pointerup', at(toX)));
            elFrom.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: toX, clientY: y }));   // 드래그 끝 click은 삼켜져야
            await sleep(120);
          };
          // ① 보드 탭줄 — 탭 두 개를 만들고 첫 탭을 오른쪽 끝으로 끈다. 활성 보드는 그대로.
          const b1 = r.adapter.projectId;
          const b2 = await r.adapter.duplicateProject(b1, '탭 순서 테스트');
          await r.tabs.openBoard(b2); await sleep(250);
          await r.tabs.openBoard(b1); await sleep(250);
          const order0 = r.tabs.tabs.map((t) => t.boardId);
          const tabEls = [...document.querySelectorAll('#tabbar .tab')];
          const first = tabEls[0];
          await drag(first, tabEls[tabEls.length - 1].getBoundingClientRect().right - 2);
          const order1 = r.tabs.tabs.map((t) => t.boardId);
          const boardTabsMoved = order1[order1.length - 1] === order0[0] && order1.length === order0.length;
          const activeKept = r.adapter.projectId === b1 && r.tabs.tabs[r.tabs.active].boardId === b1;
          const noTextSelected = (getSelection()?.toString() ?? '') === '';
          r.tabs.boardClosed(b2);
          await r.adapter.deleteProject(b2);
          await sleep(150);

          // ② 편집 패널 탭 — '스타일'을 맨 앞으로 끈다 → 순서가 저장된다
          const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
          document.querySelector('[data-id="' + cards[0].id + '"]').click();
          await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="attr"]').click();
          await sleep(60);
          const noteH = Math.round(document.getElementById('i-note-editor').getBoundingClientRect().height);
          const bar = document.querySelector('#pItem .ptabs');
          const styleTab = bar.querySelector('.ptab[data-tab="disp"]');
          await drag(styleTab, bar.querySelector('.ptab').getBoundingClientRect().left + 2);
          const domOrder = [...bar.querySelectorAll('.ptab')].map((t) => t.dataset.tab);
          const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
          const panelTabsMoved = domOrder[0] === 'disp' && JSON.stringify(stored) === JSON.stringify(domOrder);
          const dragDidNotSelect = document.querySelector('#pItem .ptab[aria-selected="true"]').dataset.tab !== 'disp';

          // ③ 스타일 탭을 보다가 다른 카드를 누르면 그 카드도 스타일 탭으로
          styleTab.click();
          await sleep(80);
          document.querySelector('[data-id="' + cards[1].id + '"]').click();
          await sleep(250);
          const tabKept = document.querySelector('#pItem .ptab[aria-selected="true"]').dataset.tab === 'disp'
            && !document.querySelector('#pItem .ptab-panel[data-panel="disp"]').hidden;
          document.querySelector('#pItem .ptab[data-tab="attr"]').click();
          document.querySelector('#pItem [data-close]')?.click();

          // 되돌리기 — 사용자의 실제 탭 순서 설정을 건드리지 않는다
          if (saved == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, saved);
          const def = ['attr', 'rel', 'disp', 'task'];
          const want = saved ? JSON.parse(saved) : def;
          const rank = (t) => { const i = want.indexOf(t.dataset.tab); return i < 0 ? 99 : i; };
          bar.append(...[...bar.querySelectorAll('.ptab')].sort((a, b) => rank(a) - rank(b)));
          return { boardTabsMoved, activeKept, noTextSelected, noteH, panelTabsMoved, dragDidNotSelect, tabKept, restored: localStorage.getItem(KEY) === saved };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      console.log('[smoke] tab-ui ' + JSON.stringify(tabUi));
    }
    return tabUi;
  },
  check: (tabUi) => tabUi?.boardTabsMoved === true
    && tabUi?.activeKept === true
    && tabUi?.noTextSelected === true
    && tabUi?.noteH === 565
    && tabUi?.panelTabsMoved === true
    && tabUi?.dragDidNotSelect === true
    && tabUi?.tabKept === true
    && tabUi?.restored === true,
};
