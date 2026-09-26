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
// 스모크용. 렌더러와 같은 시드를 쓴다 — 순수 ESM이라 메인에서도 읽힌다.
import { SEED as SMOKE_SEED } from '../src/config/seed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEV = process.argv.includes('--dev');
/** --smoke : 창을 띄워 렌더 결과를 점검하고 바로 종료한다 (npm test) */
const SMOKE = process.argv.includes('--smoke');
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0C0A09' : '#FAFAF9',
    title: 'WOLFPACK',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 스모크에서도 창을 띄운다. Chromium은 보이지 않는 창에 프레임을 만들지 않아
  // Page.captureScreenshot(PNG 내보내기)이 응답하지 않는다.
  win.once('ready-to-show', () => { if (SMOKE) win.showInactive(); else win.show(); });
  win.loadURL('app://board/index.html');
  if (SMOKE) {
    // 렌더러 콘솔을 그대로 끌어온다 — 부팅 실패 원인이 여기 찍힌다
    win.webContents.on('console-message', (e) => {
      const level = ['debug', 'info', 'warn', 'error'][e.level] ?? e.level;
      console.log(`[renderer:${level}] ${e.message}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log(`[renderer] 로드 실패 ${code} ${desc} ${url}`));
    win.webContents.once('did-finish-load', () => runSmoke(win));
  }
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * 렌더러가 실제로 그려졌는지 확인한다. DOM을 직접 세어 보고 결과를 표준출력에 남긴다.
 * 창을 띄우지 않으므로 CI에서도 돌릴 수 있다.
 */
/** 한 단계가 매달리면 전체가 멈춘다. 시간 제한을 걸고 넘어간다. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms}ms)`)), ms)),
  ]);
}

