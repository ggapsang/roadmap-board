// 스모크 단계 'panel-undo' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'panel-undo',
  areas: ["panel"],
  async run({ target, wrote }) {
    // 패널에서 고친 것도 Ctrl+Z — 날짜·체크박스·드롭다운처럼 글 쓰는 칸이 아니면 커서가 그 칸에 있어도 보드 되돌리기로 간다.
    // 되돌리면 패널 칸도 되돌린 값을 보인다. 글 쓰는 칸(제목)은 그 칸의 되돌리기가 먼저이고, 한 번 고친 것(들어가서 나올 때까지) = 한 단계.
    let panelUndo = null;
    if (wrote) {
      panelUndo = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && x.s);
          const id = it.id, s0 = it.s, e0 = it.e, t0 = it.ti;
          r.itemPanel.open(id); await sleep(200);
          document.querySelector('#pItem .ptab[data-tab="attr"]').click(); await sleep(60);
          const start = document.getElementById('i-start'), title = document.getElementById('i-title');
          const key = (node, k, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
          // 날짜 바꾸기 → 커서가 날짜 칸에 있는 채로 Ctrl+Z
          const d = new Date(s0 + 'T00:00:00'); d.setDate(d.getDate() - 3);
          const s1 = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          start.focus(); start.value = s1; start.dispatchEvent(new Event('change', { bubbles: true })); await sleep(80);
          const changed = r.store.item(id).s === s1;
          key(document.activeElement, 'z'); await sleep(150);
          const dateUndone = r.store.item(id).s === s0 && document.getElementById('i-start').value === s0;
          key(document.activeElement ?? document.body, 'y'); await sleep(150);
          const dateRedone = r.store.item(id).s === s1 && document.getElementById('i-start').value === s1;
          // 제목 — 글자마다 commit해도 한 번 고친 것 = 한 단계, 칸에서 나와(날짜 칸) Ctrl+Z 한 번이면 처음 제목
          title.focus();
          for (const add of ['가', '가나', '가나다']) { title.value = t0 + add; title.dispatchEvent(new Event('input', { bubbles: true })); await sleep(20); }
          title.dispatchEvent(new Event('change', { bubbles: true })); title.blur(); await sleep(60);
          const typed = r.store.item(id).ti === t0 + '가나다';
          const start2 = document.getElementById('i-start'); start2.focus();
          key(start2, 'z'); await sleep(150);
          const titleOneStep = r.store.item(id).ti === t0 && document.getElementById('i-title').value === t0 && r.store.item(id).s === s1;
          // 글 쓰는 칸 안의 Ctrl+Z는 보드로 가지 않는다
          const title2 = document.getElementById('i-title'); title2.focus();
          key(title2, 'z'); await sleep(120);
          const writingKept = r.store.item(id).s === s1;
          title2.blur();
          // 원복
          r.store.commit('스모크 원복', () => { const x = r.store.item(id); x.s = s0; x.e = e0; x.ti = t0; });
          document.querySelector('#pItem [data-close]').click(); await sleep(80);
          return { changed, dateUndone, dateRedone, typed, titleOneStep, writingKept };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
        return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
      })()`);
      console.log('[smoke] panel-undo ' + JSON.stringify(panelUndo));
    }
    return panelUndo;
  },
  check: (panelUndo) => panelUndo?.changed === true
    && panelUndo?.dateUndone === true
    && panelUndo?.dateRedone === true
    && panelUndo?.typed === true
    && panelUndo?.titleOneStep === true
    && panelUndo?.writingKept === true,
};
