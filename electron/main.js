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
      backgroundThrottling: !(SMOKE || REPRO),   // 위와 같은 이유 — 검사 중엔 가려져도 늦추지 않는다
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
  if (REPRO) {
    win.webContents.on('console-message', (e) => {
      const level = ['debug', 'info', 'warn', 'error'][e.level] ?? e.level;
      console.log(`[renderer:${level}] ${e.message}`);
    });
    win.webContents.once('did-finish-load', () => runRepro(win));
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
  let scaleCheck = null;
  let dateless = null;
  let containCheck = null;
  let taskCheck = null;
  let idCheck = null;
  let drill = null;
  let panelFit = null;
  let sameCheck = null;
  let combineCheck = null;
  let renameKeepsCandidates = null;
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

    // 세로축 눈금 모드 (docs/SCALE.md) — 설정 › 표시의 고르기로 바꾼다. 일정 날짜는 그대로, 축만 바뀐다.
    // 구간은 모드마다 따로 기억한다. 눈금 없음은 날짜 표시를 걷고 칸 번호(한 칸 = 전환 전 안쪽 단위).
    scaleCheck = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const sel = document.getElementById('v-scale');
      const pick = async (k) => { sel.value = k; sel.dispatchEvent(new Event('change')); await sleep(200); };
      const dates = () => JSON.stringify(r.store.items.map((i) => [i.id, i.s, i.e]));
      const gutLabels = () => [...document.querySelectorAll('.gut-m b u')].map((u) => u.firstChild?.textContent ?? '');
      const d0 = dates();
      const out = { options: sel.options.length, defaultMode: r.store.meta.display.scale };
      const tl = () => r.board.timeline;
      const span = (p) => tl().newEnd(p) - p + 1;
      // 주-일: 왼쪽 칸 = 주, 한 행 = 하루(행 높이 그대로), 새 일정 1일, 드래그 1일
      await pick('week-day');
      out.weekDay = { outer: /월 \\d주/.test(gutLabels()[0] ?? ''), ppd: r.board.scale.ppd === r.view.weekHeight,
        newLen: span(10), step: tl().step };
      // 분기-월: 왼쪽 칸 = 분기, 새 일정 1개월, 드래그 1주
      await pick('quarter-month');
      const p0 = r.board.timeline.pos(r.store.items.find((i) => !i.parent)).s;
      out.quarter = { outer: /분기/.test(gutLabels()[0] ?? ''), newLen: span(0), step: tl().step,
        snapMonday: new Date(r.board.origin.getTime() + tl().snap(p0 + 3) * 86400000).getDay() === 1 };
      // 구간은 모드마다 — 분기-월에서 묶은 것은 월-주에 안 보인다
      r.store.commit('구간(분기)', (doc) => { doc.bands.push({ id: 'bq', mode: 'quarter-month', from: doc.meta.start, to: doc.meta.start, label: 'QTEST', scale: 1 }); });
      r.board.rebuild(); await sleep(150);
      out.bandHere = gutLabels().includes('QTEST');
      await pick('month-week');
      out.bandElsewhere = gutLabels().includes('QTEST');
      out.monthOuter = /^\\d+월$/.test(gutLabels()[0] ?? '');
      r.store.commit('구간(분기) 치우기', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== 'bq'); });
      // 눈금 없음: 한 칸 = 1주(월-주의 안쪽), 오늘선·바깥 칸 없음, 카드에 칸 번호
      await pick('none');
      const card = document.querySelector('.col > .ev:not(.ms) .dt');
      out.none = { slotUnit: r.store.meta.display.slotUnit, gut: document.querySelectorAll('.gut-m b').length,
        now: !!document.querySelector('.now'), label: card?.textContent ?? '', numbers: /^\\d+$/.test(document.querySelector('.gut-w s')?.textContent ?? '') };
      await pick('month-week');
      out.datesKept = dates() === d0;
      out.back = r.store.meta.display.scale === 'month-week' && document.querySelectorAll('.gut-m b').length > 0;
      return out;
    })()`), 20000, 'scale');
    console.log('[smoke] scale ' + JSON.stringify(scaleCheck));
    // 눈금 모드마다 한 장씩 — 주-일 · 분기-월 · 눈금 없음 (월-주는 'board')
    if (shotDir()) {
      for (const k of ['week-day', 'quarter-month', 'none', 'month-week']) {
        await target.webContents.executeJavaScript(`(async () => {
          const sel = document.getElementById('v-scale');
          sel.value = '${k}'; sel.dispatchEvent(new Event('change'));
          await new Promise((res) => setTimeout(res, 250));
          window.__roadmap.board.scrollToToday(document.getElementById('scroll'));
          return true;
        })()`);
        if (k !== 'month-week') await capture(target, 'scale-' + k);
      }
    }

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
      // 동일·조합은 팝업 버튼(인라인 목록 아님).
      const sameBtn = !!document.querySelector('#i-same button');
      const combBtn = !!document.querySelector('#i-combine button');
      document.querySelector('#pItem [data-close]').click();
      return {
        count: events.length,
        hasBoard: events.some((e) => e.kind === 'board'),
        hasCard: events.some((e) => e.kind === 'card'),
        hasTrack: events.some((e) => e.kind === 'track'),
        hasBoardIds: events.every((e) => e.boardIds != null),
        sameBtn, combBtn,
      };
    })()`);
    console.log('[smoke] same-card ' + JSON.stringify(sameCheck));

    // 매핑 — 동일(합치기)·조합(포함)은 팝업 버튼으로 다룬다(인라인 목록 아님). 실제 트리 팝업·
    // 크로스보드 조합=포함·동일 합치기 왕복은 --repro가 실제 데이터로 검증한다.
    combineCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = r.store.items[0].id;
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(120);
        const sameBtn = !!document.querySelector('#i-same button');
        const combBtn = !!document.querySelector('#i-combine button');
        const noInlineOpts = document.querySelectorAll('#i-same .fl-opt, #i-combine .fl-opt').length === 0;
        document.querySelector('#pItem [data-close]').click();
        return { sameBtn, combBtn, noInlineOpts };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] map-model ' + JSON.stringify(combineCheck));

    // 재현 — 카드 이름을 바꾼 뒤에도 조합·동일 후보(다른 트랙들)가 그대로 떠야 한다.
    renameKeepsCandidates = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const it0 = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        const id = it0.id;
        const snapTi = it0.ti;
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(120);
        const combBefore = document.querySelectorAll('#i-combine .fl-opt').length;
        const sameBefore = document.querySelectorAll('#i-same .fl-opt').length;
        // 이름 변경 — 속성 탭에서 제목 입력 (input 이벤트로 실제 타이핑처럼)
        document.querySelector('#pItem .ptab[data-tab="attr"]').click();
        await sleep(60);
        const ti = document.getElementById('i-title');
        ti.value = snapTi + ' [이름변경]';
        ti.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
        // 다시 매핑 탭으로
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(300);   // loadCrossBoard 재로드 대기
        const combAfter = document.querySelectorAll('#i-combine .fl-opt').length;
        const sameAfter = document.querySelectorAll('#i-same .fl-opt').length;
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('smoke 원복', (doc) => { const it = doc.items.find((x) => x.id === id); if (it) it.ti = snapTi; });
        return { combBefore, combAfter, sameBefore, sameAfter };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] rename-candidates ' + JSON.stringify(renameKeepsCandidates));

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
    // 상세(구성) — 이 이벤트가 품은 하위 이벤트(포함=조합 포함)가 트리로 나오고, 접기 그룹이 접힌다.
    progressCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        // 자식(포함)을 가진 최상위 카드 하나
        const host = r.store.items.find((x) => !x.parent && r.store.items.some((k) => k.parent === x.id));
        if (!host) return { error: 'no container card' };
        document.querySelector('[data-id="' + host.id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="task"]').click();
        await sleep(400);
        const childRows = document.querySelectorAll('#i-children .detail-row').length;
        const groups = [...document.querySelectorAll('#i-children .detail-group')];
        let collapsedHidden = true;
        if (groups.length) {
          groups[0].querySelector('.detail-parent').click();
          await sleep(60);
          collapsedHidden = getComputedStyle(groups[0].querySelector(':scope > .detail-kids')).display === 'none';
        }
        document.querySelector('#pItem [data-close]').click();
        return { childRows, groups: groups.length, showsChildren: childRows > 0, collapsedHidden };
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

    // 분기-월에서 칸 높이 — 한 분기는 기본 3행뿐이라 3배 한도면 좁다. 끄는 만큼 늘어나야 한다.
    monthResize.quarter = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const sel = document.getElementById('v-scale');
      sel.value = 'quarter-month'; sel.dispatchEvent(new Event('change')); await sleep(200);
      const gutM = document.getElementById('gutM');
      const cells = [...gutM.querySelectorAll('b:not(.merged)')];
      const cell = cells.sort((a, b) => (Number(b.dataset.to) - Number(b.dataset.from)) - (Number(a.dataset.to) - Number(a.dataset.from)))[0];
      const handle = cell?.querySelector('.band-resize');
      if (!handle) { sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); return { error: '분기 손잡이 없음' }; }
      const h0 = cell.getBoundingClientRect().height;
      const box = handle.getBoundingClientRect();
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      const before = new Set((r.store.doc.bands ?? []).map((b) => b.id));
      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 1)));
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + 20)));
      await sleep(80);
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + h0 * 7)));   // 8배 높이로
      await sleep(120);
      gutM.dispatchEvent(new PointerEvent('pointerup', at(box.top + 1 + h0 * 7)));
      await sleep(150);
      const made = (r.store.doc.bands ?? []).find((b) => !before.has(b.id));
      const h1 = [...gutM.querySelectorAll('b')].find((c) => c.dataset.band === made?.id)?.getBoundingClientRect().height ?? 0;
      const { prepare } = await import('./src/core/schema.js');
      const kept = prepare(structuredClone(r.store.doc)).doc.bands.find((b) => b.id === made?.id)?.scale ?? null;
      if (made) r.store.commit('정리', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== made.id); });
      sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); await sleep(150);
      return { mode: made?.mode ?? null, scale: made?.scale ?? null, kept, h0: Math.round(h0), h1: Math.round(h1) };
    })()`), 20000, 'quarter-resize');
    console.log('[smoke] quarter-resize ' + JSON.stringify(monthResize.quarter));

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
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.compose = 1
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
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.compose = 1
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
         JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.compose = 1
         JOIN event e ON e.id = tc.child_id
         WHERE b.id = ? ORDER BY tc.ord LIMIT 1`,
      ).get(opened.opened);
      trackEvent = !!tr && typeof tr.title === 'string';
      console.log('[smoke] track-is-event ' + JSON.stringify({ trackEvent, event: tr?.id, title: tr?.title }));
    } catch (err) { console.log('[smoke] track-is-event FAIL ' + err); trackEvent = false; }
  }

  // 태스크도 이벤트다 — 순서 없는 포함(ordered=0, 구성 아님)의 자식은 type='task' 이벤트다 (§3.2·§3.3)
  let taskEvent = null;
  if (wrote) {
    try {
      const et = db.prepare('SELECT child_id AS id FROM containment WHERE ordered = 0 AND compose = 0 LIMIT 1').get();
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

  // 저장 = 보드가 본 것만 고친다 (docs/SAVE.md). 메인에서 저장소를 따로 하나 열어 확인한다 —
  // 탭 캐시 재현 2건, 조합(구성)이 태스크와 따로 저장되는지, 순환 거부, 공유 이벤트를 지키는 보드 삭제,
  // 휴지통(옛 것은 휴지통, 방금 만든 것은 바로 삭제, 구조째, 영구 삭제·비우기), 예시 로드맵 id 충돌.
  let saveModel = null;
  if (wrote) {
    try {
      const { prepare } = await import('../src/core/schema.js');
      const t = new BoardRepository(db);
      const openV = (id) => prepare(t.openView(id)).doc;              // 렌더러가 여는 것과 같게(기준 설정)
      const peek = (id) => { t.open(id); return prepare(t.load()).doc; };  // 기준을 안 건드리는 확인
      const save = (id, doc) => { t.open(id); return t.save(doc, 'smoke'); };
      const has = (id) => !!db.prepare('SELECT 1 FROM event WHERE id = ?').get(id);
      const A = t.createProject(prepare(structuredClone(SMOKE_SEED)).doc, 'S-A');
      const B = t.duplicateProject(A, 'S-B');
      let a = openV(A);
      const seedCollision = !a.items.some((i) => i.id === 'e10');   // 스모크 보드가 이미 e10을 쓴다
      const X = a.items.find((i) => i.ti === '1년차 과제 제출용 화면 구성');
      for (const it of a.items) if (['DT 개발', '3D 모델링'].includes(it.ti)) it.parent = X.id;
      save(A, a);
      const kidsOf = (d) => d.items.filter((i) => i.parent === X.id).length;

      // 재현 1 — 합치기 전의 B 캐시로 저장해도 A의 X 구조가 남고 없앤 Z가 되살아나지 않는다
      const bStale = openV(B);
      const Z = bStale.items.find((i) => !i.parent && i.ty !== 'ms');
      const bOnly = bStale.items.find((i) => i.id !== Z.id && !i.parent && i.ty !== 'ms').id;
      const merged = t.mergeEvents(X.id, Z.id).ok;
      bStale.items.find((i) => i.id === bOnly).note = 'stale';
      save(B, bStale);
      const stale1 = { merged, kids: kidsOf(peek(A)), zGone: !has(Z.id), xOnB: peek(B).items.some((i) => i.id === X.id) };

      // 재현 2 — 공유 X 안에 A에서 하위 추가 → B가 영향받음 표시, 낡은 B 저장이 그 하위를 안 지운다
      a = openV(A);
      const b = openV(B);
      a.items.push({ ...structuredClone(a.items.find((i) => i.id === X.id)), id: 'eSMOKEKID', ti: '공유 하위', parent: X.id, tasks: [] });
      const rA = save(A, a);
      b.items.find((i) => i.id === bOnly).note = 'stale2';
      save(B, b);
      const stale2 = { affectedB: rA.affected.includes(B), kept: db.prepare("SELECT count(*) n FROM containment WHERE child_id = 'eSMOKEKID'").get().n === 1 };

      // 조합(구성) — 다른 보드(B)의 이벤트 둘로 X를 이룬다. 구성으로 저장(태스크 아님), 다시 읽어도 doc.compose.
      // 같은 보드(A)의 이벤트는 조합할 수 없다 — 이미 A의 그래프 안이다(SYSTEM.md §7.1).
      a = openV(A);
      const bNow = peek(B);
      const parts = bNow.items.filter((i) => !i.parent && i.ty !== 'ms' && i.id !== bOnly && !a.items.some((k) => k.id === i.id)).slice(0, 2).map((i) => i.id);
      const sameA = a.items.filter((i) => !i.parent && i.id !== X.id && i.ty !== 'ms').slice(0, 2).map((i) => i.id);
      a.compose = [...(a.compose ?? []), ...parts.map((c) => ({ parent: X.id, child: c })), ...sameA.map((c) => ({ parent: X.id, child: c }))];
      const normalized = prepare(structuredClone(a)).doc;                  // 정규화가 같은 보드 조합을 끊는다
      save(A, a);                                                          // 정규화 없이 저장해도 저장이 뺀다
      const edgesC = db.prepare('SELECT ordered, compose FROM containment WHERE parent_id = ? AND child_id IN (?, ?)').all(X.id, ...parts);
      const back = peek(A);
      const compose = {
        stored: parts.length === 2 && edgesC.length === 2 && edgesC.every((e) => e.compose === 1 && e.ordered === 0),
        inDoc: parts.every((c) => back.compose.some((x) => x.parent === X.id && x.child === c)),
        notTasks: !back.items.find((i) => i.id === X.id).tasks.some((k) => parts.includes(k.id)),
        sameBoardDropped: !normalized.compose.some((x) => sameA.includes(x.child))
          && db.prepare('SELECT count(*) n FROM containment WHERE parent_id = ? AND compose = 1 AND child_id IN (?, ?)').get(X.id, ...sameA).n === 0,
      };
      // 같은 보드 조합이 옛 데이터로 DB에 남아 있으면 그 보드를 저장할 때 걷어 낸다
      db.prepare('INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, compose, ord) VALUES (?, ?, 0, 1, 99)').run(X.id, sameA[0]);
      a = openV(A);
      a.items.find((i) => i.id === X.id).note = 'cleanup';
      save(A, a);
      compose.legacyCleaned = db.prepare('SELECT count(*) n FROM containment WHERE parent_id = ? AND child_id = ?').get(X.id, sameA[0]).n === 0;
      // 보드를 넘는 순환 — X를 품은 A 트랙을, B 카드가 조합으로 품고 그 B 카드를 X가 품으면 순환 → 거부
      const bb = openV(B);
      const loopCard = parts[0];
      bb.compose = [...(bb.compose ?? []), { parent: loopCard, child: a.items.find((i) => i.id === X.id).place.t }];
      compose.cycleRejected = save(B, bb).rejected.length === 1;

      // 보드 삭제 — B에만 있던 것은 지우고, A와 공유한 X와 그 안쪽 구조는 그대로
      const pre = t.deletePreview(B);
      t.deleteProject(B);
      a = peek(A);
      const del = { preShared: pre.shared >= 1, xKept: a.items.some((i) => i.id === X.id), kids: kidsOf(a), bOnlyGone: !has(bOnly) };

      // 휴지통 — 옛 카드를 빼면 휴지통, 방금 만든 카드를 빼면 바로 삭제, 카드를 빼면 구조째
      a = openV(A);
      const old = a.items.find((i) => !i.parent && i.ty !== 'ms' && i.id !== X.id && !parts.includes(i.id) && !a.items.some((k) => k.parent === i.id));
      a.items.push({ ...structuredClone(old), id: 'eSMOKEFRESH', ti: '실수로 만든 것', tasks: [], alias: null });
      save(A, a);
      a.items = a.items.filter((i) => i.id !== old.id && i.id !== 'eSMOKEFRESH');
      save(A, a);
      let trash = t.listTrash();
      const tr = { oldInTrash: trash.some((r) => r.id === old.id), freshGone: !has('eSMOKEFRESH') };
      a = openV(A);
      const inner = a.items.filter((i) => i.parent === X.id).map((i) => i.id);
      a.items = a.items.filter((i) => i.id !== X.id && !inner.includes(i.id));
      save(A, a);
      trash = t.listTrash();
      const xEntry = trash.find((r) => r.id === X.id);
      tr.structure = !!xEntry && xEntry.inside >= inner.length && !trash.some((r) => inner.includes(r.id));
      t.purgeTrash([old.id]);
      tr.purged = !has(old.id);
      t.emptyTrash();
      tr.emptied = t.listTrash().length === 0 && !has(X.id) && inner.every((id) => !has(id));
      t.deleteProject(A);
      const schema = db.pragma('user_version', { simple: true });
      saveModel = { seedCollision, stale1, stale2, compose, del, tr, schema };
      console.log('[smoke] save-model ' + JSON.stringify(saveModel));
    } catch (err) { console.log('[smoke] save-model FAIL ' + (err?.stack ?? err)); saveModel = { error: String(err) }; }
  }

  // 탭 캐시 — 다른 보드의 저장이 이 보드 화면을 바꾸면 그 탭은 '낡음'이 되어 돌아갈 때 다시 읽는다.
  // 날짜 없는 보드 (docs/SCALE.md §2) — 처음부터 눈금 없이 만든다. 일정은 날짜 없이 칸만 갖고(DB NULL),
  // 눈금 설정(일괄)으로 칸마다 날짜를 얻는다.
  if (wrote) {
    // 찍기: 렌더러가 멈춰 기다리는 동안 메인이 캡처한다(한 executeJavaScript 안에서 끊지 않고)
    if (shotDir()) {
      await target.webContents.executeJavaScript(`window.__datelessShot = () => new Promise((res) => { window.__datelessGo = res; }); true`);
      const poll = setInterval(async () => {
        const waiting = await target.webContents.executeJavaScript('typeof window.__datelessGo === "function"').catch(() => false);
        if (!waiting) return;
        clearInterval(poll);
        await capture(target, 'dateless');
        await target.webContents.executeJavaScript('window.__datelessGo(); window.__datelessGo = null; window.__datelessShot = null; true');
      }, 200);
    }
    dateless = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const b1 = r.adapter.projectId;
        const doc = { version: 18, meta: { start: '2026-10-01', end: '2027-03-31', name: '칸 보드',
          display: { scale: 'none', dated: false, slotUnit: null } },
          orgs: ['A'], tracks: [{ id: 't0', lab: '', name: '트랙 1' }], items: [] };
        const b2 = await r.adapter.createProject(doc, '칸 보드');
        await r.tabs.openBoard(b2); await sleep(300);
        const out = { b2, dated: r.board.dated, gutNumbers: document.querySelector('.gut-w s')?.textContent === '1',
          outer: document.querySelectorAll('.gut-m b').length, now: !!document.querySelector('.now') };
        const t0 = r.store.tracks[0].id;
        const a = r.board.createItem(t0, 2);              // 3번 칸에 한 칸
        const b = r.board.createItem(t0, 4, 6);           // 5~7번 칸
        await sleep(500);
        out.aSlot = JSON.stringify(a.place.slot); out.aDate = a.s;
        out.label = document.querySelector('.ev[data-id="' + b.id + '"] .dt')?.textContent ?? '';
        out.slotsHidden = document.getElementById('i-dates').hidden && !document.getElementById('i-slots').hidden;
        out.a = a.id; out.b = b.id;
        window.__datelessShot = window.__datelessShot ?? null;
        if (window.__datelessShot) await window.__datelessShot();
        // 다시 읽어도 칸이 남는다
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
        out.reloaded = JSON.stringify(r.store.item(b.id)?.place?.slot);
        // 눈금 설정 — 1칸 = 1주, 1번 칸 = 2026-10-05(월)
        const { applyCalendar } = await import('./src/core/timeline.js');
        r.store.commit('눈금 설정', (d) => { applyCalendar(d, 'week', '2026-10-05'); });
        await sleep(400);
        const ib = r.store.item(b.id);
        out.cal = { dated: r.store.meta.display.dated, scale: r.store.meta.display.scale, s: ib.s, e: ib.e };
        r.store.undo(); await sleep(400);
        out.undone = r.store.meta.display.dated === false && r.store.item(b.id)?.s == null;
        r.tabs.boardClosed(b2);
        await r.tabs.openBoard(b1); await sleep(200);
        return out;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 25000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    try {
      const row = db.prepare('SELECT start_date, end_date FROM event WHERE id = ?').get(dateless?.a ?? '');
      const disp = db.prepare('SELECT slot_start, slot_len FROM disp WHERE child_id = ?').get(dateless?.b ?? '');
      dateless.db = { nullDates: !!row && row.start_date == null && row.end_date == null, slot: disp ? [disp.slot_start, disp.slot_len] : null };
      await target.webContents.executeJavaScript(`window.__roadmap.adapter.deleteProject(${Number(dateless?.b2) || 0})`);
    } catch (err) { dateless.db = { error: String(err) }; }
    console.log('[smoke] dateless ' + JSON.stringify(dateless));
  }

  let staleTab = null;
  if (wrote) {
    staleTab = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const b1 = r.adapter.projectId;
        const b2 = await r.adapter.duplicateProject(b1, '낡음 테스트');
        await r.tabs.openBoard(b2); await sleep(250);
        const keep = r.store.items.find((x) => !x.parent && x.ty !== 'ms').id;
        await r.tabs.openBoard(b1); await sleep(250);
        const drop = r.store.items.find((x) => !x.parent && x.ty !== 'ms').id;
        const res = await r.adapter.mergeEvents(keep, drop);       // b1 카드를 b2 카드로 합쳐 공유
        r.tabs.markAllStale();
        await r.tabs.reloadActive(); await sleep(150);             // 합치기 뒤 활성 보드를 다시 읽는다(패널과 같은 길)
        await r.tabs.openBoard(b2); await sleep(250);              // b2도 한 번 새로 읽어 둔다
        await r.tabs.openBoard(b1); await sleep(250);
        r.store.commit('공유 편집', (doc) => { const it = doc.items.find((x) => x.id === keep); if (it) it.ti = it.ti + ' ·'; });
        await sleep(250);
        const marked = r.tabs.stale.has(b2);                        // b2가 같은 이벤트를 보고 있다 → 낡음
        await r.tabs.openBoard(b2); await sleep(300);
        const fresh = r.store.items.find((x) => x.id === keep)?.ti.endsWith(' ·') === true;
        const cleared = !r.tabs.stale.has(b2);
        await r.tabs.openBoard(b1); await sleep(200);
        r.store.commit('원복', (doc) => { const it = doc.items.find((x) => x.id === keep); if (it) it.ti = it.ti.replace(/ ·$/, ''); });
        r.tabs.boardClosed(b2);
        await r.adapter.deleteProject(b2);
        return { merged: res?.ok === true, marked, fresh, cleared };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] stale-tab ' + JSON.stringify(staleTab));
  }

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

  // 첫 화면 오른쪽 위 — 그래프 · 테마 · 휴지통 순, 그래프는 첫 화면 위로 열린다
  let launcherGraph = null;
  if (wrote) {
    launcherGraph = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      await r.launcher.show({ closable: true });
      await sleep(150);
      const order = [...document.querySelectorAll('#launcher .lhead .btn.icon')].filter((b) => !b.hidden).map((b) => b.id);
      // 새 보드 — 이름 다음 눈금 고르기. 보기 설명 글자가 상자 밖으로 튀어나오지 않는다(줄바꿈)
      document.getElementById('l-new-blank').click(); await sleep(120);
      document.querySelector('.dlg .btn.cta')?.click(); await sleep(150);          // 이름 '새 보드' 그대로 만들기
      const choices = [...document.querySelectorAll('.dlg-choice')];
      const newBoard = {
        n: choices.length,
        fits: choices.length > 0 && choices.every((c) => {
          const box = c.getBoundingClientRect();
          return c.scrollWidth <= c.clientWidth + 1
            && [...c.children].every((k) => k.getBoundingClientRect().right <= box.right + 0.5);
        }),
      };
      [...document.querySelectorAll('.dlg .btn.outline')].find((x) => x.textContent === '취소')?.click(); await sleep(120);
      newBoard.cancelled = !document.querySelector('.dlg-choice');
      // 도움말 — 팝업, 절마다 목차, 표, 시스템 개념 이야기는 없다, Esc로 닫고 F1로 연다
      document.getElementById('l-help').click();
      for (let i = 0; i < 30 && !document.querySelector('.help-sec h3'); i += 1) await sleep(100);
      const hb = document.querySelector('.help-body');
      const help = {
        sections: document.querySelectorAll('.help-sec').length,
        toc: document.querySelectorAll('.help-toc-item').length,
        tables: document.querySelectorAll('.help-body table').length,
        noSystemTalk: !/순서 기반 이벤트|전개 시스템/.test(hb?.textContent ?? ''),
      };
      // 글자 크기 — 가＋ 두 번, Ctrl - 한 번 = 110%. 보드 글자 크기는 그대로(도움말이 가로챈다)
      const savedHelp = localStorage.getItem('wolfpack:help-view');
      localStorage.removeItem('wolfpack:help-view');
      const zoomBtns = [...document.querySelectorAll('.help-zoom .seg-btn')];
      zoomBtns[1].click();                                         // 원래 크기(100%)부터
      const boardFs = r.store.meta.display.fontScale;
      const px = () => parseFloat(getComputedStyle(hb).fontSize);
      const px0 = px();
      zoomBtns[2].click(); zoomBtns[2].click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }));
      await sleep(50);
      help.fontLabel = document.querySelector('.help-fs').textContent;
      help.fontGrew = Math.abs(px() - px0 * 1.1) < 0.2;
      help.boardFontKept = r.store.meta.display.fontScale === boardFs;
      // 크기 조절 — 모서리를 끌면 커지고, 왼쪽 위 모서리는 제자리
      const dlg = document.querySelector('.help-dlg');
      const grip = document.querySelector('.help-resize');
      const b0 = dlg.getBoundingClientRect();
      const g = grip.getBoundingClientRect();
      const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 13 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(g.left + 5, g.top + 5)));
      window.dispatchEvent(new PointerEvent('pointermove', at(g.left - 95, g.top - 55)));
      window.dispatchEvent(new PointerEvent('pointerup', at(g.left - 95, g.top - 55)));
      await sleep(50);
      const b1 = dlg.getBoundingClientRect();
      help.resized = Math.round(b0.width - b1.width) === 100 && Math.round(b0.height - b1.height) === 60;
      help.cornerKept = Math.abs(b1.left - b0.left) < 1 && Math.abs(b1.top - b0.top) < 1;
      // 크기 조절 뒤 끌어 옮겨도 튀지 않는다(위치를 매번 style에서 읽음)
      const h2 = dlg.querySelector('h2').getBoundingClientRect();
      dlg.querySelector('h2').dispatchEvent(new PointerEvent('pointerdown', at(h2.left + 5, h2.top + 5)));
      window.dispatchEvent(new PointerEvent('pointermove', at(h2.left + 45, h2.top + 25)));
      window.dispatchEvent(new PointerEvent('pointerup', at(h2.left + 45, h2.top + 25)));
      const b2 = dlg.getBoundingClientRect();
      help.moveAfterResize = Math.round(b2.left - b1.left) === 40 && Math.round(b2.top - b1.top) === 20;
      const pref = JSON.parse(localStorage.getItem('wolfpack:help-view') ?? '{}');
      help.remembered = pref.fs === 1.1 && Math.round(pref.w) === Math.round(b1.width);
      if (savedHelp == null) localStorage.removeItem('wolfpack:help-view'); else localStorage.setItem('wolfpack:help-view', savedHelp);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(80);
      help.escClosed = !document.querySelector('.help-scrim');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
      for (let i = 0; i < 20 && !document.querySelector('.help-sec'); i += 1) await sleep(50);
      help.f1 = !!document.querySelector('.help-scrim');
      document.querySelector('.help-scrim')?.remove();
      const boardBefore = r.adapter.projectId;
      const tabsBefore = r.tabs.tabs.length;
      document.getElementById('l-graph').click();
      await sleep(700);
      const gv = document.getElementById('graphView');
      const gTab = r.tabs.tabs.findIndex((t) => t.kind === 'graph');
      const ownTab = gTab >= 0 && r.tabs.active === gTab && r.tabs.tabs[gTab].boardId == null
        && document.querySelectorAll('#tabbar .tab.tab-graph').length === 1 && r.tabs.tabs.length === tabsBefore + 1;
      const shown = !gv.hidden && document.getElementById('launcher').hidden;
      const nodes = document.querySelectorAll('#graphView .gv-node').length;
      // 툴바에서 다시 눌러도 그래프 탭은 하나
      document.getElementById('btnGraph').click();
      await sleep(200);
      const single = r.tabs.tabs.filter((t) => t.kind === 'graph').length === 1;
      // 그래프 탭에선 보드 단축키가 뒤의 보드에 가지 않는다
      const undoBefore = r.store.canUndo;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      const noBoardKeys = r.store.canUndo === undoBefore;
      // 탭 ×로 닫으면 보던 보드 탭으로
      document.querySelector('#tabbar .tab.tab-graph .tab-x').click();
      await sleep(300);
      const closed = gv.hidden && !r.tabs.tabs.some((t) => t.kind === 'graph') && r.adapter.projectId === boardBefore;
      return { newBoard,  order, help, ownTab, shown, nodes, single, noBoardKeys, closed };
    })()`);
    console.log('[smoke] launcher-graph ' + JSON.stringify(launcherGraph));
  }

  // 스타일 탭(채우기·비고 표시) · 매핑 탭(제목·'편집') · 팝업 끌어 옮기기
  let styleUi = null;
  if (wrote) {
    styleUi = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
        const id = it.id;
        const node = () => document.querySelector('.col [data-id="' + id + '"]');
        const noteBefore = it.place.showNote;
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(250);
        const tabName = document.querySelector('#pItem .ptab[data-tab="disp"]').textContent.trim();
        document.querySelector('#pItem .ptab[data-tab="disp"]').click();
        await sleep(80);
        // 채우기 — 파랑
        document.querySelector('#i-fill .fill-sw[data-fill="blue"]').click();
        await sleep(150);
        const filled = node()?.dataset.fill === 'blue' && r.store.item(id).place.fill === 'blue';
        const bg = node() ? getComputedStyle(node()).backgroundImage : '';
        const painted = /gradient/.test(bg);
        // 점 마일스톤·하위 카드도 채우기가 보인다(자체 배경 규칙이 채우기를 덮던 버그)
        const pointMs = r.store.items.find((x) => x.ty === 'ms' && x.s === x.e && !x.parent);
        const childCard = r.store.items.find((x) => x.parent && x.ty !== 'ms');
        r.store.commit('채우기 점검', () => { pointMs.place.fill = 'green'; childCard.place.fill = 'pink'; });
        await sleep(120);
        const painted2 = (el) => !!el && /gradient/.test(getComputedStyle(el).backgroundImage);
        const pmEl = document.querySelector('.col [data-id="' + pointMs.id + '"]');
        const chEl = document.querySelector('[data-id="' + childCard.id + '"]');
        const msFilled = painted2(pmEl);
        const childFilled = painted2(chEl);
        r.store.commit('채우기 점검 원복', () => { pointMs.place.fill = null; childCard.place.fill = null; });
        await sleep(80);
        // 비고 — 기본 숨김, 켜면 카드에
        const hiddenByDefault = noteBefore === false && !node()?.querySelector('.card-note');
        r.store.commit('비고', () => { r.store.item(id).note = '스모크 비고'; });
        await sleep(80);
        document.querySelector('#i-shownote .seg-btn[data-note="on"]').click();
        await sleep(150);
        const noteShown = node()?.querySelector('.card-note')?.textContent === '스모크 비고';
        document.querySelector('#i-shownote .seg-btn[data-note="off"]').click();
        await sleep(120);
        const noteHidden = !node()?.querySelector('.card-note');
        // 매핑 — 제목 4개, 버튼 전부 '편집'
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(300);
        const titles = [...document.querySelectorAll('#pItem .map-title')].map((h) => h.textContent.trim());
        const btns = ['i-same', 'i-combine', 'i-parent', 'i-deps'].map((x) => document.querySelector('#' + x + ' > button.btn')?.textContent.trim());
        // 조합설정 팝업 — 현재 보드의 이벤트는 트리에 나오지 않는다(모순). 다른 보드를 하나 두고 본다.
        const other = await r.adapter.duplicateProject(r.adapter.projectId, '조합 후보 보드');
        document.querySelector('#i-combine > button.btn').click();
        await sleep(600);
        const rowIds = [...document.querySelectorAll('.dlg-tree-row')].map((x) => x.dataset.id);
        const hereIds = new Set([...r.store.tracks.map((t) => t.id), ...r.store.items.map((x) => x.id)]);
        const noCurrentInCombine = rowIds.length > 0 && !rowIds.some((x) => hereIds.has(x));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(100);
        await r.adapter.deleteProject(other);
        // 팝업 — 제목을 잡고 끌면 옮겨지고, 막 위에서 놓아도 닫히지 않는다
        document.querySelector('#i-deps > button.btn').click();
        await sleep(300);
        const box = document.querySelector('.dlg-scrim:not([hidden]) .dlg');
        const h = box.querySelector('h2');
        const b0 = box.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7 });
        h.dispatchEvent(new PointerEvent('pointerdown', at(hr.left + 20, hr.top + 5)));
        window.dispatchEvent(new PointerEvent('pointermove', at(hr.left + 140, hr.top + 85)));
        window.dispatchEvent(new PointerEvent('pointerup', at(hr.left + 140, hr.top + 85)));
        const b1 = box.getBoundingClientRect();
        const moved = Math.round(b1.left - b0.left) === 120 && Math.round(b1.top - b0.top) === 80;
        // 막에서 누르지 않은 클릭(끌기 끝 등)은 닫지 않는다
        const scrim = box.parentElement;
        scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(50);
        const stillOpen = !scrim.hidden && document.body.contains(box);
        // 막에서 누르고 떼면 닫힌다
        scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(50);
        const closedOnScrim = scrim.hidden;
        document.querySelector('#pItem [data-close]')?.click();
        const detailLabel = document.querySelector('#i-children').closest('.fld').querySelector('label').firstChild.textContent.trim();
        const sizeLabel = document.getElementById('i-fixedh').closest('.fld').querySelector('label').textContent.trim();
        const descBlock = getComputedStyle(document.querySelector('#pItem .fld > label .desc')).display === 'block';
        return { id, tabName, filled, painted, msFilled, childFilled, hiddenByDefault, noteShown, noteHidden, titles, btns, moved, stillOpen, closedOnScrim, noCurrentInCombine, detailLabel, sizeLabel, descBlock };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    await new Promise((res) => setTimeout(res, 300));
    // DB 왕복 — 채우기는 배치(disp)에 저장된다
    try {
      const row = db.prepare('SELECT fill FROM disp WHERE child_id = ?').get(styleUi?.id ?? '');
      styleUi.dbFill = row?.fill ?? null;
    } catch (err) { styleUi = { ...(styleUi ?? {}), dbError: String(err) }; }
    console.log('[smoke] style-ui ' + JSON.stringify(styleUi));
  }

  // 모자관계설정 — 부모 설정 / 자식 설정 탭, 같은 트랙 카드만 후보, 자식을 한꺼번에 넣기, 순환 거부
  let parentChild = null;
  if (wrote) {
    parentChild = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const tops = (t) => r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && x.place.t === t && !r.store.items.some((k) => k.parent === x.id));
        const track = r.store.tracks.find((t) => tops(t.id).length >= 3);
        const [host, c1, c2] = tops(track.id);
        document.querySelector('[data-id="' + host.id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(300);
        document.querySelector('#i-parent > button.btn').click();
        await sleep(250);
        const tabs = [...document.querySelectorAll('.dlg-tabs .dlg-tab')].map((b) => b.textContent.replace(/\\s*\\d+$/, '').trim());
        const rowIds = () => [...document.querySelectorAll('.dlg-tree-row')].map((x) => x.dataset.id);
        const inTrack = (id) => id === track.id || r.store.items.some((x) => x.id === id && x.place.t === track.id);
        const childOnlyTrack = rowIds().length > 1 && rowIds().every(inTrack);
        // 자식 설정(처음 탭) — 둘을 체크하고 적용
        for (const id of [c1.id, c2.id]) document.querySelector('.dlg-tree-row[data-id="' + id + '"] input[type=checkbox]').click();
        await sleep(50);
        document.querySelector('.dlg-tab[data-tab="parent"]').click();
        await sleep(100);
        const parentOnlyTrack = rowIds().every(inTrack);
        const radios = document.querySelectorAll('.dlg-tree-row input[type=radio]').length > 0;
        const hostNotParentCandidate = !document.querySelector('.dlg-tree-row[data-id="' + host.id + '"] input');
        [...document.querySelectorAll('.dlg-actions .btn.cta')].pop().click();
        await sleep(200);
        const bulk = [c1.id, c2.id].every((id) => r.store.item(id).parent === host.id);
        const summary = document.querySelectorAll('#i-parent .combine-chip').length === 2;
        // 순환 — 자식(c1)을 열어 host를 자식으로 넣으려 하면 거부(host는 c1의 조상이라 후보에도 없다)
        document.querySelector('[data-id="' + c1.id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(200);
        document.querySelector('#i-parent > button.btn').click();
        await sleep(250);
        const ancestorBlocked = !document.querySelector('.dlg-tree-row[data-id="' + host.id + '"] input');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(100);
        document.querySelector('#pItem [data-close]')?.click();
        r.store.undo();                                  // 원복 — 모자관계 설정은 되돌리기 1단계
        await sleep(150);
        const undone = [c1.id, c2.id].every((id) => !r.store.item(id).parent);
        return { tabs, childOnlyTrack, parentOnlyTrack, radios, hostNotParentCandidate, bulk, summary, ancestorBlocked, undone };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] parent-child ' + JSON.stringify(parentChild));
  }

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
        const noteH = Math.round(document.getElementById('i-note').getBoundingClientRect().height);
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

  // 그래프 뷰 — 개발요청서 5장 완료 판정 1~9. 합성 데이터(메인, 순수 계산) + 실제 화면(렌더러).
  let graphCheck = null;
  if (wrote) {
    try {
      const G = await import('../src/core/graph.js');
      const { GRAPH } = await import('../src/config/index.js');
      // 합성: 루트 둘·3단 포함(구성·순서 있음·순서 없음)·다중 소속·선행 사슬·흐름 교차 순환(선행+원인)·참조 순환
      const events = []; const contain = []; const rels = [];
      const E = (id) => events.push({ id, title: id });
      const C = (pp, c, o = 1, k = 0) => contain.push({ parent_id: pp, child_id: c, ordered: o, compose: k });
      const R = (t, a, b) => rels.push({ id: `${t}${a}${b}`, type: t, from_id: a, to_id: b });
      for (const r of ['B1', 'B2']) { E(r); for (let t = 0; t < 3; t++) { E(`${r}t${t}`); C(r, `${r}t${t}`, 0, 1);
        for (let c = 0; c < 4; c++) { const id = `${r}t${t}c${c}`; E(id); C(`${r}t${t}`, id); if (c) R('dep', `${r}t${t}c${c - 1}`, id);
          for (let k = 0; k < 2; k++) { E(`${id}k${k}`); C(id, `${id}k${k}`, 0); } } } }
      C('B2t0', 'B1t1c1');
      R('cause', 'B1t0c3', 'B1t0c2');
      R('ref', 'B1t2c0', 'B2t2c0'); R('ref', 'B2t2c0', 'B1t2c0');
      const run = (sliders, cfg = GRAPH, data = { events, contain, rels }) => {
        const g = G.buildGraph(data, cfg); G.initialLayout(g, cfg); const sim = G.createSimulation(g, sliders, cfg);
        const ticks = G.settle(sim, 3000); return { g, ticks };
      };
      const pos = (g) => g.nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`).join(';');
      const frac = (g, fam, axis) => { const ls = g.links.filter((l) => l.family === fam && !l.inCycle); return ls.filter((l) => l.target[axis] > l.source[axis]).length / ls.length; };
      const mid = run({ structure: 0.5, flow: 0.5 });
      const c1 = { one: mid.g.nodes.filter((n) => n.id === 'B1t1c1').length === 1,
        twoIn: mid.g.links.filter((l) => l.family === 'contain' && l.to === 'B1t1c1').length === 2 };
      // 2: 두 중력 0 = 방향 중력이 없는 시뮬레이션과 똑같다
      const noDir = structuredClone(GRAPH); for (const f of Object.values(noDir.families)) f.u = null;
      const zero = run({ structure: 0, flow: 0 });
      const c2 = pos(zero.g) === pos(run({ structure: 0, flow: 0 }, noDir).g);
      // 3: 구조만 → 부모가 위, 흐름만 → 앞이 왼쪽
      const c3 = { structure: frac(run({ structure: 1, flow: 0 }).g, 'contain', 'y'), flow: frac(run({ structure: 0, flow: 1 }).g, 'flow', 'x') };
      // 4: 참조는 어느 중력에서도 방향이 없다 — 참조만 있는 그래프는 중력 세기와 무관하게 같은 배치
      const refOnly = { events: events.slice(0, 6), contain: [], rels: [{ id: 'x1', type: 'ref', from_id: events[1].id, to_id: events[2].id }, { id: 'x2', type: 'ref', from_id: events[2].id, to_id: events[1].id }] };
      const c4 = pos(run({ structure: 1, flow: 1 }, GRAPH, refOnly).g) === pos(run({ structure: 0, flow: 0 }, GRAPH, refOnly).g);
      // 5: 흐름 교차 순환이 있어도 수렴하고, 그 엣지는 순환 표시
      const cyc = mid.g.links.filter((l) => l.inCycle).map((l) => l.id).sort();
      const c5 = { converged: mid.ticks < 3000, finite: mid.g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), cyc };
      // 6: 가장 큰 노드 = 하위가 가장 많은 이벤트, 트랙(한 단계 아래)이 보드보다 크지 않다 + 3.1 예시 그대로
      const big = [...mid.g.nodes].sort((a, b) => b.desc - a.desc)[0];
      const ex = G.buildGraph({ events: ['Y1', 'R1', 'R2', 'AT', 'SET', 'VER', 'MON', 'DWG', 'DEL'].map((id) => ({ id })),
        contain: [['Y1', 'R1'], ['Y1', 'R2'], ['R1', 'SET'], ['R1', 'VER'], ['AT', 'SET'], ['SET', 'DWG'], ['SET', 'DEL'], ['R2', 'MON']].map(([a, b]) => ({ parent_id: a, child_id: b, ordered: 1, compose: 0 })), rels: [] });
      const exD = Object.fromEntries(ex.nodes.map((n) => [n.id, [n.desc, Number(n.r.toFixed(1))]]));
      const c6 = { biggest: big.id, boardGeTrack: mid.g.byId.get('B1').r >= mid.g.byId.get('B1t0').r,
        example: JSON.stringify([exD.Y1, exD.R1, exD.AT, exD.SET, exD.R2, exD.VER]) === JSON.stringify([[7, 12.9], [4, 11], [3, 10.2], [2, 9.2], [1, 8], [0, 5]]) };
      // 7: 같은 데이터 → 같은 배치
      const c7 = pos(mid.g) === pos(run({ structure: 0.5, flow: 0.5 }).g);
      // 9: 그래프 코드에 역할 이름 분기가 없다(주석·문자열 빼고)
      const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
      const code = ['src/core/graph.js', 'src/ui/graph.js'].map((f) => strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))).join('\n');
      const c9 = !/\b(track|board|card|task)s?\b|트랙|보드|카드|태스크/i.test(code);
      graphCheck = { c1, c2, c3, c4, c5, c6, c7, c9 };
    } catch (err) { graphCheck = { error: String(err?.stack ?? err) }; }

    // 실제 화면 — 열기·노드 수·재현성·끌기/호버/중력 조절 후 데이터 불변(8)
    const fingerprint = () => JSON.stringify([
      db.prepare('SELECT * FROM event ORDER BY id').all(), db.prepare('SELECT * FROM containment ORDER BY parent_id, child_id').all(),
      db.prepare('SELECT * FROM disp ORDER BY parent_id, child_id').all(), db.prepare('SELECT * FROM rel ORDER BY id').all(),
    ]);
    const before = fingerprint();
    const eventCount = db.prepare('SELECT count(*) n FROM event').get().n;
    const ui = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const savedPref = localStorage.getItem('wolfpack:graph-view');   // 사용자 설정 — 끝나고 되돌린다
        document.getElementById('btnGraph').click();
        const gv = r.graphView;
        for (let i = 0; i < 40 && !gv.graph; i += 1) await sleep(100);
        if (!gv.graph) return { error: 'graph not ready', tabs: JSON.stringify(r.tabs.tabs), active: r.tabs.active, hidden: gv.root.hidden, launcher: r.launcher.visible, count: gv.count.textContent };
        const circles = document.querySelectorAll('#graphView .gv-node').length;
        const ids = [...document.querySelectorAll('#graphView .gv-node')].map((c) => c.dataset.id);
        const uniq = new Set(ids).size === ids.length;
        const posA = gv.graph.nodes.map((n) => n.x.toFixed(3) + ',' + n.y.toFixed(3)).join(';');
        const edgeLabelsIdle = document.querySelectorAll('#graphView .gv-edge-label').length;
        const arrows = [...document.querySelectorAll('#graphView .gv-link')].every((p) => /url\\(#gv-arrow-/.test(p.getAttribute('marker-end')));
        // 호버 — 이어진 엣지에만 라벨, 배치는 그대로
        const big = [...gv.graph.nodes].sort((a, b) => b.degree - a.degree)[0];
        const bx = big.x, by = big.y;
        const el = document.querySelector('#graphView .gv-node[data-id="' + big.id + '"]');
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        await sleep(80);
        const hoverLabels = document.querySelectorAll('#graphView .gv-edge-label').length;
        const hoverKeptLayout = big.x === bx && big.y === by;
        // 끌기 — 놓으면 고정이 풀린다
        const b = el.getBoundingClientRect();
        const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 11 });
        el.dispatchEvent(new PointerEvent('pointerdown', at(b.left + b.width / 2, b.top + b.height / 2)));
        window.dispatchEvent(new PointerEvent('pointermove', at(b.left + 120, b.top + 60)));
        await sleep(100);
        const pinned = big.fx != null;
        window.dispatchEvent(new PointerEvent('pointerup', at(b.left + 120, b.top + 60)));
        const released = big.fx == null && big.fy == null;
        // 중력 조절
        const slider = document.querySelector('#graphView .gv-slider input');
        const slider0 = slider.value;                        // 사용자가 정해 둔 값일 수 있다 — 그대로 되돌린다
        slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        slider.value = slider0; slider.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
        // 다시 열면 같은 배치(결정적)
        r.tabs.closeTab(r.tabs.tabs.findIndex((t) => t.kind === 'graph')); await sleep(150);
        document.getElementById('btnGraph').click();
        for (let i = 0; i < 40 && !gv.graph; i += 1) await sleep(100);
        const posB = gv.graph.nodes.map((n) => n.x.toFixed(3) + ',' + n.y.toFixed(3)).join(';');
        const hasStorage = !!localStorage.getItem('wolfpack:graph-view');
        if (savedPref == null) localStorage.removeItem('wolfpack:graph-view'); else localStorage.setItem('wolfpack:graph-view', savedPref);
        const nodeCount = gv.graph.nodes.length;             // 탭을 닫으면 그래프가 비워진다(다음엔 처음부터)
        r.tabs.closeTab(r.tabs.tabs.findIndex((t) => t.kind === 'graph'));
        await sleep(150);
        return { nodes: nodeCount, circles, uniq, edgeLabelsIdle, arrows, hoverLabels, hoverKeptLayout, pinned, released, sameReopen: posA === posB, closed: document.getElementById('graphView').hidden, hasStorage };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    await new Promise((res) => setTimeout(res, 300));
    graphCheck = { ...graphCheck, ui: { ...ui, eventCount, c8unchanged: fingerprint() === before } };
    console.log('[smoke] graph ' + JSON.stringify(graphCheck));
  }

  // 스타일·매핑 탭 모습 — --shot일 때만 (라이트·다크). 카드 몇 장에 채우기를 입혀 본다.
  if (wrote && shotDir()) {
    const show = (tab, theme) => target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const keys = ['gray', 'red', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
      const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
      r.store.commit('shot 채우기', () => { cards.slice(0, keys.length).forEach((c, i) => { c.place.fill = keys[i]; }); });
      document.querySelector('[data-id="' + cards[0].id + '"]').click();
      await sleep(250);
      document.querySelector('#pItem .ptab[data-tab="' + ${JSON.stringify(tab)} + '"]').click();
      await sleep(350);
      return true;
    })()`);
    for (const theme of ['light', 'dark']) {
      await show('disp', theme); await capture(target, `style-tab-${theme}`);
      await show('rel', theme); await capture(target, `map-tab-${theme}`);
    }
    await show('attr', 'light'); await capture(target, 'attr-tab-light');
    await show('task', 'light'); await capture(target, 'task-tab-light');
    await show('rel', 'light');
    await target.webContents.executeJavaScript(`(async () => { document.querySelector('#i-parent > button.btn').click(); await new Promise((r) => setTimeout(r, 300)); return true; })()`);
    await capture(target, 'parent-child-popup');
    await target.webContents.executeJavaScript(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true })); await new Promise((r) => setTimeout(r, 600)); return true; })()`);
    await capture(target, 'help-popup');
    await target.webContents.executeJavaScript(`(() => { document.querySelector('.help-scrim')?.remove(); return true; })()`);
    for (const theme of ['light', 'dark']) {
      await target.webContents.executeJavaScript(`(async () => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 100)); document.getElementById('btnGraph').click(); await new Promise((r) => setTimeout(r, 700)); return true; })()`);
      await capture(target, `graph-${theme}`);
      await target.webContents.executeJavaScript(`(async () => { const gv = window.__roadmap.graphView; const big = [...gv.graph.nodes].sort((a, b) => b.degree - a.degree)[0]; document.querySelector('#graphView .gv-node[data-id="' + big.id + '"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await new Promise((r) => setTimeout(r, 120)); return true; })()`);
      await capture(target, `graph-hover-${theme}`);
      await target.webContents.executeJavaScript(`(() => { const t = window.__roadmap.tabs; t.closeTab(t.tabs.findIndex((x) => x.kind === 'graph')); return true; })()`);
    }
    await target.webContents.executeJavaScript(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await target.webContents.executeJavaScript(`(() => {
      const r = window.__roadmap;
      r.store.commit('shot 원복', () => { for (const c of r.store.items) c.place.fill = null; });
      delete document.documentElement.dataset.theme;
      document.querySelector('#pItem [data-close]')?.click();
      return true;
    })()`);
  }

  const ok = !result.error && !opened?.error && !renamed?.error
    && shared === true && boardEvent === true && trackEvent === true && taskEvent === true
    && tabsCheck?.tabCount === 2 && tabsCheck?.hasAdd === true && tabsCheck?.name2 === '탭 테스트 보드'
    && tabsCheck?.nameBack === tabsCheck?.name1 && tabsCheck?.afterClose === 1
    && saveModel?.seedCollision === true && saveModel?.schema === 21
    && saveModel?.stale1?.merged === true && saveModel?.stale1?.kids === 2 && saveModel?.stale1?.zGone === true && saveModel?.stale1?.xOnB === true
    && saveModel?.stale2?.affectedB === true && saveModel?.stale2?.kept === true
    && saveModel?.compose?.stored === true && saveModel?.compose?.inDoc === true && saveModel?.compose?.notTasks === true
    && saveModel?.compose?.sameBoardDropped === true && saveModel?.compose?.legacyCleaned === true && saveModel?.compose?.cycleRejected === true
    && saveModel?.del?.preShared === true && saveModel?.del?.xKept === true && saveModel?.del?.kids >= 2 && saveModel?.del?.bOnlyGone === true
    && saveModel?.tr?.oldInTrash === true && saveModel?.tr?.freshGone === true && saveModel?.tr?.structure === true
    && saveModel?.tr?.purged === true && saveModel?.tr?.emptied === true
    && staleTab?.merged === true && staleTab?.marked === true && staleTab?.fresh === true && staleTab?.cleared === true
    && trashUi?.leftBoard === true && trashUi?.btnShown === true && trashUi?.listed === true
    && JSON.stringify(launcherGraph?.order) === JSON.stringify(['l-help', 'l-graph', 'l-theme', 'l-trash', 'l-close'])
    && launcherGraph?.help?.sections >= 8 && launcherGraph?.help?.toc === launcherGraph?.help?.sections - 1
    && launcherGraph?.help?.tables >= 3 && launcherGraph?.help?.noSystemTalk === true && launcherGraph?.help?.escClosed === true
    && launcherGraph?.help?.f1 === true
    && launcherGraph?.newBoard?.n === 4 && launcherGraph?.newBoard?.fits === true && launcherGraph?.newBoard?.cancelled === true
    && launcherGraph?.help?.fontLabel === '110%' && launcherGraph?.help?.fontGrew === true && launcherGraph?.help?.boardFontKept === true
    && launcherGraph?.help?.resized === true && launcherGraph?.help?.cornerKept === true && launcherGraph?.help?.moveAfterResize === true
    && launcherGraph?.help?.remembered === true
    && launcherGraph?.ownTab === true && launcherGraph?.shown === true && launcherGraph?.nodes > 0
    && launcherGraph?.single === true && launcherGraph?.noBoardKeys === true && launcherGraph?.closed === true
    && trashUi?.asked === true && trashUi?.gone === true && trashUi?.purged === true && trashUi?.closed === true
    && styleUi?.tabName === '스타일' && styleUi?.filled === true && styleUi?.painted === true && styleUi?.msFilled === true && styleUi?.childFilled === true && styleUi?.dbFill === 'blue'
    && styleUi?.hiddenByDefault === true && styleUi?.noteShown === true && styleUi?.noteHidden === true
    && JSON.stringify(styleUi?.titles) === JSON.stringify(['항등설정', '조합설정', '모자관계설정', '선행관계설정'])
    && (styleUi?.btns ?? []).length === 4 && styleUi.btns.every((t) => t === '편집')
    && styleUi?.moved === true && styleUi?.stillOpen === true && styleUi?.closedOnScrim === true
    && JSON.stringify(parentChild?.tabs) === JSON.stringify(['부모 설정', '자식 설정'])
    && parentChild?.childOnlyTrack === true && parentChild?.parentOnlyTrack === true && parentChild?.radios === true
    && parentChild?.hostNotParentCandidate === true && parentChild?.bulk === true && parentChild?.summary === true
    && parentChild?.ancestorBlocked === true && parentChild?.undone === true
    && tabUi?.boardTabsMoved === true && tabUi?.activeKept === true && tabUi?.noTextSelected === true && tabUi?.noteH === 565
    && tabUi?.panelTabsMoved === true && tabUi?.dragDidNotSelect === true && tabUi?.tabKept === true && tabUi?.restored === true
    && graphCheck?.c1?.one === true && graphCheck?.c1?.twoIn === true && graphCheck?.c2 === true
    && graphCheck?.c3?.structure >= 0.95 && graphCheck?.c3?.flow >= 0.95 && graphCheck?.c4 === true
    && graphCheck?.c5?.converged === true && graphCheck?.c5?.finite === true && graphCheck?.c5?.cyc?.length === 2
    && graphCheck?.c6?.biggest?.startsWith('B') && graphCheck?.c6?.biggest?.length === 2 && graphCheck?.c6?.boardGeTrack === true && graphCheck?.c6?.example === true
    && graphCheck?.c7 === true && graphCheck?.c9 === true
    && graphCheck?.ui?.nodes === graphCheck?.ui?.eventCount && graphCheck?.ui?.circles === graphCheck?.ui?.nodes && graphCheck?.ui?.uniq === true
    && graphCheck?.ui?.edgeLabelsIdle === 0 && graphCheck?.ui?.arrows === true && graphCheck?.ui?.hoverLabels > 0 && graphCheck?.ui?.hoverKeptLayout === true
    && graphCheck?.ui?.pinned === true && graphCheck?.ui?.released === true && graphCheck?.ui?.sameReopen === true && graphCheck?.ui?.closed === true
    && graphCheck?.ui?.c8unchanged === true
    && styleUi?.noCurrentInCombine === true && styleUi?.detailLabel === '세부내역' && styleUi?.sizeLabel === '사이즈 수동 설정' && styleUi?.descBlock === true
    && relCheck?.allDep === true && relCheck?.added === true && relCheck?.removed === true
    && scaleCheck?.options === 4 && scaleCheck?.defaultMode === 'month-week'
    && scaleCheck?.weekDay?.outer === true && scaleCheck?.weekDay?.ppd === true && scaleCheck?.weekDay?.newLen === 1 && scaleCheck?.weekDay?.step === 'day'
    && scaleCheck?.quarter?.outer === true && scaleCheck?.quarter?.newLen >= 28 && scaleCheck?.quarter?.newLen <= 31
    && scaleCheck?.quarter?.step === 'week' && scaleCheck?.quarter?.snapMonday === true
    && scaleCheck?.bandHere === true && scaleCheck?.bandElsewhere === false && scaleCheck?.monthOuter === true
    && scaleCheck?.none?.slotUnit === 'week' && scaleCheck?.none?.gut === 0 && scaleCheck?.none?.now === false
    && /^칸 \d/.test(scaleCheck?.none?.label ?? '') && scaleCheck?.none?.numbers === true
    && scaleCheck?.datesKept === true && scaleCheck?.back === true
    && (!wrote || (dateless?.dated === false && dateless?.gutNumbers === true && dateless?.outer === 0 && dateless?.now === false
      && dateless?.aSlot === '{"s":2,"len":1}' && dateless?.aDate == null && dateless?.label === '칸 5–7'
      && dateless?.slotsHidden === true && dateless?.reloaded === '{"s":4,"len":3}'
      && dateless?.cal?.dated === true && dateless?.cal?.scale === 'month-week'
      && dateless?.cal?.s === '2026-11-02' && dateless?.cal?.e === '2026-11-22' && dateless?.undone === true
      && dateless?.db?.nullDates === true && dateless?.db?.slot?.[0] === 4 && dateless?.db?.slot?.[1] === 3))
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
    && sameCheck?.hasTrack === true && sameCheck?.hasBoardIds === true
    && sameCheck?.sameBtn === true && sameCheck?.combBtn === true
    && combineCheck?.sameBtn === true && combineCheck?.combBtn === true && combineCheck?.noInlineOpts === true
    && xition?.promoted?.isCard === true && xition?.promoted?.notTask === true
    && xition?.backTask === true && xition?.stillCard === false
    && progressCheck?.showsChildren === true && progressCheck?.collapsedHidden === true
    && spanForce?.spanUnderForce === true && spanForce?.hasWidthGrip === true
    && trim?.trimmed === true && trim?.shrank === true
    && monthResize?.made === true && monthResize?.scale < 1 && monthResize?.shrank === true
    && monthResize?.quarter?.mode === 'quarter-month' && monthResize?.quarter?.scale > 3
    && monthResize?.quarter?.kept === monthResize?.quarter?.scale && monthResize?.quarter?.h1 > monthResize?.quarter?.h0 * 3
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