async function runSmoke(target) {
  // 런처가 첫 화면이다. 프로젝트를 하나 만들어 열고 나서 보드를 검사한다.
  const openProbe = `(async () => {
    const r = window.__roadmap;
    if (!r) return { error: '__roadmap 없음 — 부팅 실패' };
    const before = await r.adapter.listProjects();
    const id = await r.adapter.createProject(window.__smokeSeed, '스모크 프로젝트');
    await r.openProject(id);
    r.launcher.hide();          // 실제 사용 경로에서는 Launcher가 닫아 준다
    await new Promise((res) => setTimeout(res, 300));
    const after = await r.adapter.listProjects();
    return {
      projectsBefore: before.length, projectsAfter: after.length, opened: id,
      launcherClosed: document.getElementById('launcher').hidden,
    };
  })()`;

  const probe = `(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const r = window.__roadmap;
    return {
      error: document.body.firstElementChild?.tagName === 'PRE'
        ? document.body.textContent.slice(0, 400) : null,
      tracks: q('.th'),
      cards: q('.ev'),
      milestones: q('.ev.ms'),
      arrows: q('.arrows path'),
      weeks: q('.gut-w s'),
      months: q('.gut-m b'),
      statusChips: q('.status .stat'),
      orgChips: q('.org'),
      today: q('.now'),
      items: r ? r.store.items.length : -1,
      storage: r ? r.adapter.constructor.name : '?',
      firstCard: document.querySelector('.ev .t')?.textContent ?? null,
    };
  })()`;

  // 편집 → 저장 왕복. 문서를 고치고 저장이 DB까지 닿는지 본다.
  const writeProbe = `(async () => {
    const { store } = window.__roadmap;
    const mark = 'SMOKE-' + Date.now();
    store.commit('smoke', (doc) => { doc.items[0].ti = mark; });
    await new Promise((r) => setTimeout(r, 300));
    return mark;
  })()`;

  let opened = null;
  let renamed = null;
  let layout = null;
  let exported = null;
  let banded = null;
  let compressed = null;
  let nested = null;
  let relCheck = null;
  let orderCheck = null;
  let orderMode = null;
  let containCheck = null;
  let taskCheck = null;
  let idCheck = null;
  let drill = null;
  let panelFit = null;
  let sameCheck = null;
  let combineCheck = null;
  let xition = null;
  let spanForce = null;
  let progressCheck = null;
  let cornerCheck = null;
  let trackResize = null;
  let spanEdit = null;
  let newTrack = null;
  let spanDrag = null;
  let edgeDrag = null;
  let childWidth = null;
  let underflow = null;
  let madeCards = null;
  let titleWrap = null;
  let msRange = null;
  let topWidth = null;
  let reorder = null;
  let delKey = null;
  let containerAlign = null;
  let titleFit = null;
  let fixedH = null;
  let trim = null;
  let monthResize = null;
  let ctxDelete = null;
  let dragExtend = null;
  let result;
  try {
    await new Promise((r) => setTimeout(r, 600));

    // 런처가 떠 있는지 먼저 본다
    const launcherUp = await target.webContents.executeJavaScript(
      `!document.getElementById('launcher').hidden`,
    );
    console.log('[smoke] launcher ' + (launcherUp ? 'ok' : 'FAIL (첫 화면에 안 떴다)'));
    await capture(target, 'launcher');

    // 렌더러에 시드를 넣어 주고 프로젝트를 만들어 연다
    await target.webContents.executeJavaScript(
      `window.__smokeSeed = ${JSON.stringify(SMOKE_SEED)}; true`,
    );
    opened = await target.webContents.executeJavaScript(openProbe);
    console.log('[smoke] project ' + JSON.stringify(opened));

    result = await target.webContents.executeJavaScript(probe);
    await capture(target, 'board');

    // 패널을 열면 본문이 밀리는가 / 텍스트 선택 모드가 걸리는가
    layout = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const scroll = document.getElementById('scroll');
      const before = scroll.getBoundingClientRect().width;
      document.querySelector('.ev').click();
      await new Promise((res) => setTimeout(res, 300));
      const after = scroll.getBoundingClientRect().width;
      const panelOpen = document.body.classList.contains('panel-open');
      document.getElementById('btnSelect').click();
      await new Promise((res) => setTimeout(res, 100));
      const selectable = getComputedStyle(document.querySelector('.ev')).userSelect;
      document.getElementById('btnSelect').click();
      return { before, after, shrunk: before - after, panelOpen, selectable };
    })()`);
    console.log('[smoke] layout ' + JSON.stringify(layout));
    await capture(target, 'board-panel');
    // 탭별 패널 모습도 남긴다 (관계=검색 리스트, 표시=아이콘 툴바)
    if (shotDir()) {
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="rel"]').click()`);
      await new Promise((res) => setTimeout(res, 200));
      await capture(target, 'panel-rel');
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="disp"]').click()`);
      await new Promise((res) => setTimeout(res, 150));
      await capture(target, 'panel-disp');
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="attr"]').click()`);
    }
    await target.webContents.executeJavaScript(
      `document.querySelector('#pItem [data-close]').click()`,
    );

    // 중첩 — PPT 시안처럼 '1년차 과제 제출용 화면 구성'이 세부 일정을 품는다
    nested = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('중첩', (doc) => {
        const host = doc.items.find((i) => i.id === 'e10');
        host.e = '2026-11-30';
        host.place.align = 'top';
        for (const id of ['e11','e12','e13','e14','e15','e16']) {
          doc.items.find((i) => i.id === id).parent = 'e10';
        }
      });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const host = document.querySelector('[data-id="e10"]');
      const inside = host ? host.querySelectorAll(':scope > .ev').length : -1;
      const topLevel = document.querySelectorAll('.col > .ev').length;
      return { inside, topLevel, isContainer: host?.classList.contains('container') ?? false };
    })()`);
    console.log('[smoke] nesting ' + JSON.stringify(nested));
    await capture(target, 'board-nested');

    // 관계 일급화 — 선행(dep)이 doc.relations로 관리되고, 추가/삭제가 화살표에 반영되는가
    relCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const rels = r.store.relations;
      const allDep = rels.length > 0 && rels.every((x) => x.type === 'dep' && x.from && x.to && x.id);
      const paths = () => document.querySelectorAll('.arrows path').length;
      const c0 = paths();
      r.store.commit('rel+', (doc) => { doc.relations.push({ id: 'rtest', type: 'dep', from: 'e1', to: 'e20' }); });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const c1 = paths();
      r.store.commit('rel-', (doc) => { doc.relations = doc.relations.filter((x) => x.id !== 'rtest'); });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const c2 = paths();
      return { relCount: rels.length, allDep, c0, c1, c2, added: c1 === c0 + 1, removed: c2 === c0 };
    })()`);
    console.log('[smoke] relations ' + JSON.stringify(relCheck));

    // 순서상 위치 계산 — 선행 그래프의 위상 순위가 정합적인가 (DIRECTION #4-b)
    orderCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const mod = await import('./src/core/order.js');
      const rank = mod.computeOrder(r.store.items, r.store.relations);
      let topoOk = true, edges = 0, maxRank = 0;
      for (const rel of r.store.relations) {
        if (rel.type !== 'dep') continue;
        edges++;
        if (!(rank.get(rel.from) < rank.get(rel.to))) topoOk = false;
      }
      for (const v of rank.values()) maxRank = Math.max(maxRank, v);
      return { size: rank.size, edges, topoOk, maxRank };
    })()`);
    console.log('[smoke] order ' + JSON.stringify(orderCheck));

    // 순서 렌더 모드(초안) — axis='order'면 rank로 세로 배치, 선행 from이 to보다 위
    orderMode = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('축 순서', (doc) => { doc.meta.display.axis = 'order'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 200));
      const topOf = (id) => { const el = document.querySelector('[data-id="' + id + '"]'); return el ? Math.round(el.getBoundingClientRect().top) : null; };
      const rel = r.store.relations.find((x) => x.type === 'dep' && document.querySelector('[data-id="' + x.from + '"]') && document.querySelector('[data-id="' + x.to + '"]'));
      const ordered = rel ? topOf(rel.from) < topOf(rel.to) : false;
      const em = document.querySelector('.gut-m b u em');
      const hasOrderAxis = !!em && em.textContent === '순서';
      const cards = document.querySelectorAll('.col > .ev').length;
      return { cards, ordered, hasOrderAxis };
    })()`), 20000, 'order-mode');
    if (shotDir()) await capture(target, 'board-order');
    // 되돌리기 — 이후 단계는 달력 모드를 전제로 한다
    orderMode.back = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('축 달력', (doc) => { doc.meta.display.axis = 'calendar'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 200));
      return document.querySelector('.gut-m b u em')?.textContent !== '순서';
    })()`);
    console.log('[smoke] order-mode ' + JSON.stringify(orderMode));

    // 포함(contain)도 관계로 노출되는가 — 정규화 후 doc.relations에 contain이 생긴다
    containCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const { prepare } = await import('./src/core/schema.js');
      const { doc } = prepare(structuredClone(r.store.doc));
      const contains = (doc.relations ?? []).filter((x) => x.type === 'contain');
      return {
        count: contains.length,
        hasE10: contains.some((x) => x.from === 'e10'),
        allValid: contains.every((x) => x.from && x.to && x.id),
      };
    })()`);
    console.log('[smoke] contain ' + JSON.stringify(containCheck));

    // 태스크(순서 없는 할 일) — 카드 칩·정규화 라운드트립·id 유일 (DIRECTION #6)
    taskCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const { prepare } = await import('./src/core/schema.js');
      const it = r.store.items[0];
      const id = it.id;
      r.store.commit('smoke-task', () => {
        it.tasks = [
          { id: 'kSmokeA', text: '할일 A', done: false },
          { id: 'kSmokeB', text: '할일 B', done: true },
        ];
      });
      await new Promise((res) => setTimeout(res, 60));
      const card = document.querySelector('.ev[data-id="' + id + '"]');
      const chip = card ? card.querySelector('.tasks-chip') : null;
      const chipText = chip ? chip.textContent : '';
      const { doc } = prepare(structuredClone(r.store.doc));
      const norm = doc.items.find((x) => x.id === id);
      const ids = new Set((norm.tasks ?? []).map((t) => t.id));
      return {
        count: norm.tasks?.length ?? 0,
        doneKept: (norm.tasks ?? []).filter((t) => t.done).length === 1,
        uniqueIds: ids.size === 2,
        chip: /1\\/2/.test(chipText),
      };
    })()`);
    console.log('[smoke] task ' + JSON.stringify(taskCheck));

    // 보드-독립 재식별 — 복제본은 새 id, 참조(부모·관계) 정합 유지 (DIRECTION #3)
    idCheck = await target.webContents.executeJavaScript(`(async () => {
      const { reidentify } = await import('./src/core/schema.js');
      const r = window.__roadmap;
      const before = structuredClone(r.store.doc);
      const beforeIds = new Set(before.items.map((i) => i.id));
      const after = reidentify(structuredClone(before));
      const afterIds = after.items.map((i) => i.id);
      const set = new Set(afterIds);
      return {
        n: afterIds.length,
        allNew: afterIds.every((id) => !beforeIds.has(id)),
        unique: set.size === afterIds.length,
        relOk: (after.relations ?? []).every((x) => set.has(x.from) && set.has(x.to)),
        parentOk: after.items.every((i) => !i.parent || set.has(i.parent)),
        relKept: (after.relations ?? []).length === (before.relations ?? []).length,
      };
    })()`);
    console.log('[smoke] id ' + JSON.stringify(idCheck));

    // 트랙 열 너비 드래그 — 재렌더로 손잡이가 사라져도 이어져야 한다
    trackResize = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const handle = document.querySelector('.th .th-resize');
      if (!handle) return { error: '손잡이 없음' };
      const id = handle.closest('.th').dataset.t;
      const col = () => document.querySelector('.col[data-t="' + id + '"]').getBoundingClientRect().width;
      const before = Math.round(col());
      const box = handle.getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height / 2, button: 0 });

      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.left)));
      // 여러 번 나눠 움직인다 — 중간 재렌더를 견디는지 보는 것이 핵심
      for (const dx of [20, 60, 120]) {
        window.dispatchEvent(new PointerEvent('pointermove', at(box.left + dx)));
        await new Promise((res) => setTimeout(res, 30));
      }
      window.dispatchEvent(new PointerEvent('pointerup', at(box.left + 120)));
      await new Promise((res) => setTimeout(res, 120));

      const after = Math.round(col());
      const stored = r.store.track(id).w;

      // 더블클릭하면 자동으로 되돌아가는가
      document.querySelector('.th[data-t="' + id + '"] .th-resize')
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      const reset = r.store.track(id).w;

      return { before, after, stored, grew: after > before + 80, reset };
    })()`), 20000, 'track-resize');
    console.log('[smoke] track-resize ' + JSON.stringify(trackResize));

    // 지정 너비 트랙이 있어도 오른쪽 패널이 열리면 본문이 함께 좁아진다(가로 스크롤 없음)
    panelFit = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('넓은 트랙', () => { for (const t of r.store.tracks) t.w = 320; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const scroll = document.getElementById('scroll');
      document.querySelector('.col > .ev')?.click();     // 패널 열기
      await new Promise((res) => setTimeout(res, 350));
      const panelOpen = document.body.classList.contains('panel-open');
      const cal = document.querySelector('.cal');
      const calW = Math.round(cal.getBoundingClientRect().width);
      const scrollW = Math.round(scroll.clientWidth);
      const fits = calW <= scrollW + 2;                  // 본문이 좁아진 영역에 들어간다
      document.querySelector('#pItem [data-close]').click();
      r.store.commit('원복', () => { for (const t of r.store.tracks) t.w = null; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      return { panelOpen, calW, scrollW, fits };
    })()`), 20000, 'panel-fit');
    console.log('[smoke] panel-fit ' + JSON.stringify(panelFit));

    // 트랙 걸침 — 숫자 대신 트랙 칩을 눌러 조절. 세 번째 칩 → sp=3.
    spanEdit = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      card.click();
      await sleep(200);
      document.querySelector('#pItem .ptab[data-tab="attr"]').click();
      await sleep(60);
      const chips = () => document.querySelectorAll('#i-span .seg-btn');
      const nodes = () => document.querySelectorAll('.cal .ev[data-id="' + id + '"]').length;
      const boxW = () => { const e = document.querySelector('.cal .ev[data-id="' + id + '"]'); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
      const home = r.store.trackIndex(r.store.item(id).place.t);
      const before = { sp: r.store.item(id).place.sp, px: boxW(), nodes: nodes() };
      // 인접 트랙 추가 → 붙어 있으니 걸침(한 장이 더 넓어짐)
      chips()[home + 1].click(); await sleep(180);
      const adj = { sp: r.store.item(id).place.sp, px: boxW(), nodes: nodes() };
      // 떨어진 트랙 추가(사이 한 칸 비움) → 사이 트랙은 자동 선택되지 않고, 사본이 따로 뜬다
      chips()[home + 3].click(); await sleep(180);
      const it = r.store.item(id);
      const gapId = r.store.tracks[home + 2].id;
      const far = { gapSelected: (it.place.tracks || []).includes(gapId), nodes: nodes(), members: (it.place.tracks || []).length };
      r.store.commit('원복', () => { const x = r.store.item(id); x.place.tracks = [x.place.t]; x.place.sp = 1; });
      document.querySelector('#pItem [data-close]').click();
      return { before, adj, far, chips: chips().length };
    })()`), 20000, 'span');
    console.log('[smoke] span ' + JSON.stringify(spanEdit));

    // 위 가장자리 드래그 = 시작일, 아래 = 종료일
    edgeDrag = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e };
      const ppd = r.view.ppd;

      const pull = async (selector, dyDays) => {
        const el = document.querySelector('[data-id="' + id + '"]');
        const g = el.querySelector(selector);
        if (!g) return '손잡이 없음: ' + selector;
        const b = g.getBoundingClientRect();
        const at = (y) => ({ bubbles: true, clientX: b.left + b.width / 2, clientY: y, button: 0 });
        g.dispatchEvent(new PointerEvent('pointerdown', at(b.top + 2)));
        grid.dispatchEvent(new PointerEvent('pointermove', at(b.top + 2 + dyDays * ppd)));
        await new Promise((res) => setTimeout(res, 100));
        grid.dispatchEvent(new PointerEvent('pointerup', at(b.top + 2 + dyDays * ppd)));
        await new Promise((res) => setTimeout(res, 150));
        return null;
      };

      await pull('.grip-top', 4);        // 시작일을 4일 뒤로
      const afterTop = { s: it().s, e: it().e };
      await pull('.grip', 5);            // 종료일을 5일 뒤로
      const afterBottom = { s: it().s, e: it().e };

      r.store.commit('원복', () => { it().s = before.s; it().e = before.e; });
      return { before, afterTop, afterBottom,
               startMoved: afterTop.s !== before.s && afterTop.e === before.e,
               endMoved: afterBottom.e !== afterTop.e && afterBottom.s === afterTop.s };
    })()`), 20000, 'edge-drag');
    console.log('[smoke] edge-drag ' + JSON.stringify(edgeDrag));

    // 축 밖으로 넘긴 일정 — 시작일을 meta.start(9월)보다 앞선 8월로 보내면
    // 축이 8월까지 늘어나야 한다 (카드가 축 위로 튀어나가 사라지면 안 된다).
    underflow = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e };
      const originBefore = r.board.origin.getTime();
      const monthsBefore = [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);

      r.store.commit('축 밖으로', () => { it().s = '2026-08-10'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));

      const originAfter = r.board.origin.getTime();
      const monthsAfter = [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);
      const hasAug = monthsAfter.some((t) => t.startsWith('8월'));
      const cardTop = Math.round(document.querySelector('[data-id="' + id + '"]').getBoundingClientRect().top);

      return {
        before, originBefore, originAfter, hasAug,
        monthsBefore: monthsBefore.length, monthsAfter: monthsAfter.length,
        extended: originAfter < originBefore, cardTop,
      };
    })()`), 20000, 'underflow');
    console.log('[smoke] underflow ' + JSON.stringify(underflow));
    if (shotDir()) await capture(target, 'board-underflow');

    // 원복 — 이후 단계(밴드/압축 등)가 원래 범위를 전제로 한다
    underflow.restored = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cid = document.querySelector('.col > .ev:not(.ms)').dataset.id;
      r.store.commit('원복', () => { r.store.item(cid).s = ${JSON.stringify(underflow?.before?.s)}; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      return r.board.origin.getTime() === ${underflow?.originBefore ?? 0};
    })()`);
    console.log('[smoke] underflow restored ' + underflow.restored);

    // 트랙 걸침 드래그 — 여러 칸에 걸친 막대(sp≥2)의 오른쪽 가장자리를 끌면 칸 단위로 붙는가.
    // (sp=1 막대의 오른쪽 가장자리는 폭 조절용이라 걸침 손잡이가 없다 — 아래 top-width 참고)
    spanDrag = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      r.store.commit('초기화', () => { const it = r.store.item(id); it.place.sp = 2; it.place.x = null; it.place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grip = el().querySelector('.grip-span');
      if (!grip) return { error: 'grip-span 없음' };
      const box = grip.getBoundingClientRect();
      const cols = [...document.querySelectorAll('.col')].map((c) => c.getBoundingClientRect());
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + 20, button: 0 });
      const grid = document.getElementById('grid');
      // pointerdown은 손잡이에 쏴야 한다 — 핸들러가 ev.target으로 모드를 가른다
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left + 2)));
      // 세 번째 트랙 한가운데로 끈다
      grid.dispatchEvent(new PointerEvent('pointermove', at(cols[2].left + cols[2].width / 2)));
      await new Promise((res) => setTimeout(res, 120));
      grid.dispatchEvent(new PointerEvent('pointerup', at(cols[2].left + cols[2].width / 2)));
      await new Promise((res) => setTimeout(res, 150));
      const sp = r.store.item(id).place.sp;
      const px = Math.round(el().getBoundingClientRect().width);
      r.store.commit('원복', () => { r.store.item(id).place.sp = 2; });
      return { sp, px, colW: Math.round(cols[0].width) };
    })()`), 20000, 'span-drag');
    console.log('[smoke] span-drag ' + JSON.stringify(spanDrag));

    // 가로폭 드래그는 '크기 강제' 모드에서만. 강제 아니면 sp=1 최상위는 걸침 손잡이만.
    topWidth = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      // 강제 아님 → 폭 손잡이 없고 걸침 손잡이만 있어야 한다
      r.store.commit('자동', () => { const it = r.store.item(id); it.place.sp = 1; it.place.hd = null; it.place.x = null; it.place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const autoHasSpan = !!document.querySelector('[data-id="' + id + '"] .grip-span');
      const autoHasHe = !!document.querySelector('[data-id="' + id + '"] .grip-he');
      // 강제 켜기 → 좌우 폭 손잡이 등장
      r.store.commit('강제', () => { r.store.item(id).place.hd = 20; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grip = el().querySelector('.grip-he');
      if (!grip) return { error: 'grip-he 없음(강제 폭 손잡이)', autoHasSpan, autoHasHe };
      const before = Math.round(el().getBoundingClientRect().width);
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + 10, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left + 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.left - 90)));   // 왼쪽으로 90px
      await new Promise((res) => setTimeout(res, 120));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.left - 90)));
      await new Promise((res) => setTimeout(res, 150));
      const w = r.store.item(id).place.w;
      const after = Math.round(el().getBoundingClientRect().width);
      r.store.commit('원복', () => { const it = r.store.item(id); it.place.hd = null; it.place.x = null; it.place.w = null; it.place.sp = 2; });
      r.board.render();
      return { autoHasSpan, autoHasHe, before, after, w, shrank: after < before, hasW: w != null && w < 1 };
    })()`), 20000, 'top-width');
    console.log('[smoke] top-width ' + JSON.stringify(topWidth));

    // 트랙을 새로 추가하면 그 트랙에 카드가 들어가는가
    newTrack = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = document.querySelectorAll('.col').length;
      document.getElementById('t-add').click();
      await new Promise((res) => setTimeout(res, 250));
      const after = document.querySelectorAll('.col').length;
      const id = r.store.tracks[r.store.tracks.length - 1].id;
      const hasColumn = !!document.querySelector('.col[data-t="' + id + '"]');
      // 그 트랙에 일정을 만들어 본다
      const item = r.board.createItem(id, 10);
      await new Promise((res) => setTimeout(res, 200));
      const drawn = !!document.querySelector('.col[data-t="' + id + '"] [data-id="' + item.id + '"]');
      return { before, after, hasColumn, drawn };
    })()`), 20000, 'new-track');
    console.log('[smoke] new-track ' + JSON.stringify(newTrack));

    // 트랙 열 순서 드래그 (엑셀식) — 첫 헤더를 오른쪽으로 끌면 순서가 바뀐다
    reorder = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.tracks.map((t) => t.id);
      const heads = [...document.querySelectorAll('.th')];
      const cell = heads[0];
      const movingId = cell.dataset.t;
      const r0 = cell.getBoundingClientRect();
      const target = heads[2].getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: r0.top + r0.height / 2, button: 0, pointerId: 1 });
      cell.dispatchEvent(new PointerEvent('pointerdown', at(r0.left + 20)));
      window.dispatchEvent(new PointerEvent('pointermove', at(target.left + target.width * 0.6)));
      await new Promise((res) => setTimeout(res, 100));
      window.dispatchEvent(new PointerEvent('pointerup', at(target.left + target.width * 0.6)));
      await new Promise((res) => setTimeout(res, 150));
      const after = r.store.tracks.map((t) => t.id);
      const newIndex = after.indexOf(movingId);
      r.store.commit('원복', (doc) => {
        doc.tracks.sort((a, b) => before.indexOf(a.id) - before.indexOf(b.id));
      });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const restored = r.store.tracks.map((t) => t.id).join(',') === before.join(',');
      return { count: before.length, movingId, newIndex, moved: newIndex > 0, restored };
    })()`), 20000, 'reorder');
    console.log('[smoke] reorder ' + JSON.stringify(reorder));

    // 빈 곳 클릭/드래그로 일정 만들기 (구글 캘린더식). 클릭=1주, 드래그=끈 길이.
    madeCards = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      const S = r.board.scale;
      const lastId = r.store.tracks[r.store.tracks.length - 1].id;
      const col = document.querySelector('.col[data-t="' + lastId + '"]');
      const rect = col.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const yOf = (d) => rect.top + S.y(d);
      const incDays = (it) => Math.round((new Date(it.e) - new Date(it.s)) / 86400000) + 1;
      const ev = (type, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      const countBefore = r.store.items.length;

      // 클릭 — 빈 40일 지점(그 트랙엔 10일 카드뿐이라 비어 있다)
      col.dispatchEvent(ev('pointerdown', yOf(40)));
      grid.dispatchEvent(ev('pointerup', yOf(40)));
      await new Promise((res) => setTimeout(res, 150));
      const clicked = r.store.items[r.store.items.length - 1];
      const clickDays = incDays(clicked);

      // 드래그 — 60일에서 80일까지
      col.dispatchEvent(ev('pointerdown', yOf(60)));
      grid.dispatchEvent(ev('pointermove', yOf(80)));
      grid.dispatchEvent(ev('pointerup', yOf(80)));
      await new Promise((res) => setTimeout(res, 150));
      const dragged = r.store.items[r.store.items.length - 1];
      const dragDays = incDays(dragged);

      // 정리 — 만든 두 카드 제거
      const ids = [clicked.id, dragged.id];
      r.store.commit('정리', (doc) => { doc.items = doc.items.filter((i) => !ids.includes(i.id)); });
      await new Promise((res) => setTimeout(res, 120));
      return { countBefore, added: 2, clickDays, dragDays, restored: r.store.items.length === countBefore };
    })()`), 20000, 'create');
    console.log('[smoke] create ' + JSON.stringify(madeCards));

    // 제목 줄바꿈 — 여러 줄 제목이 카드에서 실제로 두 줄로 그려지는가
    titleWrap = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = () => r.store.item('e1');
      const before = it().ti;
      const oneH = Math.round(document.querySelector('[data-id="e1"] .t').getBoundingClientRect().height);
      r.store.commit('제목 줄바꿈', () => { it().ti = '라인1\\n라인2'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const t = document.querySelector('[data-id="e1"] .t');
      const ws = getComputedStyle(t).whiteSpace;
      const twoH = Math.round(t.getBoundingClientRect().height);
      const hasNL = t.textContent.includes('\\n');
      r.store.commit('원복', () => { it().ti = before; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { ws, oneH, twoH, hasNL, grew: twoH > oneH };
    })()`);
    console.log('[smoke] title-wrap ' + JSON.stringify(titleWrap));

    // 기간 마일스톤 — 점 마일스톤(e12)에 종료일을 주면 막대(레인 참여)로 바뀐다
    msRange = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = () => r.store.item('e12');
      const beforeE = it().e;
      const wasPoint = !!document.querySelector('[data-id="e12"].ms.point');
      const pointH = Math.round(document.querySelector('[data-id="e12"]').getBoundingClientRect().height);
      r.store.commit('기간 마일스톤', () => { it().e = '2026-10-30'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e12"]');
      const nowRanged = node.classList.contains('ranged') && !node.classList.contains('point');
      const rangeH = Math.round(node.getBoundingClientRect().height);
      return { wasPoint, nowRanged, pointH, rangeH, grew: rangeH > pointH, beforeE };
    })()`);
    console.log('[smoke] ms-range ' + JSON.stringify(msRange));
    if (shotDir()) await capture(target, 'board-msrange');
    msRange.backPoint = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('원복', () => { r.store.item('e12').e = ${JSON.stringify(msRange?.beforeE)}; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      return !!document.querySelector('[data-id="e12"].ms.point');
    })()`);
    console.log('[smoke] ms-range restored ' + msRange.backPoint);

    // Delete/Backspace 단축키로 선택한 카드 삭제 — 입력 칸에 있을 땐 안 먹는다
    delKey = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const item = r.board.createItem(r.store.tracks[0].id, 5);   // 임시 카드 + 선택
      await new Promise((res) => setTimeout(res, 120));
      const id = item.id;
      const existsBefore = !!r.store.item(id);
      // 제목 입력 칸에 포커스 → Delete가 무시돼야 한다
      document.getElementById('i-title').focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await new Promise((res) => setTimeout(res, 80));
      const survivedWhileTyping = !!r.store.item(id);
      // 입력 칸 밖에서 Backspace(⌫) → 삭제된다
      document.getElementById('i-title').blur();
      r.view.selectedItem = id;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      const deleted = !r.store.item(id);
      return { existsBefore, survivedWhileTyping, deleted };
    })()`);
    console.log('[smoke] del-key ' + JSON.stringify(delKey));

    // 컨테이너 카드도 글자 세로 정렬(align)을 따르는가 — e10은 nesting 단계부터 컨테이너
    containerAlign = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.item('e10').place.align;
      r.store.commit('정렬', () => { r.store.item('e10').place.align = 'bottom'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e10"]');
      const jc = getComputedStyle(node).justifyContent;
      const cBottom = node.classList.contains('c-bottom');
      const isContainer = node.classList.contains('container');
      r.store.commit('원복', () => { r.store.item('e10').place.align = before; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { jc, cBottom, isContainer };
    })()`);
    console.log('[smoke] container-align ' + JSON.stringify(containerAlign));

    // 펼치기(드릴다운) — 자식을 품은 카드를 펼치면 그 자식들이 보드가 된다 (PDF §8)
    drill = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const container = r.store.items.find((i) => r.store.items.some((c) => c.parent === i.id));
      const id = container.id;
      const kids = r.store.items.filter((c) => c.parent === id).map((c) => c.id);
      r.view.setFocus(id);
      await new Promise((res) => setTimeout(res, 200));
      const crumbsVisible = !document.getElementById('crumbs').hidden;
      const topInCols = [...document.querySelectorAll('.col > .ev')].map((n) => n.dataset.id);
      const childrenShown = kids.every((k) => topInCols.includes(k));
      const containerNotTop = !topInCols.includes(id);   // 펼친 카드 자신은 루트라 컬럼에 없다
      r.view.setFocus(null);
      await new Promise((res) => setTimeout(res, 150));
      const restored = document.getElementById('crumbs').hidden
        && [...document.querySelectorAll('.col > .ev')].some((n) => n.dataset.id === id);
      return { kids: kids.length, crumbsVisible, childrenShown, containerNotTop, restored };
    })()`);
    console.log('[smoke] drill ' + JSON.stringify(drill));
    if (shotDir()) {
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const c = r.store.items.find((i) => r.store.items.some((x) => x.parent === i.id));
        r.view.setFocus(c.id);
      })()`);
      await new Promise((res) => setTimeout(res, 300));
      await capture(target, 'board-drill');
      await target.webContents.executeJavaScript('window.__roadmap.view.setFocus(null)');
      await new Promise((res) => setTimeout(res, 150));
    }

    // 제목이 카드를 넘치면 폰트가 줄어 잘리지 않는가 — 짧은 카드 e33에 긴 제목
    titleFit = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.item('e33').ti;
      r.store.commit('긴 제목', () => { r.store.item('e33').ti = '진행 계획 공유 및 세부 조율 회의 자료 준비'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e33"]');
      const t = node.querySelector(':scope > .t');
      const font1 = parseFloat(getComputedStyle(t).fontSize);
      const fits = node.scrollHeight <= node.clientHeight + 1
        && t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1;
      r.store.commit('원복', () => { r.store.item('e33').ti = before; });
      r.board.render();
      return { font1, shrank: font1 < 11, fits };
    })()`);
    console.log('[smoke] title-fit ' + JSON.stringify(titleFit));

    // 세로 크기 강제 — hd(일)가 클수록 카드가 높고(결정적), 아래 가장자리를 끌면
    // 날짜는 그대로 hd만 바뀐다. 위 손잡이(시작일)는 감춘다.
    fixedH = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const id = 'e33';
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e, hd: it().place.hd ?? null };
      const node = () => document.querySelector('[data-id="' + id + '"]');
      r.store.commit('h15', () => { it().place.hd = 15; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const h15 = Math.round(node().getBoundingClientRect().height);
      const hasTopGrip = !!node().querySelector('.grip-top');   // 강제 모드도 위 손잡이(위로 리사이즈)를 가진다
      r.store.commit('h25', () => { it().place.hd = 25; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const h25 = Math.round(node().getBoundingClientRect().height);
      // 드래그로 hd가 바뀌고 날짜는 그대로인지 (방향·정확한 양은 합성 이벤트라 관대하게)
      const grip = node().querySelector('.grip');
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.top + box.height / 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.top + box.height / 2 + ppd * 8)));
      await new Promise((res) => setTimeout(res, 150));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.top + box.height / 2 + ppd * 8)));
      await new Promise((res) => setTimeout(res, 150));
      const hdAfter = it().place.hd;
      const datesUnchanged = it().s === before.s && it().e === before.e;
      r.store.commit('원복', () => { it().place.hd = before.hd; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { h15, h25, hdAfter, hasTopGrip, datesUnchanged, mapGrew: h25 > h15, dragChanged: hdAfter !== 25 };
    })()`), 20000, 'fixed-height');
    console.log('[smoke] fixed-height ' + JSON.stringify(fixedH));

    // 크기 강제 — 가장자리 손잡이로 네 방향. 오른쪽=가로(w), 아래=세로(hd),
    // 위=위로 늘림(바닥 고정). 모서리 박스 없이 가장자리만으로 조절한다.
    cornerCheck = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      r.store.commit('강제', () => { it().place.sp = 1; it().place.hd = 20; it().place.x = null; it().place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      const drag = (grip, tx, ty) => {
        const box = grip.getBoundingClientRect();
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        grip.dispatchEvent(new PointerEvent('pointerdown', at(cx, cy)));
        grid.dispatchEvent(new PointerEvent('pointermove', at(cx + tx, cy + ty)));
        grid.dispatchEvent(new PointerEvent('pointerup', at(cx + tx, cy + ty)));
      };
      // 오른쪽 가장자리 → 가로(w)
      const w0 = it().place.w;
      drag(el().querySelector('.grip-he'), -80, 0);
      await new Promise((res) => setTimeout(res, 120));
      const widthChanged = it().place.w != null && it().place.w !== w0;
      // 아래 가장자리 → 세로(hd)
      const hdMid = it().place.hd;
      drag(el().querySelector('.grip'), 0, ppd * 6);
      await new Promise((res) => setTimeout(res, 120));
      const heightChanged = it().place.hd !== hdMid;
      // 위 가장자리 → 위로 늘림(시작일 당겨지고 hd 커짐, 바닥 고정)
      const s0 = it().s, hd0 = it().place.hd;
      drag(el().querySelector('.grip-top'), 0, -ppd * 5);
      await new Promise((res) => setTimeout(res, 120));
      const topGrew = it().place.hd > hd0 && it().s < s0;
      r.store.commit('원복', () => { it().place.hd = null; it().place.x = null; it().place.w = null; it().place.sp = 2; });
      r.board.render();
      return { widthChanged, heightChanged, topGrew };
    })()`), 20000, 'corner');
    console.log('[smoke] resize4 ' + JSON.stringify(cornerCheck));

    // 동일 이벤트 후보 목록 — 모든 단위가 이벤트(§3.2): 카드·트랙·프로젝트가 모두 나온다.
    // 그리고 실제 패널 '동일 카드' 목록이 채워지는지(같은 보드 카드 포함)도 본다.
    sameCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const events = await r.adapter.listEvents();
      const id = r.store.items[0].id;
      document.querySelector('[data-id="' + id + '"]').click();
      await new Promise((res) => setTimeout(res, 350));   // loadCrossBoard 대기
      document.querySelector('#pItem .ptab[data-tab="rel"]').click();
      await new Promise((res) => setTimeout(res, 80));
      const optIds = [...document.querySelectorAll('#i-same .fl-opt')].map((o) => o.dataset.id);
      const homeTrack = r.store.items[0].place.t;
      document.querySelector('#pItem [data-close]').click();
      return {
        count: events.length,
        hasBoard: events.some((e) => e.kind === 'board'),
        hasCard: events.some((e) => e.kind === 'card'),
        hasTrack: events.some((e) => e.kind === 'track'),
        hasBoardIds: events.every((e) => e.boardIds != null),
        pickerOpts: optIds.length,
        ownTrackExcluded: !optIds.includes(homeTrack),   // #4 자기 트랙은 후보에서 빠진다
      };
    })()`);
    console.log('[smoke] same-card ' + JSON.stringify(sameCheck));

    // 조합 피커 — 고른 수와 무관하게 항상 combine(조합)만 만든다. same(동일)은 절대 안 생긴다.
    combineCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = r.store.items[0].id;
        const snapRel = JSON.parse(JSON.stringify(r.store.relations));
        const it0 = r.store.items[0];
        const snap = { ti: it0.ti, s: it0.s, e: it0.e, ty: it0.ty, st: it0.st, og: it0.og, pg: it0.pg, note: it0.note, alias: it0.alias ?? null };
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(80);
        const cntSame = () => r.store.relations.filter((x) => x.type === 'same' && (x.from === id || x.to === id)).length;
        const cntComb = () => r.store.relations.filter((x) => x.type === 'combine' && x.from === id).length;
        const opts = () => [...document.querySelectorAll('#i-same .fl-opt')];
        opts()[0].click(); await sleep(150);
        const one = { same: cntSame(), combine: cntComb() };   // 신선한 1개 = 동일(same)
        opts()[1].click(); await sleep(150);
        const two = { same: cntSame(), combine: cntComb() };   // 2개 = 조합(combine 2)
        const sel = opts().filter((o) => o.getAttribute('aria-selected') === 'true');
        sel[sel.length - 1].click(); await sleep(150);          // 조합 부품 하나 해제 → 남은 것도 조합 부품이라 combine 유지(동일 아님)
        const backToOne = { same: cntSame(), combine: cntComb() };
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('smoke 원복', (doc) => {
          doc.relations = snapRel;
          const it = doc.items.find((x) => x.id === id) || doc.items[0];
          Object.assign(it, snap);
        });
        return { one, two, backToOne };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] combine-map ' + JSON.stringify(combineCheck));

    // 태스크↔하위카드 전환 — id를 유지한 채 순서축 위/아래로 (규칙 5). 진행도 탭 버튼을 누른다.
    xition = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const host = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        const hid = host.id;
        const kid = 'kXITION';
        r.store.commit('smoke 태스크', (doc) => {
          const h = doc.items.find((x) => x.id === hid);
          if (!Array.isArray(h.tasks)) h.tasks = [];
          h.tasks.push({ id: kid, text: '전환테스트', done: false });
        });
        document.querySelector('[data-id="' + hid + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="task"]').click();
        await sleep(80);
        const proms = [...document.querySelectorAll('#i-tasks .task-promote')];
        proms[proms.length - 1].click();
        await sleep(150);
        const asCard = r.store.items.find((x) => x.id === kid);
        const promoted = { isCard: !!asCard, parent: asCard ? asCard.parent : null,
          notTask: !(r.store.item(hid).tasks || []).some((t) => t.id === kid) };
        const dems = [...document.querySelectorAll('#i-children .task-demote')];
        dems[dems.length - 1].click();
        await sleep(150);
        const backTask = (r.store.item(hid).tasks || []).some((t) => t.id === kid);
        const stillCard = !!r.store.items.find((x) => x.id === kid);
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('smoke 원복', (doc) => {
          const h = doc.items.find((x) => x.id === hid);
          if (h) h.tasks = (h.tasks || []).filter((t) => t.id !== kid);
          doc.items = doc.items.filter((x) => x.id !== kid);
        });
        return { promoted, backTask, stillCard };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] task-xition ' + JSON.stringify(xition));

    // 상세 탭 '구성' — 조합한 이벤트마다 그 안의 카드가 자기 그룹에 뜨고(부품별 컨테이너),
    // 하위 카드와 같은 모양이며, 헤더를 눌러 접고 편다.
    progressCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = r.store.items.find((i) => !i.parent).id;
        const home = r.store.item(id).place.t;
        const hasCard = (tid) => r.store.items.some((x) => !x.parent && x.place.t === tid && x.id !== id);
        const others = r.store.tracks.filter((t) => t.id !== home && hasCard(t.id)).slice(0, 2).map((t) => t.id);
        const snap = JSON.parse(JSON.stringify(r.store.relations));
        r.store.commit('smoke 조합', (doc) => {
          doc.relations.push({ id: 'rcx1', type: 'combine', from: id, to: others[0] });
          doc.relations.push({ id: 'rcx2', type: 'combine', from: id, to: others[1] });
        });
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="task"]').click();
        await sleep(120);
        const groups = [...document.querySelectorAll('#i-children .detail-group')];
        await sleep(350);   // eventCards 비동기 대기
        const kidCounts = groups.map((g) => g.querySelectorAll(':scope > .detail-kids > .detail-row').length);
        const eachHasKids = groups.length === 2 && kidCounts.every((n) => n > 0);
        // 첫 그룹 접기 → 자식칸 숨김
        groups[0].querySelector('.detail-parent').click();
        await sleep(60);
        const collapsedHidden = getComputedStyle(groups[0].querySelector(':scope > .detail-kids')).display === 'none';
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('원복', (doc) => { doc.relations = snap; });
        return { groups: groups.length, kidCounts, eachHasKids, collapsedHidden };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] detail ' + JSON.stringify(progressCheck));

    // 걸침 카드에 크기 강제해도 트랙을 넘나든다 — 강제 상태에서 sp=2가 sp=1보다 넓어야.
    spanForce = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const sp0 = it().place.sp, hd0 = it().place.hd;
      const w = () => document.querySelector('[data-id="' + id + '"]').getBoundingClientRect().width;
      const home = r.store.tracks.findIndex((t) => t.id === it().place.t);
      const w0 = r.store.tracks.map((t) => t.w);
      // 걸칠 두 트랙을 고정폭 200으로 (결정적). sp=1 강제 → 한 칸.
      r.store.commit('세팅', () => {
        it().place.hd = 20; it().place.x = null; it().place.w = null; it().place.sp = 1;
        if (r.store.tracks[home]) r.store.tracks[home].w = 200;
        if (r.store.tracks[home + 1]) r.store.tracks[home + 1].w = 200;
      });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const w1 = w();
      // 강제 유지 + sp=2 → 두 칸으로 넓어져야 한다(강제가 걸침을 막지 않음)
      r.store.commit('걸침', () => { it().place.sp = 2; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 200));
      const w2 = w();
      // 강제 카드는 좌우 폭 손잡이로 트랙을 넘나든다(걸침 손잡이 아님).
      const hasWidthGrip = !!document.querySelector('[data-id="' + id + '"] .grip-he');
      r.store.commit('원복', () => {
        it().place.sp = sp0; it().place.hd = hd0;
        r.store.tracks.forEach((t, i) => { t.w = w0[i]; });
      });
      r.board.rebuild();
      return { w1: Math.round(w1), w2: Math.round(w2), spanUnderForce: w2 > w1 + 120, hasWidthGrip };
    })()`);
    console.log('[smoke] span-force ' + JSON.stringify(spanForce));

    // 여백 자르기 — 표시 기간을 일정 범위에 맞춰 맨 뒤 빈 구간을 없앤다
    trim = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      r.store.commit('범위 확장', (doc) => { doc.meta.end = '2027-12-31'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const maxE = r.store.items.reduce((m, i) => ((i.e || i.s) > m ? (i.e || i.s) : m), '0000-00-00');
      const beforeEnd = r.store.meta.end;
      document.getElementById('d-trim').click();
      await new Promise((res) => setTimeout(res, 150));
      const afterEnd = r.store.meta.end;
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { beforeEnd, afterEnd, maxE, trimmed: afterEnd === maxE, shrank: afterEnd < beforeEnd };
    })()`);
    console.log('[smoke] trim ' + JSON.stringify(trim));

    // 낱개 월 높이 조절 — 병합 없이 월 칸 아래 가장자리를 끌면 그 달만 압축된다
    monthResize = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const gutM = document.getElementById('gutM');
      const cell = gutM.querySelector('b:not(.merged)');
      const handle = cell && cell.querySelector('.band-resize');
      if (!handle) return { error: '월 손잡이 없음' };
      const bandsBefore = (r.store.doc.bands ?? []).length;
      const gridH0 = parseFloat(document.getElementById('grid').style.height);
      const box = handle.getBoundingClientRect();
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 1)));
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 - 60)));   // 위로 = 축소
      await new Promise((res) => setTimeout(res, 150));
      gutM.dispatchEvent(new PointerEvent('pointerup', at(box.top + 1 - 60)));
      await new Promise((res) => setTimeout(res, 150));
      const bands = r.store.doc.bands ?? [];
      const created = bands[bands.length - 1];
      const gridH1 = parseFloat(document.getElementById('grid').style.height);
      const made = bands.length === bandsBefore + 1;
      if (made) r.store.commit('정리', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== created.id); });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { made, scale: created?.scale ?? null, shrank: gridH1 < gridH0 };
    })()`), 20000, 'month-resize');
    console.log('[smoke] month-resize ' + JSON.stringify(monthResize));

    // 빈 세로축 날짜 칸 우클릭 → '이 아래 빈 구간 삭제'로 뒤쪽 빈 행을 지운다
    ctxDelete = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      r.store.commit('확장', (doc) => { doc.meta.end = '2027-12-31'; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const cells = [...document.getElementById('gutM').querySelectorAll('b')];
      const cell = cells[cells.length - 1];
      const box = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 5, clientY: box.top + 5 }));
      await new Promise((res) => setTimeout(res, 80));
      const menu = document.querySelector('.ctx-menu');
      const hadMenu = !!menu;
      const btn = menu && [...menu.querySelectorAll('button')].find((b) => b.textContent.includes('빈 구간 삭제'));
      const maxE = r.store.items.reduce((m, i) => ((i.e || i.s) > m ? (i.e || i.s) : m), '0000-00-00');
      if (btn) btn.click();
      await new Promise((res) => setTimeout(res, 150));
      const afterEnd = r.store.meta.end;
      const menuClosed = !document.querySelector('.ctx-menu');
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { hadMenu, hadBtn: !!btn, afterEnd, maxE, trimmed: afterEnd === maxE, menuClosed };
    })()`), 20000, 'ctx-delete');
    console.log('[smoke] ctx-delete ' + JSON.stringify(ctxDelete));

    // 잘라낸 뒤에도 마지막 카드를 아래로 끌면 축이 다시 늘어난다 (빈 구간 복구)
    dragExtend = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      let maxEnd = null;
      for (const it of r.store.items) { const e = it.e || it.s; if (e && (maxEnd === null || e > maxEnd)) maxEnd = e; }
      r.store.commit('맞춤', (doc) => { doc.meta.end = maxEnd; });   // 일정에 딱 맞춰 자른 상태
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const lastId = r.store.items.reduce((a, b) => ((b.e || b.s) > (a.e || a.s) ? b : a)).id;
      const el = () => document.querySelector('[data-id="' + lastId + '"]');
      const beforeE = r.store.item(lastId).e;
      const beforeH = parseFloat(document.getElementById('grid').style.height);
      const grip = el().querySelector('.grip');
      if (!grip) return { error: 'grip 없음' };
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.top + 2 + ppd * 30)));   // 30일 아래로
      await new Promise((res) => setTimeout(res, 150));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.top + 2 + ppd * 30)));
      await new Promise((res) => setTimeout(res, 150));
      const afterE = r.store.item(lastId).e;
      const afterH = parseFloat(document.getElementById('grid').style.height);
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; const it = doc.items.find((i) => i.id === lastId); if (it) it.e = beforeE; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { beforeE, afterE, extended: afterE > beforeE, grewAxis: afterH > beforeH };
    })()`), 20000, 'drag-extend');
    console.log('[smoke] drag-extend ' + JSON.stringify(dragExtend));

    // 다크 테마도 찍는다 — 가이드 적용 결과를 눈으로 봐야 한다
    if (shotDir()) {
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','dark')`,
      );
      await capture(target, 'board-dark');
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','light')`,
      );
    }

    // 상위 카드 안에 든 자식의 가로 폭 조절
    childWidth = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      const host = document.querySelector('[data-id="e10"]');
      if (!host) return { error: '상위 카드 없음' };
      const child = host.querySelector(':scope > .ev:not(.ms)');
      if (!child) return { error: '자식 카드 없음' };
      const id = child.dataset.id;
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const before = Math.round(el().getBoundingClientRect().width);

      const grip = el().querySelector('.grip-he');
      if (!grip) return { error: 'grip-he 없음' };
      const b = grip.getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: b.top + 20, button: 0 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(b.left + 2)));
      // 세 번에 나눠 움직여 중간 재렌더를 견디는지 본다
      for (const dx of [10, 30, 60]) {
        grid.dispatchEvent(new PointerEvent('pointermove', at(b.left + 2 + dx)));
        await new Promise((res) => setTimeout(res, 40));
      }
      grid.dispatchEvent(new PointerEvent('pointerup', at(b.left + 62)));
      await new Promise((res) => setTimeout(res, 150));
      const after = Math.round(el().getBoundingClientRect().width);
      const stored = { x: r.store.item(id).place.x, w: r.store.item(id).place.w };

      window.__childWidthShot = true;
      await new Promise((res) => setTimeout(res, 50));
      // 더블클릭하면 자동 배치로 복귀
      el().querySelector('.grip-he').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 150));
      const reset = r.store.item(id).place.w;

      return { id, before, after, stored, grew: after > before + 40, reset };
    })()`), 20000, 'child-width');
    console.log('[smoke] child-width ' + JSON.stringify(childWidth));
    // 넓힌 상태를 한 번 더 만들어 캡처한다
    if (shotDir()) {
      await target.webContents.executeJavaScript(`(() => {
        const r = window.__roadmap;
        r.store.commit('폭 예시', () => { const it = r.store.item('e11'); it.place.x = 0.02; it.place.w = 0.62; });
      })()`);
      await capture(target, 'child-width');
    }

    // 시간축 구간 묶기 — 2027년 1~3월을 하나로
    banded = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cells = () => [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);
      const before = cells();
      r.store.commit('구간', (doc) => {
        doc.bands.push({ id: 'q1', from: '2027-01-01', to: '2027-03-31', label: '2027 1Q' });
      });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const after = cells();
      const merged = document.querySelectorAll('.gut-m b.merged').length;
      return { before: before.length, after: after.length, merged, labels: after };
    })()`);
    console.log('[smoke] bands ' + JSON.stringify(banded));

    // 묶은 구간 세로 압축 — "접어서 보여 주는 게 목적"
    compressed = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const gridH = () => parseFloat(document.getElementById('grid').style.height);
      const before = gridH();
      const beforeCard = document.querySelector('[data-id="e6"]')?.getBoundingClientRect().height;
      r.store.commit('압축', (doc) => { doc.bands.find((b) => b.id === 'q1').scale = 0.4; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const after = gridH();
      const afterCard = document.querySelector('[data-id="e6"]')?.getBoundingClientRect().height;
      return { before, after, shrank: before > after,
               cardBefore: Math.round(beforeCard ?? 0), cardAfter: Math.round(afterCard ?? 0) };
    })()`);
    console.log('[smoke] compress ' + JSON.stringify(compressed));
    await capture(target, 'board-compressed');
    await capture(target, 'board-bands');

    // 내보내기 — 보드 전체가 한 장으로 나오는지
    exported = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cal = document.querySelector('.cal');
      const before = { w: cal.scrollWidth, h: cal.scrollHeight };
      const mod = await import('./src/ui/export.js');
      await mod.exportPng(r.adapter, r.store);
      await mod.exportPdf(r.adapter, r.store);
      return { boardW: before.w, boardH: before.h,
               restored: !document.body.classList.contains('exporting') };
    })()`), 30000, 'export');
    console.log('[smoke] export ' + JSON.stringify(exported));

    // 이름 변경 — Electron에 prompt()가 없어 직접 만든 다이얼로그를 거친다.
    renamed = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      await r.launcher.show({ closable: true });
      const btn = document.querySelector('.pcard-actions [title="이름 변경"]');
      if (!btn) return { error: '이름 변경 버튼 없음' };
      btn.click();
      await new Promise((res) => setTimeout(res, 120));
      const input = document.querySelector('.dlg input');
      if (!input) return { error: '다이얼로그가 안 떴다 (prompt 대체 실패)' };
      input.value = '이름 변경 테스트';
      document.querySelector('.dlg-actions .cta').click();
      await new Promise((res) => setTimeout(res, 250));
      const list = await r.adapter.listProjects();
      return { name: list[0]?.name, dialogClosed: document.querySelector('.dlg') === null };
    })()`);
    console.log('[smoke] rename ' + JSON.stringify(renamed));

    // 프로젝트가 담긴 목록 화면
    if (shotDir()) {
      await target.webContents.executeJavaScript(
        `window.__roadmap.launcher.show({ closable: true })`,
      );
      await capture(target, 'launcher-filled');
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','dark')`,
      );
      await capture(target, 'launcher-dark');
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','light')`,
      );
      await target.webContents.executeJavaScript(`window.__roadmap.launcher.hide()`);
    }
  } catch (err) {
    result = { error: String(err) };
  }

  console.log('[smoke] render ' + JSON.stringify(result));

  let wrote = null;
  if (!result.error) {
    try {
      const mark = await target.webContents.executeJavaScript(writeProbe);
      // 이벤트는 event(본질) + containment(포함)에 저장된다. 루트→첫 트랙→첫 카드로 내려가
      // 그 본질이 바뀌었는지 본다.
      const row = db.prepare(
        `SELECT e.title FROM board b
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.ordered = 1
         JOIN containment cc ON cc.parent_id = tc.child_id AND cc.ordered = 1
         JOIN event e ON e.id = cc.child_id
         WHERE b.id = ? ORDER BY tc.ord, cc.ord LIMIT 1`,
      ).get(opened.opened);
      wrote = row?.title === mark;
      console.log('[smoke] write round-trip ' + (wrote ? 'ok' : `FAIL (DB=${row?.title})`));
    } catch (err) {
      console.log('[smoke] write FAIL ' + err);
      wrote = false;
    }
  }

  // 이벤트를 보드 밖으로 뺀 핵심 검증 — 같은 이벤트를 두 보드에 두면 본질이 공유되고,
  // 보드를 지워도 이벤트는 남는다 (§3.4·규칙 2). 배치=포함(containment)으로 확인한다.
  let shared = null;
  if (wrote) {
    try {
      const bid = opened.opened;
      const first = db.prepare(
        `SELECT cc.child_id AS id FROM board b
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.ordered = 1
         JOIN containment cc ON cc.parent_id = tc.child_id AND cc.ordered = 1
         WHERE b.id = ? ORDER BY tc.ord, cc.ord LIMIT 1`,
      ).get(bid);
      const eventId = first.id;
      const root2 = 'board:shared-test';
      db.prepare(
        "INSERT OR IGNORE INTO event (id, title, start_date, end_date, type, status, org, progress, note) VALUES (?, '공유 테스트','2026-09-21','2027-04-04','bar','plan','',0,'')",
      ).run(root2);
      const b2 = db.prepare(
        "INSERT INTO board (name, start_date, end_date, doc_version, root_event_id) VALUES ('공유 테스트','2026-09-21','2027-04-04',17, ?)",
      ).run(root2);
      const b2id = Number(b2.lastInsertRowid);
      // 같은 이벤트를 두 번째 보드의 루트 밑에 포함으로도 둔다 (다중 소속)
      db.prepare('INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord) VALUES (?, ?, 1, 0)').run(root2, eventId);
      // 본질을 한 번 바꾸면 두 보드가 함께 반영 (본질은 전역 하나)
      db.prepare("UPDATE event SET status = 'done' WHERE id = ?").run(eventId);
      const st = db.prepare('SELECT status FROM event WHERE id = ?').get(eventId)?.status;
      const places = db.prepare('SELECT count(*) c FROM containment WHERE child_id = ?').get(eventId).c;
      // 보드 삭제 = 배치 삭제. 이벤트는 남아야 한다.
      db.prepare('DELETE FROM containment WHERE parent_id = ?').run(root2);
      db.prepare('DELETE FROM board WHERE id = ?').run(b2id);
      const survives = !!db.prepare('SELECT id FROM event WHERE id = ?').get(eventId);
      shared = st === 'done' && places >= 2 && survives;
      console.log('[smoke] shared-event ' + JSON.stringify({ shared, places, st, survives }));
    } catch (err) { console.log('[smoke] shared-event FAIL ' + err); shared = false; }
  }

  // 보드도 이벤트다 — 각 보드에 루트 이벤트가 있고 그 본질이 보드에 맞춰진다 (§3.2·§5.1)
  let boardEvent = null;
  if (wrote) {
    try {
      const b = db.prepare('SELECT name, root_event_id FROM board WHERE id = ?').get(opened.opened);
      const ev = b?.root_event_id ? db.prepare('SELECT id, title FROM event WHERE id = ?').get(b.root_event_id) : null;
      boardEvent = !!ev && ev.title === b.name;
      console.log('[smoke] board-is-event ' + JSON.stringify({ boardEvent, root: b?.root_event_id, title: ev?.title }));
    } catch (err) { console.log('[smoke] board-is-event FAIL ' + err); boardEvent = false; }
  }

  // 트랙도 이벤트다 — 트랙은 루트의 순서 있는 자식이고, 그 자체가 event다 (§3.2)
  let trackEvent = null;
  if (wrote) {
    try {
      const tr = db.prepare(
        `SELECT tc.child_id AS id, e.title FROM board b
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.ordered = 1
         JOIN event e ON e.id = tc.child_id
         WHERE b.id = ? ORDER BY tc.ord LIMIT 1`,
      ).get(opened.opened);
      trackEvent = !!tr && typeof tr.title === 'string';
      console.log('[smoke] track-is-event ' + JSON.stringify({ trackEvent, event: tr?.id, title: tr?.title }));
    } catch (err) { console.log('[smoke] track-is-event FAIL ' + err); trackEvent = false; }
  }

  // 태스크도 이벤트다 — 순서 없는 포함(ordered=0)의 자식은 type='task' 이벤트다 (§3.2·§3.3)
  let taskEvent = null;
  if (wrote) {
    try {
      const et = db.prepare('SELECT child_id AS id FROM containment WHERE ordered = 0 LIMIT 1').get();
      const ev = et ? db.prepare('SELECT type, title FROM event WHERE id = ?').get(et.id) : null;
      taskEvent = !!ev && ev.type === 'task';
      console.log('[smoke] task-is-event ' + JSON.stringify({ taskEvent, id: et?.id, type: ev?.type }));
    } catch (err) { console.log('[smoke] task-is-event FAIL ' + err); taskEvent = false; }
  }

  // 보드 탭 — 여러 보드를 탭으로 열고 전환/닫기 (#3). 마지막에 둔다(보드를 오가므로).
  let tabsCheck = null;
  if (wrote) {
    tabsCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const b1 = r.adapter.projectId;
        const name1 = r.store.meta.name;
        const id2 = await r.adapter.duplicateProject(b1, '탭 테스트 보드');
        await r.tabs.openBoard(b1); await sleep(200);
        await r.tabs.openBoard(id2); await sleep(300);
        const tabCount = document.querySelectorAll('#tabbar .tab').length;
        const hasAdd = !!document.querySelector('#tabbar .tab-add');
        const name2 = r.store.meta.name;
        document.querySelectorAll('#tabbar .tab')[0].click(); await sleep(300);
        const nameBack = r.store.meta.name;
        r.tabs.boardClosed(id2); await sleep(150);
        const afterClose = document.querySelectorAll('#tabbar .tab').length;
        await r.adapter.deleteProject(id2);
        return { tabCount, hasAdd, name1, name2, nameBack, afterClose };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] tabs ' + JSON.stringify(tabsCheck));
  }

  // 매핑은 관계만 만들고 본질을 복사하지 않는다 — 트랙 이름을 바꿔도 남의 이벤트 제목을
  // 덮지 않는지 확인한다(데이터 보존). same로 묶은 뒤 한쪽 제목을 바꿔도 반대쪽은 그대로여야.
  let nondestr = null;
  if (wrote) {
    nondestr = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const a = r.store.items[0].id;
        const b = r.store.items[1].id;
        const snapRel = JSON.parse(JSON.stringify(r.store.relations));
        const aTi0 = r.store.item(a).ti; const bTi0 = r.store.item(b).ti;
        r.store.commit('smoke same', (doc) => { doc.relations.push({ id: 'r_nd', type: 'same', from: a, to: b }); });
        await sleep(40);
        // same로 이어도 a·b 제목은 그대로여야(덮어쓰기 없음)
        const keptOnLink = r.store.item(a).ti === aTi0 && r.store.item(b).ti === bTi0;
        r.store.commit('smoke rename', (doc) => { doc.items.find((x) => x.id === a).ti = 'ND-CHANGED'; });
        await sleep(40);
        const bUntouched = r.store.item(b).ti === bTi0;   // a를 바꿔도 b는 그대로
        r.store.commit('원복', (doc) => { doc.relations = snapRel; doc.items.find((x) => x.id === a).ti = aTi0; });
        return { keptOnLink, bUntouched };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] non-destructive ' + JSON.stringify(nondestr));
  }

  const ok = !result.error && !opened?.error && !renamed?.error
    && shared === true && boardEvent === true && trackEvent === true && taskEvent === true
    && tabsCheck?.tabCount === 2 && tabsCheck?.hasAdd === true && tabsCheck?.name2 === '탭 테스트 보드'
    && tabsCheck?.nameBack === tabsCheck?.name1 && tabsCheck?.afterClose === 1
    && nondestr?.keptOnLink === true && nondestr?.bUntouched === true
    && relCheck?.allDep === true && relCheck?.added === true && relCheck?.removed === true
    && orderCheck?.topoOk === true && orderCheck?.edges > 0 && orderCheck?.maxRank > 0
    && orderMode?.hasOrderAxis === true && orderMode?.ordered === true && orderMode?.cards > 0 && orderMode?.back === true
    && containCheck?.count > 0 && containCheck?.hasE10 === true && containCheck?.allValid === true
    && taskCheck?.count === 2 && taskCheck?.doneKept === true && taskCheck?.uniqueIds === true && taskCheck?.chip === true
    && idCheck?.n > 0 && idCheck?.allNew === true && idCheck?.unique === true
    && idCheck?.relOk === true && idCheck?.parentOk === true && idCheck?.relKept === true
    && layout?.panelOpen === true && layout?.shrunk > 280 && layout?.selectable === 'text'
    && trackResize?.grew === true && trackResize?.reset === null
    && panelFit?.panelOpen === true && panelFit?.fits === true
    && spanEdit?.adj?.sp === 2 && spanEdit?.adj?.px > spanEdit?.before?.px && spanEdit?.adj?.nodes === 1
    && spanEdit?.far?.gapSelected === false && spanEdit?.far?.nodes === 2
    && newTrack?.after === newTrack?.before + 1 && newTrack?.hasColumn === true
    && newTrack?.drawn === true && spanDrag?.sp === 3
    && edgeDrag?.startMoved === true && edgeDrag?.endMoved === true
    && underflow?.extended === true && underflow?.hasAug === true && underflow?.restored === true
    && madeCards?.clickDays === 7 && madeCards?.dragDays > 7 && madeCards?.restored === true
    && titleWrap?.ws === 'pre-line' && titleWrap?.hasNL === true && titleWrap?.grew === true
    && msRange?.wasPoint === true && msRange?.nowRanged === true && msRange?.grew === true
    && msRange?.backPoint === true
    && topWidth?.shrank === true && topWidth?.hasW === true
    && topWidth?.autoHasSpan === true && topWidth?.autoHasHe === false
    && reorder?.moved === true && reorder?.restored === true
    && delKey?.existsBefore === true && delKey?.survivedWhileTyping === true && delKey?.deleted === true
    && containerAlign?.jc === 'flex-end' && containerAlign?.cBottom === true && containerAlign?.isContainer === true
    && drill?.kids > 0 && drill?.crumbsVisible === true && drill?.childrenShown === true
    && drill?.containerNotTop === true && drill?.restored === true
    && titleFit?.shrank === true && titleFit?.fits === true
    && fixedH?.mapGrew === true && fixedH?.hasTopGrip === true && fixedH?.datesUnchanged === true && fixedH?.dragChanged === true
    && cornerCheck?.widthChanged === true && cornerCheck?.heightChanged === true && cornerCheck?.topGrew === true
    && sameCheck?.count > 0 && sameCheck?.hasBoard === true && sameCheck?.hasCard === true
    && sameCheck?.hasTrack === true && sameCheck?.hasBoardIds === true && sameCheck?.pickerOpts > 0
    && sameCheck?.ownTrackExcluded === true
    && combineCheck?.one?.same === 1 && combineCheck?.one?.combine === 0
    && combineCheck?.two?.same === 0 && combineCheck?.two?.combine === 2
    && combineCheck?.backToOne?.same === 0 && combineCheck?.backToOne?.combine === 1
    && xition?.promoted?.isCard === true && xition?.promoted?.notTask === true
    && xition?.backTask === true && xition?.stillCard === false
    && progressCheck?.eachHasKids === true && progressCheck?.collapsedHidden === true
    && spanForce?.spanUnderForce === true && spanForce?.hasWidthGrip === true
    && trim?.trimmed === true && trim?.shrank === true
    && monthResize?.made === true && monthResize?.scale < 1 && monthResize?.shrank === true
    && ctxDelete?.hadMenu === true && ctxDelete?.hadBtn === true && ctxDelete?.trimmed === true && ctxDelete?.menuClosed === true
    && dragExtend?.extended === true && dragExtend?.grewAxis === true
    && childWidth?.grew === true && childWidth?.reset === null
    && banded?.merged === 1 && banded?.after === banded?.before - 2
    && compressed?.shrank === true && compressed?.cardAfter < compressed?.cardBefore
    && nested?.inside === 6 && nested?.isContainer === true
    && renamed?.name === '이름 변경 테스트' && renamed?.dialogClosed === true
    && opened?.launcherClosed === true
    && opened?.projectsAfter === opened?.projectsBefore + 1
    && result.tracks > 0 && result.cards > 0 && result.items > 0 && wrote === true;
  console.log('[smoke] ' + (ok ? 'PASS' : 'FAIL'));

  const file = resolveDbPath();
  try { db.close(); } catch { /* noop */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });

  app.exit(ok ? 0 : 1);
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
        { role: 'resetZoom', label: '확대 초기화' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
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
async function askSavePath({ title, defaultPath, filters }) {
  if (SMOKE) {
    const dir = shotDir() ?? app.getPath('temp');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, defaultPath);
  }
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title, defaultPath, filters });
  return canceled ? null : filePath;
}

