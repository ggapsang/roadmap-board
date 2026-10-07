// 스모크 단계 'track-board-merge' — 트랙과 보드를 항등설정(합치기)한다. 합친 노드에서 트랙 쪽 카드와 보드 쪽 트랙은 각자 1세대
// 자식으로 갈라진다 — 서로 잇지 않는다: 이 보드의 그 트랙엔 원래 카드만, 그 보드엔 원래 트랙만. 고르기 창은 트랙에서만 보드를 고를 수
// 있다(카드는 아직 아니다). 합친 보드를 지워도 트랙(=그 루트)과 트랙의 카드는 남는다.
export default {
  name: 'track-board-merge',
  areas: ['panel', 'db'],
  async run({ target, db, BoardRepository, wrote }) {
    if (!wrote) return null;
    const ui = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
        const b1 = r.adapter.projectId;
        const b2 = await r.adapter.duplicateProject(b1, '합칠 보드');
        await r.tabs.openBoard(b1); await sleep(300);
        const ev = await r.adapter.listEvents();
        const b2root = ev.find((e) => e.kind === 'board' && Number(e.boardId) === b2)?.id;
        // 하나 고르는 창 — 고를 수 있는 줄은 이름이 링크(.linklike), 못 고르는 줄은 묶음 제목(.dlg-tree-head)
        const rowCheckable = () => { const row = document.querySelector('.dlg-tree-row[data-id="' + b2root + '"]');
          return !!row && !!row.querySelector('.dlg-tree-label.linklike') && !row.classList.contains('dlg-tree-head'); };
        // 트랙 — 보드 줄을 고를 수 있다
        const t = r.store.tracks[0];
        document.querySelector('.th[data-t="' + t.id + '"]').click(); await sleep(300);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(250);
        document.querySelector('#i-same > button.btn').click(); await sleep(500);
        const fromTrack = rowCheckable();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100);
        // 카드 — 보드 줄은 못 고른다
        const card = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        r.itemPanel.open(card.id); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(250);
        document.querySelector('#i-same > button.btn').click(); await sleep(500);
        const fromCard = rowCheckable();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100);
        document.querySelector('#pItem [data-close]')?.click();
        const cardsOfT = r.store.items.filter((x) => x.place.t === t.id).map((x) => x.id).sort();
        // 합치기 — 트랙을 남긴다(본질 = 트랙)
        const res = await r.adapter.mergeEvents(t.id, b2root);
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        const tAfter = r.store.track(t.id);
        const cardsAfter = r.store.items.filter((x) => x.place.t === t.id).map((x) => x.id).sort();
        return { b1, b2, b2root, track: t.id, fromTrack, fromCard, merged: res?.ok === true,
          trackKept: !!tAfter, cardsSame: JSON.stringify(cardsAfter) === JSON.stringify(cardsOfT), nTracks: r.store.tracks.length };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    if (!ui || ui.error) { console.log('[smoke] track-board-merge ' + JSON.stringify(ui)); return ui; }
    const repo = new BoardRepository(db);
    // 합친 보드 — 루트가 그 트랙이고, 트랙은 원래 트랙만(이 보드 트랙의 카드가 트랙으로 끼지 않는다), 이름은 남긴 본질의 제목
    const root2 = db.prepare('SELECT root_event_id AS r, name FROM board WHERE id = ?').get(ui.b2);
    repo.open(ui.b2); const d2 = repo.load();
    repo.open(ui.b1); const d1 = repo.load();
    const t1 = d1.tracks.find((t) => t.id === ui.track);
    const out = {
      ...ui,
      rootIsTrack: root2?.r === ui.track,
      b2Name: root2?.name === t1?.name,
      b2Tracks: d2.tracks.length === ui.nTracks && !d2.tracks.some((t) => t.id === ui.track),
      b2NoCardsAsTracks: !d2.tracks.some((t) => d1.items.some((x) => x.id === t.id)),
      // 이 보드에선 그 트랙에 저 보드의 트랙이 카드로 끼지 않는다
      b1NoTracksAsCards: !d1.items.some((x) => d2.tracks.some((t) => t.id === x.id)),
    };
    // 합친 보드 지우기 — 미리보기도, 실제로도 트랙(=루트)과 그 카드는 남는다
    const preview = repo.deletePreview(ui.b2);
    repo.deleteProject(ui.b2);
    repo.open(ui.b1); const d1b = repo.load();
    out.deleteKeeps = !!d1b.tracks.find((t) => t.id === ui.track)
      && d1b.items.filter((x) => x.place.t === ui.track).length === d1.items.filter((x) => x.place.t === ui.track).length
      && !!db.prepare('SELECT 1 FROM event WHERE id = ?').get(ui.track);
    out.preview = preview;
    await target.webContents.executeJavaScript(`(async () => { const r = window.__roadmap; r.tabs.markAllStale(); await r.tabs.reloadActive(); return true; })()`);
    console.log('[smoke] track-board-merge ' + JSON.stringify(out));
    return out;
  },
  check: (x) => x?.fromTrack === true && x?.fromCard === false && x?.merged === true && x?.trackKept === true && x?.cardsSame === true
    && x?.rootIsTrack === true && x?.b2Name === true && x?.b2Tracks === true && x?.b2NoCardsAsTracks === true && x?.b1NoTracksAsCards === true
    && x?.deleteKeeps === true,
};
