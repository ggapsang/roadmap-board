/**
 * Electron 메인 프로세스.
 *
 * 렌더러는 ES 모듈로 되어 있어서 file:// 로 띄우면 모듈 로딩이 CORS에 막힌다.
 * 그래서 커스텀 app:// 프로토콜을 등록해 정적 파일을 돌려준다.
 * nodeIntegration은 끄고, DB 접근은 preload가 노출한 IPC로만 한다.
 */
import { app, BrowserWindow, protocol, net, ipcMain, shell, dialog, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './db/index.js';
import { BoardRepository } from './db/repository.js';
// 스모크 — 기본 점검 + 고친 코드에 닿는 단계만(electron/smoke/). 렌더러와 같은 시드를 쓴다.
import { runSmoke } from './smoke/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEV = process.argv.includes('--dev');
/** --smoke : 창을 띄워 렌더 결과를 점검하고 바로 종료한다 (npm test) */
const SMOKE = process.argv.includes('--smoke');
/** --repro : --db(복사본)로 조합(구성)·합치기 왕복을 점검한다. DB를 고쳐 쓰므로 복사본만. */
const REPRO = process.argv.includes('--repro');
/** --shot <디렉터리> : 스모크 중 화면을 캡처한다 */
function shotDir() {
  const i = process.argv.indexOf('--shot');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
}

/** --db <경로> 로 DB 파일을 지정할 수 있다 (여러 과제를 따로 관리할 때) */
function resolveDbPath() {
  const i = process.argv.indexOf('--db');
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  // 스모크는 문서를 고쳐 쓰므로 실제 DB를 건드리면 안 된다
  if (SMOKE) return path.join(app.getPath('temp'), `wolfpack-smoke-${process.pid}.db`);
  return path.join(app.getPath('userData'), 'wolfpack.db');
}

/**
 * Roadmap Board 시절의 DB를 이어받는다.
 * 앱 이름이 바뀌면 userData 경로가 통째로 달라져서, 그냥 두면 사용자가 만든
 * 보드가 사라진 것처럼 보인다. 새 경로가 비어 있을 때만 한 번 복사한다.
 */
function adoptLegacyDatabase(target) {
  if (fs.existsSync(target)) return;
  if (process.argv.includes('--db')) return;   // 옛 DB는 기본 위치의 것 — --db로 따로 고른 파일에 끼워 넣지 않는다
  const legacy = path.join(path.dirname(app.getPath('userData')), 'roadmap-board', 'roadmap.db');
  if (!fs.existsSync(legacy)) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(legacy + suffix)) fs.copyFileSync(legacy + suffix, target + suffix);
    }
    console.log('[db] 이전 버전(Roadmap Board)의 데이터를 이어받았습니다:', legacy);
  } catch (err) {
    console.error('[db] 이전 데이터를 옮기지 못했습니다:', err);
  }
}

/**
 * 설치판 첫 실행 — DB가 아직 없으면 설치 파일에 든 예시 DB(resources/example.db)로 시작한다.
 * 만드는 법은 scripts/make-example-db.mjs. 이미 DB가 있으면(쓰던 사람·재설치) 절대 덮지 않는다.
 * 개발 실행(npm start)에서는 쓰지 않는다 — 예시가 필요하면 런처의 '예시 로드맵'이 있다.
 */
function seedExampleDatabase(target) {
  if (!app.isPackaged || fs.existsSync(target)) return;
  const example = path.join(process.resourcesPath, 'example.db');
  if (!fs.existsSync(example)) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(example, target);
    console.log('[db] 첫 실행 — 예시 DB로 시작합니다:', example);
  } catch (err) {
    console.error('[db] 예시 DB를 복사하지 못했습니다:', err);
  }
}

// 스모크·재현은 창이 다른 창에 가려져도 끝까지 돌아야 한다. Chromium은 가려진 창의 그리기·타이머를 늦추거나
// 멈추는데(requestAnimationFrame이 안 옴), 그러면 캡처·렌더 대기 단계가 제멋대로 시간 초과가 난다.
if (SMOKE || REPRO) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

let db = null;
let repo = null;
let win = null;

function registerProtocol() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const target = path.join(ROOT, rel);

    // 디렉터리 탈출 차단
    if (!target.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(target)) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

/**
 * 확대·축소는 **보드만** 한다(렌더러 src/main.js setBoardZoom — 도구 모음·패널은 그대로). 창 배율은 늘 100%.
 * 보기 메뉴와 (렌더러가 못 받은) Ctrl+휠 신호는 렌더러로 보낸다. dir: +1 확대 · -1 축소 · 0 원래대로.
 */
