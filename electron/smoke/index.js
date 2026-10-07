/**
 * 스모크 — 창을 띄워 실제 화면으로 점검하고 종료한다 (npm test).
 *
 * 기본 점검(첫 화면 · 프로젝트 만들어 열기 · 렌더 · 저장 왕복)은 늘 돌고, 그 뒤 단계(steps/*.js)는 **고친 코드에 닿는 것만** 돈다.
 *   npm test                      git이 보는 바뀐 파일(커밋 전 수정·새 파일) → 그 영역(areas)의 단계만
 *   npm test -- --since <ref>     <ref> 이후 바뀐 파일까지 더해서 (예: --since origin/main, --since HEAD~3)
 *   npm test -- --only a,b        이름으로 고른 단계만 (이름은 --list)
 *   npm test -- --all             전부 (npm run test:all). --shot, 설치판(git 없음)도 전부
 *   npm test -- --list            단계 이름·영역만 보여 주고 끝
 * 공용 코드(GLOBAL — 상태·스키마·부팅·토큰 등)를 고쳤거나, 어느 영역에도 없는 소스 파일을 고쳤으면 전부 돈다(모르면 다 본다).
 *
 * 단계 하나 = steps/NNN-이름.js 한 파일: { name, areas, requires?, run(ctx) → 결과, check(결과) → 통과 여부 }. 번호 순서로 돈다.
 * 단계는 서로의 결과값에 기대지 않는다. 앞 단계가 만든 **문서 구조**(예: nesting이 만든 상위 카드)가 있어야 하면 requires에
 * 그 단계 이름을 적는다 — 고른 단계에 필요한 단계를 앞에 더해 돈다. 그 밖엔 혼자 돌아도 통과해야 한다(고친 상태는 단계 안에서 원복).
 * 새 기능의 점검을 넣을 땐 단계 파일을 하나 더하고, 그 기능의 소스가 어느 영역인지 areas에 적는다. 새 소스 파일은 AREAS에.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SEED as SMOKE_SEED } from '../../src/config/seed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPS_DIR = path.join(HERE, 'steps');

/** 영역 → 그 영역의 소스(앞부분이 같으면 해당). 단계는 자기가 점검하는 영역을 areas로 적는다. */
export const AREAS = {
  board: ['src/ui/board/index.js', 'src/ui/board/card.js', 'src/ui/board/head.js', 'src/core/layout.js', 'src/styles/board.css',
    'src/ui/statusbar.js', 'src/ui/toolbar.js', 'src/styles/toolbar.css', 'src/ui/components/'],
  axis: ['src/ui/board/axis.js', 'src/ui/board/bands.js', 'src/core/timeline.js', 'src/core/timescale.js', 'src/core/dates.js'],
  drag: ['src/ui/board/drag.js'],
  arrows: ['src/ui/board/arrows.js', 'src/core/arrow-geometry.js'],
  panel: ['src/ui/panels/item.js', 'src/ui/panels/manager.js', 'src/ui/combine.js', 'src/ui/dialog.js', 'src/styles/panel.css'],
  note: ['src/ui/noteEditor.js', 'src/ui/markdown.js'],
  config: ['src/ui/panels/config.js'],
  data: ['src/ui/panels/data.js', 'src/ui/export.js', 'src/styles/print.css'],
  ctxmenu: ['src/ui/ctxmenu.js'],
  tabs: ['src/ui/tabs.js', 'src/ui/reorder.js', 'src/styles/tabs.css'],
  launcher: ['src/ui/launcher.js', 'src/ui/trash.js', 'src/ui/help.js', 'src/ui/theme.js', 'docs/HELP.md', 'src/styles/launcher.css'],
  graph: ['src/core/graph.js', 'src/ui/graph.js', 'src/styles/graph.css'],
  db: ['electron/db/', 'src/core/storage.js'],
  memo: ['src/ui/board/memos.js'],
};

/** 모든 단계가 기대는 공용 코드 — 여기를 고치면 전부 돈다 */
const GLOBAL = ['src/core/store.js', 'src/core/schema.js', 'src/core/view.js', 'src/core/emitter.js', 'src/main.js',
  'src/ui/dom.js', 'src/ui/toast.js', 'index.html', 'src/styles/base.css', 'src/styles/index.css', 'src/styles/tokens.css',
  'src/config/', 'electron/main.js', 'electron/preload.cjs', 'electron/smoke/index.js', 'package.json'];

