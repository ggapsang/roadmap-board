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
  let trackResize = null;
  let spanEdit = null;
  let newTrack = null;
  let spanDrag = null;
  let edgeDrag = null;
  let childWidth = null;
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
    await target.webContents.executeJavaScript(
      `document.querySelector('#pItem [data-close]').click()`,
    );

    // 중첩 — PPT 시안처럼 '1년차 과제 제출용 화면 구성'이 세부 일정을 품는다
    nested = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('중첩', (doc) => {
        const host = doc.items.find((i) => i.id === 'e10');
        host.e = '2026-11-30';
        host.align = 'top';
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

    // 트랙 걸침(sp) — 오른쪽 패널에서 조절되는가
    spanEdit = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      card.click();
      await new Promise((res) => setTimeout(res, 200));
      const input = document.getElementById('i-span');
      const before = { sp: r.store.item(id).sp, px: Math.round(card.getBoundingClientRect().width) };
      input.value = '3';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 200));
      const el = document.querySelector('[data-id="' + id + '"]');
      const after = { sp: r.store.item(id).sp, px: Math.round(el.getBoundingClientRect().width) };
      r.store.commit('원복', () => { r.store.item(id).sp = before.sp; });
      document.querySelector('#pItem [data-close]').click();
      return { before, after, label: document.querySelector('label[for="i-span"]')?.textContent };
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

    // 트랙 걸침 드래그 — 오른쪽 가장자리를 끌면 칸 단위로 붙는가
    spanDrag = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      r.store.commit('초기화', () => { r.store.item(id).sp = 1; });
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
      const sp = r.store.item(id).sp;
      const px = Math.round(el().getBoundingClientRect().width);
      r.store.commit('원복', () => { r.store.item(id).sp = 2; });
      return { sp, px, colW: Math.round(cols[0].width) };
    })()`), 20000, 'span-drag');
    console.log('[smoke] span-drag ' + JSON.stringify(spanDrag));

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
      const stored = { x: r.store.item(id).x, w: r.store.item(id).w };

      window.__childWidthShot = true;
      await new Promise((res) => setTimeout(res, 50));
      // 더블클릭하면 자동 배치로 복귀
      el().querySelector('.grip-he').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 150));
      const reset = r.store.item(id).w;

      return { id, before, after, stored, grew: after > before + 40, reset };
    })()`), 20000, 'child-width');
    console.log('[smoke] child-width ' + JSON.stringify(childWidth));
    // 넓힌 상태를 한 번 더 만들어 캡처한다
    if (shotDir()) {
      await target.webContents.executeJavaScript(`(() => {
        const r = window.__roadmap;
        r.store.commit('폭 예시', () => { const it = r.store.item('e11'); it.x = 0.02; it.w = 0.62; });
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
      const row = db.prepare(
        'SELECT title FROM item WHERE board_id = ? ORDER BY ord LIMIT 1',
      ).get(opened.opened);
      wrote = row?.title === mark;
      console.log('[smoke] write round-trip ' + (wrote ? 'ok' : `FAIL (DB=${row?.title})`));
    } catch (err) {
      console.log('[smoke] write FAIL ' + err);
      wrote = false;
    }
  }

  const ok = !result.error && !opened?.error && !renamed?.error
    && layout?.panelOpen === true && layout?.shrunk > 280 && layout?.selectable === 'text'
    && trackResize?.grew === true && trackResize?.reset === null
    && spanEdit?.after?.sp === 3 && spanEdit?.after?.px > spanEdit?.before?.px
    && newTrack?.after === newTrack?.before + 1 && newTrack?.hasColumn === true
    && newTrack?.drawn === true && spanDrag?.sp === 3
    && edgeDrag?.startMoved === true && edgeDrag?.endMoved === true
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
  ipcMain.handle('project:open', guard((_e, id) => {
    repo.open(id);
    repo.touchOpened(id);
    return repo.load();
  }));
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
    try {
      if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); attached = true; }
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