function boardZoom(target, dir) { target?.webContents.send('view:board-zoom', dir); }

/**
 * 창마다의 상태 — 탭을 끌어 따로 뺀 창도 같은 렌더러를 띄운다. webContents.id → 상태.
 *   boards  이 창의 탭에 열린 보드들 — **한 보드는 한 창에만**(두 창에서 같은 보드를 고치면 한쪽이 덮인다, 2026-10-07 사용자)
 *   active  이 창의 저장 대상 보드 — DB 요청은 보낸 창의 보드로 간다(repo.boardId를 요청마다 맞춘다)
 *   flushed 닫기 전 저장을 마쳤나
 */
const winState = new Map();
const stateOf = (e) => winState.get(e?.sender?.id) ?? null;

/** 다른 창들에 알린다(보낸 창 빼고) — 저장·합치기로 그 창의 보드 화면이 달라졌을 때 */
function broadcast(e, channel, payload) {
  for (const [id, st] of winState) {
    if (id === e?.sender?.id || st.win.isDestroyed()) continue;
    st.win.webContents.send(channel, payload);
  }
}

/** 화면 좌표(x,y) 위에 있는 다른 창 — 탭을 끌어 놓은 곳 */
function windowAt(x, y, exceptId) {
  for (const [id, st] of winState) {
    if (id === exceptId || st.win.isDestroyed() || st.win.isMinimized()) continue;
    const b = st.win.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return st.win;
  }
  return null;
}

/**
 * @param {{board?:number, graph?:{scope:number|null,name:string}, x?:number, y?:number}} [open] 새 창이 처음 열 탭(탭을 끌어 뺀 창)
 */
function createWindow(open = null) {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C0A09' : '#FAFAF9',
    title: 'WOLFPACK',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    show: false,
    ...(open && Number.isFinite(open.x) ? { x: Math.round(open.x), y: Math.round(open.y) } : {}),
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !(SMOKE || REPRO),   // 위와 같은 이유 — 검사 중엔 가려져도 늦추지 않는다
    },
  });

  const wcId = w.webContents.id;
  const st = { win: w, boards: new Set(open?.board != null ? [open.board] : []), active: null, flushed: false };
  winState.set(wcId, st);
  const first = !win;
  if (!win) win = w;                       // 첫 창 — 스모크·재현·메뉴의 기본 창
  w.on('closed', () => {
    winState.delete(wcId);
    if (win === w) win = [...winState.values()][0]?.win ?? null;
  });

  // 스모크에서도 창을 띄운다. Chromium은 보이지 않는 창에 프레임을 만들지 않아
  // Page.captureScreenshot(PNG 내보내기)이 응답하지 않는다.
  w.once('ready-to-show', () => { if (SMOKE) w.showInactive(); else w.show(); });
  // 탭을 끌어 뺀 창은 그 탭(보드·그래프)을 바로 연다
  const q = new URLSearchParams();
  if (open?.board != null) q.set('board', String(open.board));
  if (open?.graph) { q.set('graph', open.graph.scope == null ? 'all' : String(open.graph.scope)); q.set('gname', open.graph.name ?? ''); }
  w.loadURL('app://board/index.html' + (q.size ? `?${q}` : ''));
  // 창 닫기(X) — 쓰던 것을 저장하고 닫는다(아래 flushWindow)
  w.on('close', (e) => {
    if (st.flushed || SMOKE || REPRO) return;
    e.preventDefault();
    flushWindow(w).then(() => { st.flushed = true; if (!w.isDestroyed()) w.close(); });
  });
  const win0 = w;                            // 아래는 이 창에 대한 설정
  // Ctrl+휠은 렌더러가 받아 보드만 확대한다(src/main.js). 렌더러가 기본 동작을 막으므로 이 이벤트는 대개 안 오지만,
  // 오면(렌더러가 못 받은 경우) 같은 보드 확대로 보낸다. 창 전체 배율은 늘 100% — 0.2.3에서 저장했던 창 배율도 지운다.
  win0.webContents.on('zoom-changed', (_e, direction) => boardZoom(win0, direction === 'in' ? 1 : -1));
  win0.webContents.on('did-finish-load', () => {
    win0.webContents.setZoomFactor(1);
    if (!SMOKE && !REPRO) { try { fs.rmSync(path.join(app.getPath('userData'), 'view.json'), { force: true }); } catch { /* 없으면 그만 */ } }
  });
  if (SMOKE) {
    // 렌더러 콘솔을 그대로 끌어온다 — 부팅 실패 원인이 여기 찍힌다
    win0.webContents.on('console-message', (e) => {
      const level = ['debug', 'info', 'warn', 'error'][e.level] ?? e.level;
      console.log(`[renderer:${level}] ${e.message}`);
    });
    win0.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log(`[renderer] 로드 실패 ${code} ${desc} ${url}`));
    if (first) win0.webContents.once('did-finish-load', () => runSmoke(win0, {
      app, db, root: ROOT, capture, shotDir, resolveDbPath, BoardRepository, fs, path, ROOT,
    }));
  }
  if (REPRO) {
    win0.webContents.on('console-message', (e) => {
      const level = ['debug', 'info', 'warn', 'error'][e.level] ?? e.level;
      console.log(`[renderer:${level}] ${e.message}`);
    });
    if (first) win0.webContents.once('did-finish-load', () => runRepro(win0));
  }
  if (DEV) win0.webContents.openDevTools({ mode: 'detach' });

  // 외부 링크는 기본 브라우저로
  win0.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return w;
}