/** 이 밖(문서·스크립트·빌드·참고 자료)은 앱 동작과 무관 — 고쳐도 단계를 고르지 않는다. 이 안인데 어느 영역에도 없으면 전부. */
const SOURCE = ['src/', 'electron/', 'index.html', 'package.json', 'docs/HELP.md'];

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
};
const has = (name) => process.argv.includes(name);
const under = (file, prefixes) => prefixes.some((p) => file === p || (p.endsWith('/') && file.startsWith(p)));

/** 한 단계가 매달리면 전체가 멈춘다. 시간 제한을 걸고 넘어간다. */
export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms}ms)`)), ms)),
  ]);
}

export async function loadSteps() {
  const files = fs.readdirSync(STEPS_DIR).filter((f) => /^\d+-.+\.js$/.test(f)).sort();
  const steps = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(STEPS_DIR, f)).href);
    steps.push({ ...mod.default, file: f });
  }
  return steps;
}

/** git이 보는 바뀐 파일(작업 트리·스테이징·새 파일 + --since 이후 커밋). git이 없으면 null(= 전부). */
function changedFiles(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const out = new Set();
    for (const line of git('status', '--porcelain', '-uall').split('\n')) {
      if (!line.trim()) continue;
      const p = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '');
      out.add(p.replace(/\\/g, '/'));
    }
    const since = arg('--since');
    if (since) for (const p of git('diff', '--name-only', since).split('\n')) if (p.trim()) out.add(p.trim());
    return [...out];
  } catch {
    return null;
  }
}

/** 고를 단계와 그 까닭. files를 주면 git 대신 그것을 바뀐 파일로 본다(실행기 점검용). */
export function selectSteps(steps, { root, packaged, shot, files: given = null }) {
  const real = steps.filter((s) => !s.shotOnly || shot);
  if (has('--only')) {
    const names = new Set(arg('--only').split(',').map((s) => s.trim()).filter(Boolean));
    const unknown = [...names].filter((n) => !steps.some((s) => s.name === n));
    if (unknown.length) console.log('[smoke] 모르는 단계: ' + unknown.join(', ') + ' (npm test -- --list)');
    return { picked: steps.filter((s) => names.has(s.name)), why: `--only ${[...names].join(',')}` };
  }
  if (has('--all')) return { picked: real, why: '--all' };
  if (shot) return { picked: real, why: '--shot(화면 캡처는 전부)' };
  if (packaged) return { picked: real, why: '설치판(git 없음)' };
  const files = given ?? changedFiles(root);
  if (!files) return { picked: real, why: 'git을 읽지 못함' };
  const src = files.filter((f) => under(f, SOURCE) && !f.startsWith('electron/smoke/steps/'));
  const stepEdits = files.filter((f) => f.startsWith('electron/smoke/steps/')).map((f) => path.basename(f));
  const global = src.filter((f) => under(f, GLOBAL));
  const loose = src.filter((f) => !under(f, GLOBAL) && !Object.values(AREAS).some((ps) => under(f, ps)));
  if (global.length || loose.length) {
    const why = global.length ? `공용 코드 ${global.join(', ')}` : `영역 밖 소스 ${loose.join(', ')} — electron/smoke/index.js AREAS에 넣을 것`;
    return { picked: real, why, files };
  }
  const areas = new Set(Object.entries(AREAS).filter(([, ps]) => src.some((f) => under(f, ps))).map(([a]) => a));
  const picked = real.filter((s) => s.areas.some((a) => areas.has(a)) || stepEdits.includes(s.file));
  const why = files.length
    ? `바뀐 영역 ${[...areas].join(', ') || '없음'}${stepEdits.length ? ` · 고친 단계 ${stepEdits.length}개` : ''}`
    : '바뀐 파일 없음 — 기본 점검만 (전부: npm run test:all)';
  return { picked, why, files };
}

/** 고른 단계가 requires로 기대는 단계를 더한다(끝까지) — 번호 순서는 그대로 */
export function withRequired(picked, steps) {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const need = new Set(picked.map((s) => s.name));
  const add = (s) => { for (const r of s.requires ?? []) if (!need.has(r) && byName.has(r)) { need.add(r); add(byName.get(r)); } };
  picked.forEach(add);
  const added = [...need].filter((n) => !picked.some((s) => s.name === n));
  return { list: steps.filter((s) => need.has(s.name)), added };
}

/**
 * @param {import('electron').BrowserWindow} target
 * @param {object} lib 메인 프로세스에서 넘겨받는 것 — { app, db, root, capture, shotDir, BoardRepository, resolveDbPath }
 */
export async function runSmoke(target, lib) {
  const { app, db, capture, shotDir, resolveDbPath } = lib;
  const steps = await loadSteps();
  const finish = (ok) => {
    const file = resolveDbPath();
    try { db.close(); } catch { /* noop */ }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    app.exit(ok ? 0 : 1);
  };

  if (has('--list')) {
    for (const s of steps) console.log(`[smoke] ${s.name.padEnd(18)} ${s.areas.join(', ')}${s.shotOnly ? ' (--shot)' : ''}`);
    finish(true);
    return;
  }

  // ── 기본 점검 — 늘 돈다. 단계들이 쓰는 프로젝트를 만든다 ──────────────
  let opened = null, result = null, wrote = null;
  try {
    await new Promise((r) => setTimeout(r, 600));
    const launcherUp = await target.webContents.executeJavaScript(`!document.getElementById('launcher').hidden`);
    console.log('[smoke] launcher ' + (launcherUp ? 'ok' : 'FAIL (첫 화면에 안 떴다)'));
    await capture(target, 'launcher');

    // 렌더러에 시드를 넣어 주고 프로젝트를 만들어 연다
    await target.webContents.executeJavaScript(`window.__smokeSeed = ${JSON.stringify(SMOKE_SEED)}; true`);
    opened = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      if (!r) return { error: '__roadmap 없음 — 부팅 실패' };
      const before = await r.adapter.listProjects();
      const id = await r.adapter.createProject(window.__smokeSeed, '스모크 프로젝트');
      await r.tabs.openBoard(id);   // 첫 화면에서 보드를 여는 실제 경로(탭에 보드가 걸린다)
      r.launcher.hide();          // 실제 사용 경로에서는 Launcher가 닫아 준다
      await new Promise((res) => setTimeout(res, 300));
      const after = await r.adapter.listProjects();
      return {
        projectsBefore: before.length, projectsAfter: after.length, opened: id,
        launcherClosed: document.getElementById('launcher').hidden,
      };
    })()`);
    console.log('[smoke] project ' + JSON.stringify(opened));

    result = await target.webContents.executeJavaScript(`(() => {
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
    })()`);
    await capture(target, 'board');
  } catch (err) {
    result = { error: String(err) };
  }
  console.log('[smoke] render ' + JSON.stringify(result));

  // 편집 → 저장 왕복. 문서를 고치고 저장이 DB까지 닿는지 본다. 이벤트는 event(본질) + containment(포함)에 저장된다 —
  // 루트→첫 트랙→첫 카드로 내려가 그 본질이 바뀌었는지 본다.
  if (!result.error) {
    try {
      const mark = await target.webContents.executeJavaScript(`(async () => {
        const { store } = window.__roadmap;
        const mark = 'SMOKE-' + Date.now();
        store.commit('smoke', (doc) => { doc.items[0].ti = mark; });
        await new Promise((r) => setTimeout(r, 300));
        return mark;
      })()`);
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

  const baseOk = !result.error && !opened?.error
    && opened?.launcherClosed === true && opened?.projectsAfter === opened?.projectsBefore + 1
    && result.tracks > 0 && result.cards > 0 && result.items > 0 && wrote === true;
  if (!baseOk) {
    console.log('[smoke] 기본 점검 실패 — 단계를 돌리지 않는다');
    console.log('[smoke] FAIL');
    finish(false);
    return;
  }

  // ── 단계 — 고친 코드에 닿는 것만 ─────────────────────────────────────
  const sel = selectSteps(steps, { root: lib.root, packaged: app.isPackaged, shot: !!shotDir() });
  const { why, files } = sel;
  const { list: picked, added } = withRequired(sel.picked, steps);
  console.log(`[smoke] 단계 ${picked.length}/${steps.length} — ${why}${added.length ? ` (필요해서 더함: ${added.join(', ')})` : ''}`);
  if (files?.length) console.log('[smoke] 바뀐 파일: ' + files.join(', '));

  const ctx = { ...lib, target, withTimeout, SMOKE_SEED, opened, result, wrote };
  const failed = [];
  for (const step of picked) {
    let value, pass = false;
    const t0 = Date.now();
    try {
      value = await withTimeout(step.run(ctx), 90000, step.name);
      pass = !!step.check(value, ctx);
    } catch (err) {
      value = { error: String(err && err.stack || err) };
    }
    const ms = Date.now() - t0;
    if (!pass) {
      failed.push(step.name);
      console.log(`[smoke] ✗ ${step.name} (${ms}ms) ${JSON.stringify(value)?.slice(0, 1500)}`);
    } else {
      console.log(`[smoke] ✓ ${step.name} (${ms}ms)`);
    }
  }

  const ok = failed.length === 0;
  if (!ok) console.log('[smoke] 실패한 단계: ' + failed.join(', '));
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} (기본 점검 + 단계 ${picked.length - failed.length}/${picked.length})`);
  finish(ok);
}
