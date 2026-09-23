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

  win.once('ready-to-show', () => { if (!SMOKE || shotDir()) win.show(); });
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
  let nested = null;
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
    await capture(target, 'board-bands');

    // 내보내기 — 보드 전체가 한 장으로 나오는지
    exported = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cal = document.querySelector('.cal');
      const before = { w: cal.scrollWidth, h: cal.scrollHeight };
      const mod = await import('./src/ui/export.js');
      await mod.exportPng(r.adapter, r.store);
      await mod.exportPdf(r.adapter, r.store);
      return { boardW: before.w, boardH: before.h,
               restored: !document.body.classList.contains('exporting') };
    })()`);
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
    && layout?.panelOpen === true && layout?.shrunk === 340 && layout?.selectable === 'text'
    && banded?.merged === 1 && banded?.after === banded?.before - 2
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