/** --repro : 실제 데이터에서 조합(구성)·합치기·복사붙여넣기 왕복 점검. 반드시 DB 복사본으로. */
async function runRepro(target) {
  const boardId = (() => { const i = process.argv.indexOf('--board'); return i >= 0 ? Number(process.argv[i + 1]) : 1; })();
  // --probe <렌더러 스크립트.js> [--probe-shot <png>] — 실제 DB 복사본에서 임의 점검 스크립트를 돌린다(조사용).
  // 스크립트는 async 함수 본문이고 반환값이 JSON으로 찍힌다. window.__roadmap이 준비된 뒤 실행된다.
  const argAt = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
  const probe = argAt('--probe');
  if (probe) {
    let code = 0;
    try {
      await new Promise((r) => setTimeout(r, 700));
      const body = fs.readFileSync(path.resolve(probe), 'utf8');
      let out = await target.webContents.executeJavaScript(`(async () => { ${body}\n})()`);
      // 스크립트가 { mouse: [[종류, x, y], ...] }를 돌려주면 진짜 마우스 입력으로 재생한다(합성 이벤트와 달리
      // 화면에서 맨 위 요소가 받는다 — 가려진 손잡이 같은 것을 잡아낸다). 끝나면 window.__probeAfter()의 결과를 붙인다.
      if (Array.isArray(out?.mouse)) {
        let down = false;                                  // 누른 채 움직이면 끌기 — 이동에도 버튼 상태를 싣는다
        for (const [type, x, y] of out.mouse) {
          if (type === 'wait') { await new Promise((r) => setTimeout(r, x)); continue; }
          if (type === 'mouseDown') down = true;
          target.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
            modifiers: down && type === 'mouseMove' ? ['leftButtonDown'] : [] });
          if (type === 'mouseUp') down = false;
          await new Promise((r) => setTimeout(r, 30));
        }
        await new Promise((r) => setTimeout(r, 300));
        out = { ...out, mouse: undefined, after: await target.webContents.executeJavaScript('(async () => window.__probeAfter?.())()') };
      }
      console.log('[probe] ' + JSON.stringify(out, null, 1));
      const shot = argAt('--probe-shot');
      if (shot) { fs.writeFileSync(path.resolve(shot), (await target.webContents.capturePage()).toPNG()); console.log('[probe] 캡처 ' + shot); }
    } catch (err) { console.log('[probe] FAIL ' + (err?.stack ?? err)); code = 1; }
    app.exit(code);
    return;
  }
  try {
    await new Promise((r) => setTimeout(r, 700));
    const out = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const boards = (await r.adapter.listProjects()).map((p) => p.id);
      for (const b of boards) { await r.tabs.openBoard(b); await sleep(300); }
      await r.tabs.openBoard(${boardId});
      r.launcher.hide();
      await sleep(500);
      const activeStr = String(${boardId});
      const evs = await r.adapter.listEvents();
      // 다른 보드 트랙 하나를 조합 대상으로
      const otherTrack = evs.find((e) => e.kind === 'track' && !String(e.boardIds||'').split(',').includes(activeStr));
      const card = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && x.ti);
      if (!otherTrack || !card) return { error: 'no target/card', otherTrack: !!otherTrack, card: !!card };
      const cid = card.id, tgt = otherTrack.id, tgtTitle = otherTrack.title;
      const itemsBefore = r.store.items.length;
      document.querySelector('[data-id="' + cid + '"]').click();
      await sleep(300);
      document.querySelector('#pItem .ptab[data-tab="rel"]').click();
      await sleep(350);
      // 조합 = 팝업 트리(펼침·검색). '다른 프로젝트에서 조합…' 버튼.
      const combBtn = document.querySelector('#i-combine button');
      if (combBtn) combBtn.click();
      await sleep(700);   // listEvents + eventCards 로 트리 구성
      const treeShown = document.querySelectorAll('.dlg-tree-row').length > 0;
      const hasSearch = !!document.querySelector('.dlg .fl-search input');
      const chev = !!document.querySelector('.dlg-tree-chev');   // 펼침 가능(트리)
      const applyBtn = () => [...document.querySelectorAll('.dlg-actions .btn.cta')].pop();
      // 체크박스 하나만 → 적용 비활성(조합은 둘 이상)
      const cbs = [...document.querySelectorAll('.dlg-tree-row input[type=checkbox]')];
      const chosen = [];
      if (cbs[0]) { cbs[0].click(); const rr = cbs[0].closest('.dlg-tree-row'); if (rr) chosen.push(rr.dataset.id); }
      await sleep(80);
      const disabledAt1 = applyBtn() ? applyBtn().disabled : true;
      // 둘째 체크 → 활성
      for (const cb of [...document.querySelectorAll('.dlg-tree-row input[type=checkbox]')]) {
        if (!cb.checked) { cb.click(); const rr = cb.closest('.dlg-tree-row'); if (rr) chosen.push(rr.dataset.id); break; }
      }
      await sleep(80);
      const enabledAt2 = applyBtn() ? !applyBtn().disabled : false;
      if (applyBtn() && !applyBtn().disabled) applyBtn().click();
      await sleep(300);
      const refs = (r.store.doc.compose || []).filter((x) => x.parent === cid).map((x) => x.child);
      const twoRefs = chosen.length === 2 && chosen.every((id) => refs.includes(id));
      // 조합은 카드를 새로 그리지 않는다 — 같은 보드 대상이면 원래 자리의 카드 그대로, 다른 보드면 없음.
      const itemsUnchanged = r.store.items.length === itemsBefore;
      // 상세 탭에 나오나(조합 그룹)
      document.querySelector('#pItem .ptab[data-tab="task"]').click();
      await sleep(450);
      const inDetail = !document.getElementById('i-children').textContent.includes('세부내역이 없습니다');
      // 저장 대기 후 재로드해서 지속 확인
      await sleep(400);
      await r.openProject(${boardId});
      await sleep(500);
      const persisted = (r.store.doc.compose || []).filter((x) => x.parent === cid).length >= 2;
      const persistedNoCard = r.store.items.length === itemsBefore;

      // ── 동일 = 합치기(merge) — 팝업 버튼 → 트리에서 하나 고름 → 본질 선택 → 합침 ──
      const evs2 = await r.adapter.listEvents();
      const otherCard = evs2.find((e) => e.kind === 'card' && !String(e.boardIds||'').split(',').includes(activeStr));
      let merge = { skipped: true };
      if (otherCard) {
        const card2 = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && x.ti);
        const keep = card2.id, drop = otherCard.id;
        document.querySelector('[data-id="' + keep + '"]').click();
        await sleep(300);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(300);
        const sameBtn = document.querySelector('#i-same button');
        const sameBtnShown = !!sameBtn;
        if (sameBtn) sameBtn.click();
        await sleep(700);
        const dropRow = document.querySelector('.dlg-tree-row[data-id="' + drop + '"] .dlg-tree-label');
        const dropInTree = !!dropRow;
        if (dropRow) dropRow.click();     // single-select → 확정
        await sleep(300);
        const choiceBtns = [...document.querySelectorAll('.dlg-choice')];
        const dialogShown = choiceBtns.length === 2;
        if (choiceBtns[0]) choiceBtns[0].click();
        await sleep(700);
        const after = await r.adapter.listEvents();
        const dropGone = !after.some((e) => e.id === drop);
        const keepStays = after.some((e) => e.id === keep);
        const undoBtn = document.querySelector('.toast-action');
        const undoShown = !!undoBtn;
        if (undoBtn) undoBtn.click();
        await sleep(700);
        const dropBack = (await r.adapter.listEvents()).some((e) => e.id === drop);
        merge = { sameBtnShown, dropInTree, dialogShown, dropGone, keepStays, undoShown, dropBack };
      }

      // ── 트랙도 조합할 수 있다 (ConfigPanel) ──
      let trackCombine = { skipped: true };
      document.getElementById('btnTracks').click();
      await sleep(450);
      const trow = document.querySelector('#tlist .trow');
      const trackCombBtn = trow ? trow.querySelector('.mini') : null;
      if (trackCombBtn) {
        const trackId = r.store.tracks[0].id;
        trackCombBtn.click();
        await sleep(700);
        const rows2 = [...document.querySelectorAll('.dlg-tree-row')];
        let checkedN = 0;   // 조합은 둘 이상
        for (const cb of [...document.querySelectorAll('.dlg-tree-row input[type=checkbox]')]) {
          if (!cb.checked) { cb.click(); checkedN++; if (checkedN >= 2) break; }
        }
        const applyBtn2 = [...document.querySelectorAll('.dlg-actions .btn.cta')].pop();
        if (applyBtn2 && !applyBtn2.disabled) applyBtn2.click();
        await sleep(300);
        const trackRef = (r.store.doc.compose || []).filter((x) => x.parent === trackId).length >= 2;
        trackCombine = { opened: rows2.length > 0, checkedN, trackRef };
      }
      // 구성 패널 닫기
      document.querySelector('#pTrack [data-close]')?.click();
      await sleep(150);

      // ── 우클릭 복사/붙여넣기 ──
      let copyPaste = { skipped: true };
      const cardEl = document.querySelector('.col .ev:not(.ms)');
      if (cardEl) {
        const beforeN = r.store.items.length;
        cardEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }));
        await sleep(120);
        const copyBtn = [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.includes('복사'));
        const copyShown = !!copyBtn;
        if (copyBtn) copyBtn.click();
        await sleep(120);
        const copied = !!r.board._clip;
        const col = document.querySelector('.col');
        col.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 320 }));
        await sleep(120);
        const pasteBtn = [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.includes('붙여넣기'));
        const pasteShown = !!pasteBtn && !pasteBtn.disabled;
        if (pasteBtn && !pasteBtn.disabled) pasteBtn.click();
        await sleep(250);
        copyPaste = { copyShown, copied, pasteShown, pasted: r.store.items.length > beforeN };
      }

      // ── 상위·선행도 팝업 버튼인지 + 선행 픽커 동작 ──
      let relBtns = { skipped: true };
      {
        const card3 = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && x.ti);
        document.querySelector('[data-id="' + card3.id + '"]').click();
        await sleep(300);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(200);
        const parentBtn = !!document.querySelector('#i-parent button.btn');
        const depsBtn = !!document.querySelector('#i-deps button.btn');
        const noInline = document.querySelectorAll('#i-parent .fl-opt, #i-deps .fl-opt').length === 0;
        // 선행 픽커 열어 하나 골라 적용
        const depsBefore = r.store.relations.filter((x) => x.type === 'dep' && x.to === card3.id).length;
        document.querySelector('#i-deps button.btn').click();
        await sleep(300);
        const depTreeShown = document.querySelectorAll('.dlg-tree-row').length > 0;
        const cb = [...document.querySelectorAll('.dlg-tree-row input[type=checkbox]')].find((x) => !x.checked);
        if (cb) cb.click();
        await sleep(80);
        const apply = [...document.querySelectorAll('.dlg-actions .btn.cta')].pop();
        if (apply && !apply.disabled) apply.click();
        await sleep(200);
        const depsAfter = r.store.relations.filter((x) => x.type === 'dep' && x.to === card3.id).length;
        relBtns = { parentBtn, depsBtn, noInline, depTreeShown, depAdded: depsAfter > depsBefore };
        document.querySelector('#pItem [data-close]')?.click();
      }

      // ── 키보드 탭 (Ctrl+T 새 탭, Ctrl+Tab 전환) ──
      const tabsBefore = r.tabs.tabs.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }));
      await sleep(300);
      const tAddsTab = r.tabs.tabs.length > tabsBefore;
      const activeBefore = r.tabs.active;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }));
      await sleep(300);
      const ctrlTabSwitches = r.tabs.active !== activeBefore;
      const keyboardTabs = { tAddsTab, ctrlTabSwitches };

      return { treeShown, hasSearch, chev, disabledAt1, enabledAt2, twoRefs, itemsUnchanged, inDetail, persisted, persistedNoCard, merge, trackCombine, copyPaste, keyboardTabs, relBtns };
    })()`);
    console.log('[repro] ' + JSON.stringify(out));
  } catch (err) {
    console.log('[repro] ERROR ' + String(err));
  }
  try { db.close(); } catch { /* noop */ }
  app.exit(0);
}

/** --shot이 켜져 있으면 현재 화면을 PNG로 남긴다 */
async function capture(target, name) {
  const dir = shotDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  // 직전 DOM 변경이 실제로 그려질 때까지 기다린다
  await target.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
  );
  await new Promise((r) => setTimeout(r, 250));
  const image = await target.webContents.capturePage();
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log('[smoke] 캡처 ' + file);
}

function buildMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        {
          label: 'DB 파일 위치 열기',
          click: () => shell.showItemInFolder(resolveDbPath()),
        },
        { type: 'separator' },
        { role: 'quit', label: '종료' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '되돌리기' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '전체 선택' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'reload', label: '새로고침' },
        // 보드 확대·축소 — Ctrl+휠과 같다(도구 모음·패널은 그대로). 단축키(Ctrl +/-/0)는 카드 글자 크기가 쓰므로 달지 않는다.
        { label: '보드 원래 크기 (100%)', click: () => boardZoom(BrowserWindow.getFocusedWindow() ?? win, 0) },
        { label: '보드 확대 (Ctrl+휠 위)', click: () => boardZoom(BrowserWindow.getFocusedWindow() ?? win, 1) },
        { label: '보드 축소 (Ctrl+휠 아래)', click: () => boardZoom(BrowserWindow.getFocusedWindow() ?? win, -1) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { role: 'toggleDevTools', label: '개발자 도구' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 저장 위치를 묻는다. 스모크에서는 대화상자를 띄울 수 없으므로
 * --shot 디렉터리(또는 임시 폴더)에 바로 떨군다.
 */
async function askSavePath({ title, defaultPath, filters, parent = null }) {
  if (SMOKE) {
    const dir = shotDir() ?? app.getPath('temp');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, defaultPath);
  }
  const { canceled, filePath } = await dialog.showSaveDialog(parent ?? win, { title, defaultPath, filters });
  return canceled ? null : filePath;
}

function registerIpc() {
  // DB 요청은 보낸 창의 보드로 — 창마다 저장 대상 보드가 다르다(repo.boardId를 요청마다 맞춘다. better-sqlite3는 동기라
  // 요청 사이에 끼어들 틈이 없다).
  const guard = (fn) => (e, ...args) => {
    try {
      const st = stateOf(e);
      if (st) repo.open(st.active);
      return { ok: true, data: fn(e, ...args) };
    } catch (err) {
      console.error('[ipc]', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle('db:load', guard(() => repo.load()));
  // 저장은 바뀐 것만 적용한다(docs/SAVE.md). 영향받은 다른 보드·순환이라 넣지 않은 간선을 돌려준다.
  ipcMain.handle('db:save', guard((e, doc, label) => {
    const res = repo.save(doc, label ?? '');
    // 이 저장으로 화면이 달라진 보드가 다른 창에 열려 있으면 그 창이 다시 읽게 한다
    if (res?.affected?.length) broadcast(e, 'boards:stale', res.affected);
    return res;
  }));

  // 프로젝트
  ipcMain.handle('project:list', guard(() => repo.listProjects()));
  ipcMain.handle('event:list', guard(() => repo.listEvents()));
  ipcMain.handle('project:reorder', guard((_e, ids) => { repo.reorderProjects(ids ?? []); return true; }));
  // 렌더러가 보드를 연다 — 받은 문서가 그 보드의 저장 기준이 된다(docs/SAVE.md §3).
  ipcMain.handle('project:open', guard((e, id) => {
    const st = stateOf(e);
    if (st) { st.active = id; st.boards.add(id); }
    return repo.openView(id);
  }));
  // 활성 보드만 바꾼다(문서는 안 읽음). 탭 캐시에서 즉시 전환할 때 저장 대상을 맞춘다.
  ipcMain.handle('project:select', guard((e, id) => {
    const st = stateOf(e);
    if (st) st.active = id;
    repo.open(id); repo.touchOpened(id); return true;
  }));

  // ── 창 — 탭을 끌어 따로 빼거나 다른 창으로 옮긴다. 한 보드는 한 창에만.
  // 보드를 열려는 창이 묻는다 — 다른 창에 이미 열려 있으면 그 창을 앞으로 가져와 그 탭을 보이고 거절한다
  ipcMain.handle('board:claim', (e, id) => {
    const me = e.sender.id;
    for (const [wid, st] of winState) {
      if (wid === me || !st.boards.has(id) || st.win.isDestroyed()) continue;
      if (st.win.isMinimized()) st.win.restore();
      st.win.focus();
      st.win.webContents.send('tab:activate', id);
      return { ok: false, elsewhere: true };
    }
    stateOf(e)?.boards.add(id);
    return { ok: true };
  });
  // 이 창의 탭에 열린 보드들(탭을 열고 닫을 때마다)
  ipcMain.on('tabs:report', (e, ids) => {
    const st = stateOf(e);
    if (st) st.boards = new Set((ids ?? []).filter((x) => x != null));
  });
  // 탭을 탭 줄 밖으로 끌어 놓았다 — 다른 창 위면 그 창의 탭으로, 빈 곳이면 새 창으로(탭이 하나뿐이면 창을 그리로 옮긴다)
  ipcMain.handle('tab:detach', (e, { tab, x, y, last }) => {
    const src = stateOf(e);
    const target = windowAt(x, y, e.sender.id);
    const move = (st) => { if (tab.boardId != null) { src?.boards.delete(tab.boardId); st?.boards.add(tab.boardId); } };
    if (target) {
      move(winState.get(target.webContents.id));
      target.webContents.send('tab:adopt', tab);
      target.focus();
      if (last && src) { src.flushed = true; setTimeout(() => { if (!src.win.isDestroyed()) src.win.close(); }, 50); }
      return { to: 'window' };
    }
    if (last) {                                   // 탭 하나뿐인 창 — 새 창 대신 이 창을 놓은 곳으로
      src?.win.setPosition(Math.round(x - 120), Math.round(y - 16));
      return { to: 'moved' };
    }
    const opened = createWindow({
      board: tab.boardId ?? undefined, graph: tab.kind === 'graph' ? { scope: tab.scope ?? null, name: tab.name ?? '' } : null,
      x: x - 120, y: y - 16,
    });
    move(winState.get(opened.webContents.id));
    return { to: 'new' };
  });
  // 한 이벤트가 품은 카드들 — '상세' 탭에서 조합한 이벤트의 안쪽 일정을 펼칠 때.
  ipcMain.handle('event:cards', guard((_e, id, opts) => repo.eventCards(id, opts ?? {})));
  ipcMain.handle('event:places', guard((_e, id) => repo.eventPlaces(id)));
  // DB 전체를 바꾸는 작업(항등 해제·합치기·삭제·이름·휴지통) — 다른 창들은 열린 보드를 다시 읽는다
  const wide = (fn) => guard((e, ...args) => { const r = fn(e, ...args); broadcast(e, 'boards:stale', null); return r; });
  ipcMain.handle('event:split', wide((_e, boardId, id) => repo.splitEvent(boardId, id)));
  ipcMain.handle('event:unsplit', wide((_e, snap) => repo.unsplitEvent(snap)));
  // 이벤트 몇 개의 본질 · 조상(조합 대상에서 빼야 순환이 안 생긴다)
  ipcMain.handle('event:get', guard((_e, ids) => repo.eventsById(ids)));
  // 그래프 뷰 — 이벤트·포함·관계 전체(읽기 전용)
  ipcMain.handle('graph:data', guard((_e, boardId) => repo.graphData(boardId ?? null)));
  ipcMain.handle('event:ancestors', guard((_e, id) => repo.ancestorsOf(id)));
  // 휴지통 — 부모를 모두 잃은 이벤트 (docs/SAVE.md §7)
  ipcMain.handle('trash:list', guard(() => repo.listTrash()));
  ipcMain.handle('trash:purge', wide((_e, ids) => repo.purgeTrash(ids ?? [])));
  ipcMain.handle('trash:empty', wide(() => repo.emptyTrash()));
  // 동일 매핑 = 두 이벤트를 하나로 합치기(§7.2). 되돌리기 스냅샷을 돌려준다.
  ipcMain.handle('event:merge', wide((_e, keepId, dropId) => repo.mergeEvents(keepId, dropId)));
  ipcMain.handle('event:unmerge', wide((_e, snapshot) => repo.unmergeEvents(snapshot)));
  ipcMain.handle('project:create', guard((_e, doc, name) => repo.createProject(doc, name)));
  ipcMain.handle('project:rename', wide((_e, id, name) => { repo.renameProject(id, name); return true; }));
  ipcMain.handle('project:duplicate', guard((_e, id, name) => repo.duplicateProject(id, name)));
  ipcMain.handle('project:delete', wide((_e, id) => { repo.deleteProject(id); return true; }));
  ipcMain.handle('project:deletePreview', guard((_e, id) => repo.deletePreview(id)));
  ipcMain.handle('db:revisions', guard((_e, limit) => repo.listRevisions(limit ?? 50)));
  ipcMain.handle('db:revision', guard((_e, id) => repo.getRevision(id)));
  ipcMain.handle('db:info', guard(() => ({
    file: resolveDbPath(),
    schema: db.pragma('user_version', { simple: true }),
    projects: repo.listProjects().length,
  })));

  /**
   * 보드 전체를 PNG 한 장으로. 화면에 보이는 부분만이 아니라 스크롤 밖까지 담는다.
   * capturePage()는 뷰포트까지만 찍으므로 CDP의 Page.captureScreenshot에
   * captureBeyondViewport를 켜서 쓴다.
   */
  ipcMain.handle('export:png', async (e, clip, suggested) => {
    const filePath = await askSavePath({
      parent: BrowserWindow.fromWebContents(e.sender),
      title: '보드를 PNG로 내보내기',
      defaultPath: suggested ?? 'roadmap.png',
      filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    });
    if (!filePath) return { ok: false, error: null };

    const wc = e.sender;
    let attached = false;
    // 개발자 도구가 열려 있으면 CDP 디버거가 이미 붙어 있어 attach가 실패한다.
    // 잠시 닫았다가 캡처 후 다시 연다 (npm run dev로 켠 경우의 실패를 막는다).
    const devtoolsWasOpen = wc.isDevToolsOpened();
    try {
      if (devtoolsWasOpen) { wc.closeDevTools(); await new Promise((r) => setTimeout(r, 200)); }
      // 이전 시도가 남긴 오래된 세션이 있으면 떼고 새로 붙인다
      try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* noop */ }
      wc.debugger.attach('1.3'); attached = true;
      const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2,
        },
      });
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      return { ok: true, data: filePath };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    } finally {
      if (attached) { try { wc.debugger.detach(); } catch { /* noop */ } }
      if (devtoolsWasOpen) { try { wc.openDevTools(); } catch { /* noop */ } }
    }
  });

  /**
   * 보드 전체를 PDF 한 장으로. 페이지를 보드 크기에 맞춰 잘리지 않게 한다.
   * 로드맵을 A4로 쪼개면 읽을 수 없어서 단일 페이지로 뽑는다.
   */
  ipcMain.handle('export:pdf', async (e, size, suggested) => {
    const filePath = await askSavePath({
      parent: BrowserWindow.fromWebContents(e.sender),
      title: '보드를 PDF로 내보내기',
      defaultPath: suggested ?? 'roadmap.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!filePath) return { ok: false, error: null };

    try {
      const PX_PER_INCH = 96;
      const margin = 0.2;
      const data = await e.sender.printToPDF({
        printBackground: true,
        pageSize: {
          width: size.width / PX_PER_INCH + margin * 2,
          height: size.height / PX_PER_INCH + margin * 2,
        },
        margins: { top: margin, bottom: margin, left: margin, right: margin },
      });
      fs.writeFileSync(filePath, data);
      return { ok: true, data: filePath };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  // JSON 파일로 반출 / 반입
  ipcMain.handle('file:export', async (e, json, suggested) => {
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) ?? win, {
      title: '로드맵 반출',
      defaultPath: suggested ?? 'roadmap.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, error: null };
    try {
      fs.writeFileSync(filePath, json, 'utf8');
      return { ok: true, data: filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('file:import', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? win, {
      title: '로드맵 반입',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return { ok: false, error: null };
    try {
      return { ok: true, data: fs.readFileSync(filePaths[0], 'utf8') };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}

app.whenReady().then(() => {
  const file = resolveDbPath();
  if (!SMOKE && !REPRO) { adoptLegacyDatabase(file); seedExampleDatabase(file); }
  console.log('[db] 파일:', file);
  db = openDatabase(file);
  repo = new BoardRepository(db);   // 프로젝트는 런처에서 연다

  registerProtocol();
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * 닫기 전 저장 — 비고처럼 '칸에서 나갈 때' 저장하는 것은 창을 바로 닫으면 나가는 일이 없어 빠진다. 창을 닫거나 종료하기 전에
 * 렌더러에 쓰던 것을 저장하게 하고(app:flush), 끝났다는 알림(app:flushed)을 받은 뒤 닫는다. 렌더러가 멈췄으면 2초 뒤 그냥 닫는다.
 */
function flushWindow(w, ms = 2000) {
  return new Promise((resolve) => {
    if (!w || w.isDestroyed()) { resolve(); return; }
    const id = w.webContents.id;
    const onDone = (e) => { if (e.sender.id === id) done(); };
    const done = () => { clearTimeout(timer); ipcMain.removeListener('app:flushed', onDone); resolve(); };
    const timer = setTimeout(done, ms);
    ipcMain.on('app:flushed', onDone);
    w.webContents.send('app:flush');
  });
}
const unflushed = () => (SMOKE || REPRO ? [] : [...winState.values()].filter((st) => !st.flushed && !st.win.isDestroyed()));

app.on('before-quit', (e) => {
  const left = unflushed();
  if (left.length) {
    e.preventDefault();
    Promise.all(left.map((st) => flushWindow(st.win).then(() => { st.flushed = true; }))).then(() => app.quit());
    return;
  }
  try { db?.close(); } catch { /* noop */ }
});
