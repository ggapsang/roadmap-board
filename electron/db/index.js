/**
 * SQLite 연결 + 마이그레이션.
 *
 * 마이그레이션은 PRAGMA user_version으로 추적한다. migrations/NNN_*.sql 을
 * 번호 순으로 적용하고, 적용한 최대 번호를 user_version에 기록한다.
 * 스키마를 바꿀 때는 파일을 새로 추가하기만 하면 된다 — 기존 파일은 수정 금지.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, 'migrations');

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');    // 읽기와 쓰기가 서로 막지 않게
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  migrate(db);
  return db;
}

function migrate(db) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const current = db.pragma('user_version', { simple: true });
  let applied = 0;

  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (!Number.isFinite(version)) throw new Error(`마이그레이션 파일 이름이 올바르지 않습니다: ${file}`);
    if (version <= current) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
    applied++;
    console.log(`[db] 마이그레이션 적용: ${file}`);
  }

  if (applied === 0) console.log(`[db] 스키마 최신 (v${current})`);
}
