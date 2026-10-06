// 스모크 단계 'note-autosave' — 비고는 치다가 잠깐(1초) 멈추면 저장된다(편집기에서 안 나가도). 한 번 쓴 것(들어가서 나올 때까지)은
// 되돌리기 한 단계. 되돌린 뒤 패널을 다시 채워도 옛 글로 덮어쓰지 않는다. 창을 닫기 전(app:flush)에도 쓰던 것을 저장한다.
export default {
  name: 'note-autosave',
  areas: ['note', 'panel'],
  async run({ target, db }) {
    const r1 = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        const id = it.id, note0 = it.note ?? '';
        r.itemPanel.open(id); await sleep(200);
        document.querySelector('#pItem .ptab[data-tab="attr"]').click(); await sleep(60);
        const v = r.itemPanel.noteEditor.view;
        v.focus();
        const type = (t) => v.dispatch({ changes: { from: v.state.doc.length, insert: t } });
        type('가'); await sleep(300); type('나'); await sleep(300); type('다');
        const notYet = r.store.item(id).note === note0;                 // 치는 중엔 아직
        await sleep(1300);
        const saved = r.store.item(id).note === note0 + '가나다';          // 멈추고 1초 — 편집기에서 안 나가도 저장
        type('라'); await sleep(1300);                                    // 같은 편집 안에서 한 번 더 저장
        const saved2 = r.store.item(id).note === note0 + '가나다라';
        // 같은 편집의 저장은 되돌리기 한 단계 — 편집기에서 나간 뒤 Ctrl+Z 한 번이면 처음 비고
        v.contentDOM.blur(); v.contentDOM.dispatchEvent(new FocusEvent('blur')); await sleep(100);
        document.body.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        await sleep(300);
        const oneStep = r.store.item(id).note === note0;
        // 되돌린 뒤 패널을 다시 채워도(같은 카드 다시 열기) 옛 글로 덮어쓰지 않는다
        r.itemPanel.open(id); await sleep(1300);
        const notResaved = r.store.item(id).note === note0 && v.state.doc.toString() === note0;
        // 창 닫기 전 저장 — 치고 바로(1초 전에) 닫기 요청이 와도 저장된다
        v.focus(); type('마'); await sleep(100);
        return { id, note0, notYet, saved, saved2, oneStep, notResaved };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    if (r1 && !r1.error) {
      // 메인이 닫기 전에 보내는 것과 같은 요청 — 렌더러가 저장을 마치고 app:flushed로 답한다
      const { ipcMain } = await import('electron');
      const answered = await new Promise((res) => {
        const t = setTimeout(() => res(false), 3000);
        ipcMain.once('app:flushed', () => { clearTimeout(t); res(true); });
        target.webContents.send('app:flush');
      });
      const after = await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        await new Promise((res) => setTimeout(res, 200));
        return r.store.item(${JSON.stringify(r1.id)}).note;
      })()`);
      const row = db.prepare('SELECT note FROM event WHERE id = ?').get(r1.id);
      r1.flush = { answered, note: after === r1.note0 + '마', db: row?.note === r1.note0 + '마' };
      // 원복
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        document.querySelector('#pItem [data-close]')?.click();
        r.store.commit('스모크 원복', () => { r.store.item(${JSON.stringify(r1.id)}).note = ${JSON.stringify(r1.note0)}; });
        await new Promise((res) => setTimeout(res, 200));
        return true;
      })()`);
    }
    console.log('[smoke] note-autosave ' + JSON.stringify(r1));
    return r1;
  },
  check: (x) => x?.notYet === true && x?.saved === true && x?.saved2 === true && x?.oneStep === true && x?.notResaved === true
    && x?.flush?.answered === true && x?.flush?.note === true && x?.flush?.db === true,
};
