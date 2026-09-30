/**
 * 예시 DB 만들기 — 지금 쓰는 DB를 설치 파일에 넣을 예시(build/example.db)로 떠 낸다.
 *
 *   npm run example-db                  기본: %APPDATA%/wolfpack/wolfpack.db 에서
 *   npm run example-db -- --from <경로>  다른 DB 파일에서
 *
 * 원본은 읽기 전용으로 열어 VACUUM INTO로 한 파일에 뜬다(WAL에 남은 최근 쓰기까지). 원본은 건드리지 않는다.
 * 예시 사본에서만: 변경 이력(revision)을 비우고 휴지통을 비운다 — 받는 사람에게 필요 없는 것.
 * 설치판은 처음 실행할 때 DB가 없으면 이 파일을 복사해 시작한다(electron/main.js seedExampleDatabase).
 * build/example.db는 .gitignore(*.db)로 저장소에 올라가지 않는다. 대신 뜰 때마다 **로컬 전용 git**(.example-db.git, 원격 없음)에
 * 커밋해 이전 예시로 되돌릴 수 있게 한다 — 되돌리기:
 *   git --git-dir=.example-db.git --work-tree=build log --oneline
 *   git --git-dir=.example-db.git --work-tree=build checkout <커밋> -- example.db
 * 이 저장소에는 원격을 붙이지 않는다(보드 데이터가 들어 있다).
 *
 * better-sqlite3가 Electron용으로 빌드돼 있어 node가 아니라 electron으로 돌린다(package.json 스크립트).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDatabase } from '../electron/db/index.js';
import { BoardRepository } from '../electron/db/repository.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--from');
const from = i >= 0 && process.argv[i + 1]
  ? path.resolve(process.argv[i + 1])
  : path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'wolfpack', 'wolfpack.db');
const out = path.join(ROOT, 'build', 'example.db');

try {
  if (!fs.existsSync(from)) throw new Error(`원본 DB가 없습니다: ${from}`);
  const tmp = path.join(os.tmpdir(), `wolfpack-example-${process.pid}.db`);
  for (const f of [tmp, out]) for (const s of ['', '-wal', '-shm']) fs.rmSync(f + s, { force: true });

  // 1) 원본 → 임시 사본 (읽기 전용 연결, 한 파일로)
  const src = new Database(from, { readonly: true, fileMustExist: true });
  src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  src.close();

  // 2) 사본을 최신 스키마로, 이력·휴지통 비우기
  const db = openDatabase(tmp);
  const repo = new BoardRepository(db);
  const purged = repo.emptyTrash().purged;
  const revs = db.prepare('DELETE FROM revision').run().changes;
  const boards = repo.listProjects().map((b) => `${b.name}(${b.items})`);

  // 3) 사본 → build/example.db (WAL 없이 한 파일)
  fs.mkdirSync(path.dirname(out), { recursive: true });
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(tmp + s, { force: true });
  for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(path.basename(tmp) + '.v')) fs.rmSync(path.join(os.tmpdir(), f), { force: true });

  console.log(`[example-db] ${from}`);
  console.log(`[example-db] → ${out} (${Math.round(fs.statSync(out).size / 1024)}KB)`);
  console.log(`[example-db] 보드: ${boards.join(', ')} · 이력 ${revs}건·휴지통 ${purged}건 비움`);

  // 4) 로컬 전용 이력에 커밋 — 원격이 있으면(누가 붙였으면) 멈춘다: 이 이력은 밖으로 나가면 안 된다
  const git = (...a) => execFileSync('git', ['--git-dir=' + path.join(ROOT, '.example-db.git'), '--work-tree=' + path.dirname(out), ...a],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!fs.existsSync(path.join(ROOT, '.example-db.git'))) git('init', '-q');
  if (git('remote')) throw new Error('.example-db.git에 원격이 붙어 있습니다 — 예시 DB 이력은 로컬 전용입니다. 원격을 떼고 다시 하세요.');
  git('add', '-f', 'example.db');
  const changed = git('status', '--porcelain', '--', 'example.db');
  if (changed) {
    git('-c', `user.name=${execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8' }).trim() || 'wolfpack'}`,
      '-c', `user.email=${execFileSync('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8' }).trim() || 'wolfpack@local'}`,
      'commit', '-q', '-m', `example.db — ${boards.join(', ')}`);
    console.log(`[example-db] 로컬 이력에 기록: ${git('log', '-1', '--format=%h %s')}`);
  }
  process.exit(0);
} catch (err) {
  console.error('[example-db] 실패:', err?.message ?? err);
  process.exit(1);
}
