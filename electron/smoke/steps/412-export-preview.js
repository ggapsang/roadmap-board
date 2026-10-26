// 스모크 단계 'export-preview' — 내보내기 미리보기(2026-10-26 사용자). 메뉴의 형식을 누르면 보드가 미리보기가 되고(툴바 대신 미리보기
//   막대, 보드는 고칠 수 없다) 트랙 색 범위(칸 전체·머리만)·메모를 고른 대로 보인다 · 내보내기 중(body.exporting)에도 같은 범위 ·
//   Esc로 나온다 · 저장하면 닫힌다. 그리고 골격을 다시 그려도(rebuild) 트랙 칸의 채우기가 남는다(예전엔 머리에만 남았다).
export default {
  name: 'export-preview',
  areas: ['data', 'board'],
  async run({ target, withTimeout }) {
    const out = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const ex = await import('./src/ui/export.js');
      const o = {};
      const t = r.store.tracks[0];
      // 설정은 이 PC 것(localStorage)이라 원래 글 그대로 되돌린다 — 없던 키를 남기지 않게
      const KEYS = ['wolfpack.export.trackFill', 'wolfpack.export.memos'];
      const keep = { fill: t.fill, raw: KEYS.map((k) => localStorage.getItem(k)) };
      r.store.commit('스모크 트랙 색', () => { t.fill = 'blue'; });
      await sleep(100);
      const col = () => document.querySelector('.col[data-t="' + t.id + '"]');
      const th = () => document.querySelector('.th[data-t="' + t.id + '"]');
      const painted = (n) => getComputedStyle(n).backgroundImage !== 'none';
      // 골격을 다시 그려도 칸에 색이 남는다
      r.board.rebuild();
      o.rebuildKeeps = col()?.dataset.fill === 'blue' && painted(col());
      ex.exportTrackFill.set('col');
      // 메뉴에서 PDF — 미리보기가 열리고 PDF가 골라져 있다
      document.getElementById('ex-pdf').click();
      await sleep(150);
      const bar = document.getElementById('xpBar');
      const shown = (n) => !!n && getComputedStyle(n).display !== 'none';
      o.open = ex.exportPreview.active && shown(bar) && !shown(document.querySelector('.bar'))
        && ex.exportPreview.format === 'pdf' && document.getElementById('xp-go').textContent === '저장…';
      o.locked = getComputedStyle(document.querySelector('.cal')).pointerEvents === 'none'
        && getComputedStyle(document.querySelector('.cal .ev') ?? document.body).pointerEvents === 'none';
      // 트랙 색 — 칸 전체 → 머리만(칸은 색 없이, 머리는 그대로). 이 PC에 기억
      o.colFill = painted(col()) && painted(th());
      [...bar.querySelectorAll('.seg button')].find((b) => b.dataset.key === 'head').click();
      await sleep(50);
      o.headOnly = !painted(col()) && painted(th()) && ex.exportTrackFill.get() === 'head';
      // 내보내기 중에도 같은 범위 — 미리보기 밖(메뉴에서 바로 저장하는 길이 없어도 export 함수가 같은 표식을 쓴다)
      document.body.classList.remove('export-preview');
      o.screenFull = painted(col());                       // 화면(미리보기·내보내기 밖)은 늘 칸 전체
      document.body.classList.add('exporting');
      o.exportHead = !painted(col());
      document.body.classList.remove('exporting');
      document.body.classList.add('export-preview');
      // 메모 — 끄면 미리보기에서 사라진다
      const memoBox = document.getElementById('xp-memos');
      memoBox.checked = false; memoBox.dispatchEvent(new Event('change'));
      o.memoOff = document.body.classList.contains('no-memo-export') && ex.exportMemos.get() === false;
      // 형식 — 인쇄면 '인쇄…'
      [...bar.querySelectorAll('.seg button')].find((b) => b.dataset.key === 'print').click();
      o.printLabel = document.getElementById('xp-go').textContent === '인쇄…';
      // 미리보기 동안 보드 단축키는 받지 않는다(Delete로 카드가 지워지지 않게)
      const n = r.store.items.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await sleep(50);
      o.noKeys = r.store.items.length === n;
      // Esc — 나온다
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(50);
      o.esc = !ex.exportPreview.active && !document.getElementById('xpBar') && shown(document.querySelector('.bar'))
        && !document.body.classList.contains('export-preview');
      // PNG로 열고 저장 — 저장하면 닫힌다(스모크의 저장 창은 임시 경로)
      if (r.adapter.exportPng) {
        document.getElementById('ex-png').click();
        await sleep(100);
        document.getElementById('xp-go').click();
        for (let i = 0; i < 100 && ex.exportPreview.active; i++) await sleep(100);
        o.savedCloses = !ex.exportPreview.active && !document.body.classList.contains('exporting');
      } else o.savedCloses = true;
      KEYS.forEach((k, i) => (keep.raw[i] == null ? localStorage.removeItem(k) : localStorage.setItem(k, keep.raw[i])));
      ex.exportTrackFill.value = undefined; ex.exportMemos.on = undefined;
      ex.syncExportTrackFill(); ex.syncExportMemos();
      r.store.commit('스모크 원복', () => { if (keep.fill) t.fill = keep.fill; else delete t.fill; });
      await r.store.flush();
      return o;
    })()`), 30000, 'export-preview');
    console.log('[smoke] export-preview ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o != null && !o.error && Object.values(o).every((v) => v === true),
};