function registerIpc() {
  const guard = (fn) => (...args) => {
    try {
      return { ok: true, data: fn(...args) };
    } catch (err) {
      console.error('[ipc]', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle('db:load', guard(() => repo.load()));
  ipcMain.handle('db:save', guard((_e, doc, label) => { repo.save(doc, label ?? ''); return true; }));

  // 프로젝트
  ipcMain.handle('project:list', guard(() => repo.listProjects()));
  ipcMain.handle('event:list', guard(() => repo.listEvents()));
  ipcMain.handle('project:reorder', guard((_e, ids) => { repo.reorderProjects(ids ?? []); return true; }));
  ipcMain.handle('project:open', guard((_e, id) => {
    repo.open(id);
    repo.touchOpened(id);
    return repo.load();
  }));
  // 활성 보드만 바꾼다(문서는 안 읽음). 탭 캐시에서 즉시 전환할 때 저장 대상을 맞춘다.
  ipcMain.handle('project:select', guard((_e, id) => { repo.open(id); repo.touchOpened(id); return true; }));
  // 한 이벤트가 품은 카드들 — '상세' 탭에서 조합한 이벤트의 안쪽 일정을 펼칠 때.
  ipcMain.handle('event:cards', guard((_e, id) => repo.eventCards(id)));
  ipcMain.handle('project:create', guard((_e, doc, name) => repo.createProject(doc, name)));
  ipcMain.handle('project:rename', guard((_e, id, name) => { repo.renameProject(id, name); return true; }));
  ipcMain.handle('project:duplicate', guard((_e, id, name) => repo.duplicateProject(id, name)));
  ipcMain.handle('project:delete', guard((_e, id) => { repo.deleteProject(id); return true; }));
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
  ipcMain.handle('export:png', async (_e, clip, suggested) => {
    const filePath = await askSavePath({
      title: '보드를 PNG로 내보내기',
      defaultPath: suggested ?? 'roadmap.png',
      filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    });
    if (!filePath) return { ok: false, error: null };

    const wc = win.webContents;
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
  ipcMain.handle('export:pdf', async (_e, size, suggested) => {
    const filePath = await askSavePath({
      title: '보드를 PDF로 내보내기',
      defaultPath: suggested ?? 'roadmap.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!filePath) return { ok: false, error: null };

    try {
      const PX_PER_INCH = 96;
      const margin = 0.2;
      const data = await win.webContents.printToPDF({
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
  ipcMain.handle('file:export', async (_e, json, suggested) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
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

  ipcMain.handle('file:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
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
  if (!SMOKE) adoptLegacyDatabase(file);
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

app.on('before-quit', () => { try { db?.close(); } catch { /* noop */ } });
