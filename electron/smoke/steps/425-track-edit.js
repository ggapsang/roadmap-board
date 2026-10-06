// 스모크 단계 'track-edit' — 트랙 머리를 누르면 보드 설정이 아니라 트랙 편집(같은 편집 패널의 트랙 모드)이 열린다.
// 트랙도 이벤트 — 속성(제목·별칭·기간) · 매핑(항등설정·조합설정만) · 스타일(채우기만). 상세 탭은 없다.
// 기간은 보드 기간과 다를 때만 트랙 머리 위쪽에 쓰고, 채우기는 트랙 칸 전체(머리 + 세로 띠). 저장 왕복·되돌리기까지.
export default {
  name: 'track-edit',
  areas: ['panel', 'board', 'db'],
  async run({ target, db, opened }) {
    const r1 = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const t = r.store.tracks[0];
        const id = t.id, name0 = t.name, meta = r.store.meta;
        const shown = (sel) => { const n = document.querySelector(sel); return !!n && n.offsetParent !== null; };
        document.querySelector('.th[data-t="' + id + '"]').click();
        await sleep(250);
        const head = document.getElementById('i-head').textContent;
        const opened = r.panels?.current ?? (document.getElementById('pItem').classList.contains('open') ? 'pItem' : null);
        const panelOpen = document.getElementById('pItem').classList.contains('open') && !document.getElementById('pTrack').classList.contains('open');
        const active = document.querySelector('.th[data-t="' + id + '"]').classList.contains('active');
        const tabs = [...document.querySelectorAll('#pItem .ptab')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.tab).sort().join(',');
        document.querySelector('#pItem .ptab[data-tab="attr"]').click(); await sleep(60);
        const attr = { title: shown('#i-title'), alias: shown('#i-alias'), dates: shown('#i-start'), status: shown('#i-status'), note: shown('#i-note-editor'), span: shown('#i-span') };
        const datesBefore = !!document.querySelector('.th[data-t="' + id + '"] .th-dates');   // 보드 기간과 같다 — 안 쓴다
        // 제목 · 별칭 · 기간
        const title = document.getElementById('i-title');
        title.focus(); title.value = name0 + ' 편집'; title.dispatchEvent(new Event('input', { bubbles: true }));
        title.dispatchEvent(new Event('change', { bubbles: true })); title.blur();
        const alias = document.getElementById('i-alias');
        alias.value = '별칭트랙'; alias.dispatchEvent(new Event('change', { bubbles: true }));
        const s = document.getElementById('i-start'), e = document.getElementById('i-end');
        s.value = meta.start; s.dispatchEvent(new Event('change', { bubbles: true }));
        const end = new Date(meta.start + 'T00:00:00'); end.setDate(end.getDate() + 20);
        const e1 = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
        e.value = e1; e.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(150);
        const tr = r.store.track(id);
        const stored = tr.name === name0 + ' 편집' && tr.alias === '별칭트랙' && tr.s === meta.start && tr.e === e1;
        const th = document.querySelector('.th[data-t="' + id + '"]');
        const headShows = th.querySelector('.nm').textContent === '별칭트랙' && !!th.querySelector('.th-dates')
          && th.querySelector('.th-dates').compareDocumentPosition(th.querySelector('.nm')) & Node.DOCUMENT_POSITION_FOLLOWING;
        // 매핑 — 항등·조합만
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(150);
        const maps = [...document.querySelectorAll('#pItem [data-panel="rel"] .map-sect')].filter((m) => m.offsetParent !== null)
          .map((m) => m.querySelector('.map-title').textContent);
        const sameBtn = !!document.querySelector('#i-same .btn');
        // 스타일 — 채우기만, 트랙 칸 전체
        document.querySelector('#pItem .ptab[data-tab="disp"]').click(); await sleep(60);
        const styleOnly = shown('#i-fill') && !shown('#i-align') && !shown('#i-shownote') && !shown('#i-fixedh');
        document.querySelector('#i-fill .fill-sw[data-fill="teal"]').click(); await sleep(150);
        const col = document.querySelector('.col[data-t="' + id + '"]');
        const filled = r.store.track(id).fill === 'teal' && col.dataset.fill === 'teal'
          && document.querySelector('.th[data-t="' + id + '"]').dataset.fill === 'teal'
          && /gradient/.test(getComputedStyle(col).backgroundImage);
        // 되돌리기 — 날짜 칸이 아니어도 패널 값이 함께 돌아온다
        r.store.undo(); await sleep(150);
        const undone = !r.store.track(id).fill && !document.querySelector('.col[data-t="' + id + '"]').dataset.fill
          && document.querySelector('#i-fill .fill-sw[aria-checked="true"]')?.dataset.fill === '';
        r.store.redo(); await sleep(150);
        // 저장 왕복 — 다시 읽어도 남는다
        await sleep(300);
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        const t2 = r.store.track(id);
        const persisted = t2?.alias === '별칭트랙' && t2?.fill === 'teal' && t2?.s === meta.start && t2?.e === e1 && t2?.name === name0 + ' 편집';
        // 카드를 누르면 다시 일정 편집(모든 칸)
        const card = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        document.querySelector('.col [data-id="' + card.id + '"]').click(); await sleep(250);
        const backToItem = document.getElementById('i-head').textContent === '일정 편집' && !document.getElementById('pItem').classList.contains('track-mode')
          && [...document.querySelectorAll('#pItem .ptab')].filter((b) => b.offsetParent !== null).length === 4;
        document.querySelector('#pItem [data-close]').click(); await sleep(80);
        return { id, head, panelOpen, active, tabs, attr, datesBefore, stored, headShows: !!headShows, maps, sameBtn, styleOnly, filled, undone, persisted, backToItem, name0, e1 };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    // DB — 트랙 이벤트의 기간(본질), 이 보드 배치의 별칭·채우기(표현)
    if (r1 && !r1.error) {
      const root = db.prepare('SELECT root_event_id AS r FROM board WHERE id = ?').get(opened.opened)?.r;
      const ev = db.prepare('SELECT title, start_date, end_date FROM event WHERE id = ?').get(r1.id)
        ?? db.prepare("SELECT title, start_date, end_date FROM event WHERE id LIKE ?").get('track:%:' + r1.id);
      const d = db.prepare('SELECT alias, fill FROM disp WHERE parent_id = ? AND child_id LIKE ?').get(root, '%' + r1.id);
      r1.db = { title: ev?.title, end: ev?.end_date, alias: d?.alias, fill: d?.fill };
    }
    // 원복 — 이름·별칭·기간·채우기
    await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const t = r.store.track(${JSON.stringify(r1?.id ?? '')});
      if (t) r.store.commit('스모크 원복', () => { t.name = ${JSON.stringify(r1?.name0 ?? '')} || t.name; t.alias = null; t.fill = null; t.s = r.store.meta.start; t.e = r.store.meta.end; });
      await new Promise((res) => setTimeout(res, 300));
      return true;
    })()`);
    console.log('[smoke] track-edit ' + JSON.stringify(r1));
    return r1;
  },
  check: (x) => x?.head === '트랙 편집' && x?.panelOpen === true && x?.active === true
    && x?.tabs === 'attr,disp,rel'
    && x?.attr?.title === true && x?.attr?.alias === true && x?.attr?.dates === true
    && x?.attr?.status === false && x?.attr?.note === false && x?.attr?.span === false
    && x?.datesBefore === false && x?.stored === true && x?.headShows === true
    && JSON.stringify(x?.maps) === JSON.stringify(['항등설정', '조합설정']) && x?.sameBtn === true
    && x?.styleOnly === true && x?.filled === true && x?.undone === true && x?.persisted === true && x?.backToItem === true
    && x?.db?.alias === '별칭트랙' && x?.db?.fill === 'teal' && x?.db?.end === x?.e1 && x?.db?.title === x?.name0 + ' 편집',
};
