// 스모크 단계 'hosting' — 보드 호스팅(docs/SHARE.md). 도구 모음 '호스팅'으로 지금 보드를 떼어 내면 호스팅 창이 뜨고,
// 브라우저 참가자(127.0.0.1 — 스모크는 사내망 대신 루프백에만 연다)가 링크로 들어와 이름을 적고 같은 사본을 함께 고친다.
//   다른 칸 동시 고치기 → 둘 다 산다 · 같은 칸 → 모두 같은 값 · 참가자 되돌리기는 자기 것만 · 보기 전용 · 이름 표식 ·
//   참가자 화면엔 DB 전체 기능이 없다 · 토큰 없이·앱 밖 파일은 막힌다 · 원래 보드는 그대로 · 멈췄다 다시 열면 이어진다(이력)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 6000, step = 80) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

export default {
  name: 'hosting',
  areas: ['hosting', 'db', 'board', 'panel'],
  async run({ target, wrote, hosting, hostWindow, BrowserWindow, db }) {
    if (!wrote) return null;
    const out = {};
    const js = (w, code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`);
    // ── 시작 — 도구 모음 '호스팅' → 확인 → 호스팅 창
    const before = await js(target, `
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const btn = document.getElementById('btnHost');
      const shown = !btn.hidden;
      btn.click();
      await sleep(250);
      document.querySelector('.dlg-actions .btn.cta')?.click();
      await sleep(900);
      return { shown, board: r.adapter.projectId, ti: r.store.items[0].ti, id0: r.store.items[0].id, id1: r.store.items[1].id, id2: r.store.items[2].id };`);
    out.btnShown = before.shown;
    const row = await until(() => hosting().list().find((h) => h.sourceBoardId === before.board && h.status === 'open'));
    if (!row) return { ...out, error: '호스팅이 열리지 않았다' };
    out.port = row.port;
    out.portFrom1126 = row.port >= 1126;
    const host = await until(() => hostWindow(row.id));
    await until(() => js(host, 'return !!window.__roadmap?.sessionUi && window.__roadmap.store.items.length > 0'), 10000);
    out.hostSession = await js(host, `return document.body.classList.contains('session-host') && getComputedStyle(document.getElementById('tabbar')).display === 'none'`);

    // ── 참가자 — 링크로 들어와 이름만 적는다
    const url = row.urls[0];
    const guest = new BrowserWindow({ show: false, width: 1300, height: 860, webPreferences: { sandbox: true, contextIsolation: true } });
    await guest.loadURL(url);
    await until(() => js(guest, `return !!document.querySelector('.dlg input')`), 8000);
    await js(guest, `const i = document.querySelector('.dlg input'); i.value = '시험 참가자'; document.querySelector('.dlg-actions .btn.cta').click(); return true;`);
    out.guestReady = !!(await until(() => js(guest, 'return !!window.__roadmap?.sessionUi && window.__roadmap.store.items.length > 0'), 10000));
    out.guestRestricted = await js(guest, `return document.body.classList.contains('session-guest') && !window.roadmapDB
      && getComputedStyle(document.getElementById('btnGraph')).display === 'none' && getComputedStyle(document.getElementById('btnData')).display === 'none'`);
    out.people = !!(await until(() => js(host, `return (window.__roadmap.session.people || []).some((p) => p.name === '시험 참가자')`)));

    const { id0, id1, id2 } = before;
    const item = (w, id, f) => js(w, `return window.__roadmap.store.item(${JSON.stringify(id)})?.${f}`);
    const set = (w, id, f, v) => js(w, `window.__roadmap.store.commit('스모크', () => { window.__roadmap.store.item(${JSON.stringify(id)}).${f} = ${JSON.stringify(v)}; }); return true`);

    // 참가자가 고친 것이 호스트에
    await set(guest, id0, 'ti', '참가자가 고침');
    out.guestToHost = !!(await until(async () => (await item(host, id0, 'ti')) === '참가자가 고침'));
    // 다른 칸 동시에 — 둘 다 산다
    await Promise.all([set(host, id0, 'st', 'done'), set(guest, id0, 'pg', 77)]);
    out.bothFields = !!(await until(async () => (await item(host, id0, 'pg')) === 77 && (await item(guest, id0, 'st')) === 'done'));
    // 같은 칸 동시에 — 모두 같은 값
    await Promise.all([set(host, id1, 'ti', '호스트 값'), set(guest, id1, 'ti', '참가자 값')]);
    await sleep(600);
    const [h1, g1] = [await item(host, id1, 'ti'), await item(guest, id1, 'ti')];
    out.sameField = h1 === g1 && ['호스트 값', '참가자 값'].includes(h1) && hosting().state(row.id).doc.items.find((x) => x.id === id1).ti === h1;
    // 되돌리기 — 참가자는 자기 것만
    await set(guest, id2, 'note', '참가자 비고');
    await until(async () => (await item(host, id2, 'note')) === '참가자 비고');
    await set(host, id2, 'ti', '호스트 제목');
    await until(async () => (await item(guest, id2, 'ti')) === '호스트 제목');
    await js(guest, 'window.__roadmap.store.undo(); return true');
    out.undoOwn = !!(await until(async () => (await item(host, id2, 'note')) !== '참가자 비고' && (await item(host, id2, 'ti')) === '호스트 제목'));
    // 이름 표식 — 참가자가 카드를 고르면 호스트 화면 그 카드 위에 이름
    await js(guest, `window.__roadmap.itemPanel.open(${JSON.stringify(id0)}); return true`);
    out.presence = !!(await until(() => js(host, `return [...document.querySelectorAll('.presence-tag')].some((t) => t.textContent.includes('시험 참가자'))`)));
    // 참가자 화면 — 항등·조합·참조 고르기 없음
    out.noDbWide = await js(guest, `
      document.querySelector('#pItem .ptab[data-tab="rel"]')?.click();
      await new Promise((r) => setTimeout(r, 200));
      return !document.querySelector('#i-same > button.btn') && !document.querySelector('#i-combine > button.btn') && !document.querySelector('#i-refs > button.btn');`);
    // 보기 전용 — 호스트가 바꾸면 참가자는 고치지 못한다
    const gcid = hosting().state(row.id).people.find((p) => p.name === '시험 참가자')?.cid;
    hosting().setRole(row.id, gcid, 'view');
    await until(() => js(guest, 'return window.__roadmap.store.readonly'));
    await set(guest, id0, 'ti', '보기 전용이 고침');
    await sleep(400);
    out.viewOnly = (await item(host, id0, 'ti')) === '참가자가 고침';
    hosting().setRole(row.id, gcid, 'edit');
    // 막힌 것 — 토큰 없이, 앱 밖 파일
    out.blocked = await js(guest, `
      const a = await fetch('/api/state?cid=x', { credentials: 'omit' });
      const b = await fetch('/electron/main.js');
      const c = await fetch('/package.json');
      return a.status === 403 && b.status === 404 && c.status === 404;`);
    // 원래 보드는 그대로(독립 사본)
    out.sourceUntouched = (await js(target, `return window.__roadmap.store.items[0].ti`)) === before.ti;
    // 이력 + 멈췄다 다시 열기
    const nOps = db.prepare('SELECT COUNT(*) n FROM hosting_op WHERE hosting_id = ?').get(row.id).n;
    out.history = nOps >= 5 && hosting().history(row.id).some((h) => h.author === '시험 참가자');
    hosting().pause(row.id);
    out.guestClosed = !!(await until(() => js(guest, 'return window.__roadmap.session.closed')));
    await hosting().open(row.id);
    out.resumed = hosting().state(row.id).doc.items.find((x) => x.id === id0).ti === '참가자가 고침' && hosting().list().find((h) => h.id === row.id).port === row.port;
    out.id = row.id;
    guest.destroy();
    hosting().discard(row.id);
    host.destroy();
    return out;
  },
  check: (o) => o?.btnShown === true && o?.portFrom1126 === true && o?.hostSession === true && o?.guestReady === true
    && o?.guestRestricted === true && o?.people === true && o?.guestToHost === true && o?.bothFields === true && o?.sameField === true
    && o?.undoOwn === true && o?.presence === true && o?.noDbWide === true && o?.viewOnly === true && o?.blocked === true
    && o?.sourceUntouched === true && o?.history === true && o?.guestClosed === true && o?.resumed === true,
};