/** --repro : 실제 데이터에서 조합(구성)·합치기·복사붙여넣기 왕복 점검. 반드시 DB 복사본으로. */
async function runRepro(target) {
  const boardId = (() => { const i = process.argv.indexOf('--board'); return i >= 0 ? Number(process.argv[i + 1]) : 1; })();
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
  // 저장은 바뀐 것만 적용한다(docs/SAVE.md). 영향받은 다른 보드·순환이라 넣지 않은 간선을 돌려준다.
  ipcMain.handle('db:save', guard((_e, doc, label) => repo.save(doc, label ?? '')));

  // 프로젝트
  ipcMain.handle('project:list', guard(() => repo.listProjects()));
  ipcMain.handle('event:list', guard(() => repo.listEvents()));
  ipcMain.handle('project:reorder', guard((_e, ids) => { repo.reorderProjects(ids ?? []); return true; }));
  // 렌더러가 보드를 연다 — 받은 문서가 그 보드의 저장 기준이 된다(docs/SAVE.md §3).
  ipcMain.handle('project:open', guard((_e, id) => repo.openView(id)));
  // 활성 보드만 바꾼다(문서는 안 읽음). 탭 캐시에서 즉시 전환할 때 저장 대상을 맞춘다.
  ipcMain.handle('project:select', guard((_e, id) => { repo.open(id); repo.touchOpened(id); return true; }));
  // 한 이벤트가 품은 카드들 — '상세' 탭에서 조합한 이벤트의 안쪽 일정을 펼칠 때.
  ipcMain.handle('event:cards', guard((_e, id) => repo.eventCards(id)));
  // 이벤트 몇 개의 본질 · 조상(조합 대상에서 빼야 순환이 안 생긴다)
  ipcMain.handle('event:get', guard((_e, ids) => repo.eventsById(ids)));
  // 그래프 뷰 — 이벤트·포함·관계 전체(읽기 전용)
  ipcMain.handle('graph:data', guard(() => repo.graphData()));
  ipcMain.handle('event:ancestors', guard((_e, id) => repo.ancestorsOf(id)));
  // 휴지통 — 부모를 모두 잃은 이벤트 (docs/SAVE.md §7)
  ipcMain.handle('trash:list', guard(() => repo.listTrash()));
  ipcMain.handle('trash:purge', guard((_e, ids) => repo.purgeTrash(ids ?? [])));
  ipcMain.handle('trash:empty', guard(() => repo.emptyTrash()));
  // 동일 매핑 = 두 이벤트를 하나로 합치기(§7.2). 되돌리기 스냅샷을 돌려준다.
  ipcMain.handle('event:merge', guard((_e, keepId, dropId) => repo.mergeEvents(keepId, dropId)));
  ipcMain.handle('event:unmerge', guard((_e, snapshot) => repo.unmergeEvents(snapshot)));
  ipcMain.handle('project:create', guard((_e, doc, name) => repo.createProject(doc, name)));
  ipcMain.handle('project:rename', guard((_e, id, name) => { repo.renameProject(id, name); return true; }));
  ipcMain.handle('project:duplicate', guard((_e, id, name) => repo.duplicateProject(id, name)));
  ipcMain.handle('project:delete', guard((_e, id) => { repo.deleteProject(id); return true; }));
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

app.on('before-quit', () => { try { db?.close(); } catch { /* noop */ } });
