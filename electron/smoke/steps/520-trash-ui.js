// 스모크 단계 'trash-ui' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'trash-ui',
  areas: ["launcher","db"],
  async run({ target, capture, wrote }) {
    // 휴지통 UI — 카드를 보드에서 빼면(Delete) 첫 화면 버튼 → 팝업에 뜨고, 영구 삭제가 확인 뒤 지운다.
    let trashUi = null;
    if (wrote) {
      trashUi = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const card = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
          document.querySelector('[data-id="' + card.id + '"]').click();
          await sleep(250);
          document.getElementById('i-del').click();                   // 보드에서 빼기
          await sleep(300);
          const leftBoard = !r.store.items.some((x) => x.id === card.id);
          await r.launcher.show({ closable: true });
          await sleep(200);
          const btn = document.getElementById('l-trash');
          const btnShown = !!btn && !btn.hidden;
          btn.click();
          await sleep(500);
          const rows = () => [...document.querySelectorAll('.trash-row')];
          const listed = rows().some((x) => x.dataset.id === card.id);
          return { card: card.id, leftBoard, btnShown, listed, n: rows().length };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      await capture(target, 'trash');
      const purge = await target.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = ${JSON.stringify(trashUi?.card ?? '')};
        const row = document.querySelector('.trash-row[data-id="' + id + '"]');
        if (!row) return { error: 'no row' };
        row.querySelector('.trash-del').click();
        await sleep(200);
        const confirmBtn = [...document.querySelectorAll('.dlg-scrim:not([hidden])')].pop()?.querySelector('.dlg .btn.danger');   // 맨 위 = 확인 창
        const asked = !!confirmBtn;
        confirmBtn?.click();
        await sleep(500);
        const gone = !document.querySelector('.trash-row[data-id="' + id + '"]');
        const trash = await window.__roadmap.adapter.listTrash();
        const purged = !trash.some((x) => x.id === id);
        [...document.querySelectorAll('.trash-dlg .btn.outline')].pop()?.click();   // 닫기
        await sleep(150);
        const closed = !document.querySelector('.trash-dlg');
        window.__roadmap.launcher.hide();
        return { asked, gone, purged, closed };
      })()`);
      trashUi = { ...trashUi, ...purge };
      console.log('[smoke] trash-ui ' + JSON.stringify(trashUi));
    }
    return trashUi;
  },
  check: (trashUi) => trashUi?.leftBoard === true
    && trashUi?.btnShown === true
    && trashUi?.listed === true
    && trashUi?.asked === true
    && trashUi?.gone === true
    && trashUi?.purged === true
    && trashUi?.closed === true,
};
