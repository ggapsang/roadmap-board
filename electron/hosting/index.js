/**
 * 보드 호스팅 — 메인 프로세스 쪽 (docs/SHARE.md).
 *
 * 호스팅 = 보드를 떼어 낸 독립 사본. 사본과 변경 이력은 호스트 DB(hosting·hosting_op, 마이그레이션 024)에 남고,
 * 4대상(event·containment·disp·rel)에는 쓰지 않는다 — 거두기(§5) 전까지 시스템에는 아무 일도 없다.
 *
 * 동기화(§3): 화면(호스트 창·참가자 브라우저)이 보낸 변경(src/core/ops.js)을 **받은 순서대로** 번호를 붙여 사본에 적용하고
 * 모두에게 뿌린다. 같은 칸을 둘이 고치면 나중 것이 남는다. 적용 뒤 정규화(schema.prepare)가 문서를 고치면 그 고침(fix)도 함께
 * 뿌린다 — 모두 같은 결과로 모인다.
 *
 * 전송(§3): 참가자는 HTTP — SSE(호스트 → 화면) + POST(화면 → 호스트). 호스트 창은 IPC로 같은 메시지를 받는다.
 * 사내망만(§4): 사설 대역이 아닌 곳에서 온 연결은 거절. 링크의 토큰이 있어야 들어온다.
 */
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyOps, diffDocs, docHash } from '../../src/core/ops.js';
import { prepare, reidentify } from '../../src/core/schema.js';

export const BASE_PORT = 1126;
const SNAP_EVERY = 40;            // 변경 몇 개마다 스냅샷
const SNAP_MS = 4000;             // 마지막 변경 뒤 몇 ms 지나면 스냅샷
const BODY_MAX = 4 * 1024 * 1024;
const HOST_CID = 'host';

const clone = (v) => JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();

/** 사내망 주소인가 — 루프백·사설 IPv4·링크 로컬·IPv6 ULA(fc00::/7)·링크 로컬(fe80::/10) */
export function isPrivateAddress(addr) {
  let a = String(addr ?? '').toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1') return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [o1, o2] = [Number(m[1]), Number(m[2])];
    return o1 === 10 || o1 === 127 || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254) || (o1 === 172 && o2 >= 16 && o2 <= 31);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

/** 이 PC의 사내망 IPv4 주소들 — 링크에 쓴다 */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.internal || n.family !== 'IPv4') continue;
      if (isPrivateAddress(n.address)) out.push(n.address);
    }
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** 변경 묶음을 사람이 읽는 한 줄로 — 이력 보기 */
function summarize(ops, doc) {
  const name = (k, id) => {
    if (k === 'item') return doc.items.find((x) => x.id === id)?.ti;
    if (k === 'track') return doc.tracks.find((x) => x.id === id)?.name;
    return null;
  };
  const KIND = { item: '일정', track: '트랙', rel: '관계', band: '구간', memo: '메모' };
  const parts = [];
  for (const op of ops ?? []) {
    if (op.k === 'meta') parts.push('보드 표시');
    else if (op.k === 'doc') parts.push(op.set?.orgs ? '조직' : '조합');
    else if (op.k === 'order') parts.push('트랙 순서');
    else {
      const what = `${KIND[op.k] ?? op.k}${name(op.k, op.id) ? ` '${name(op.k, op.id)}'` : ''}`;
      parts.push(op.add ? `${what} 추가` : op.del ? `${what} 삭제` : `${what} ${Object.keys(op.set ?? {}).join('·')}`);
    }
  }
  return [...new Set(parts)].slice(0, 6).join(', ') + (parts.length > 6 ? ' …' : '');
}

export class HostingManager {
  /**
   * @param {object} o
   * @param {import('better-sqlite3').Database} o.db
   * @param {string} o.root           앱 파일 루트(렌더러를 그대로 내준다)
   * @param {(id:number, msg:object)=>void} o.toHost   호스트 창(들)에 보낼 메시지
   * @param {boolean} [o.localOnly]   127.0.0.1에만 연다(스모크 — 방화벽 창을 띄우지 않게)
   */
  constructor({ db, root, toHost, localOnly = false }) {
    Object.assign(this, { db, root, toHost, localOnly });
    this.live = new Map();        // id → 열린 호스팅
    this.allowed = this.#allowedPaths();
    // 앱이 꺼질 때 열려 있던 호스팅은 '꺼짐' — 다시 열면 같은 포트·링크로 이어진다
    db.prepare("UPDATE hosting SET status = 'paused' WHERE status = 'open'").run();
  }

  // ── 목록·시작·멈춤 ─────────────────────────────────────

  list() {
    const rows = this.db.prepare(`
      SELECT h.id, h.source_board_id AS sourceBoardId, h.name, h.port, h.token, h.status, h.created_at AS createdAt,
             h.updated_at AS updatedAt, h.closed_at AS closedAt, h.result_json AS resultJson,
             b.name AS sourceName, (SELECT COUNT(*) FROM hosting_op o WHERE o.hosting_id = h.id) AS ops
      FROM hosting h LEFT JOIN board b ON b.id = h.source_board_id
      ORDER BY h.id DESC`).all();
    return rows.map((r) => {
      const s = this.live.get(r.id);
      const { resultJson, token, ...rest } = r;
      return { ...rest, result: resultJson ? JSON.parse(resultJson) : null, live: !!s,
        guests: s ? [...s.clients.values()].filter((c) => c.cid !== HOST_CID && c.online).length : 0,
        urls: this.urls(r.port, token) };
    });
  }

  urls(port, token) {
    const hosts = this.localOnly ? ['127.0.0.1'] : lanAddresses();
    return hosts.map((h) => `http://${h}:${port}/?t=${token}`);
  }

  /** 보드를 떼어 내 호스팅을 시작한다. 그 보드에 열린(멈춘 것 포함) 호스팅이 있으면 그것을 돌려준다(한 보드에 하나) */
  async start({ boardId, name, doc, ext = [] }) {
    const had = this.db.prepare("SELECT id FROM hosting WHERE source_board_id = ? AND status IN ('open','paused')").get(boardId);
    if (had) return { id: had.id, existed: true, ...(await this.open(had.id)) };
    const { doc: fork, error } = prepare(clone(doc));
    if (error || !fork) throw new Error(error || '문서를 읽지 못했습니다.');
    const json = JSON.stringify(fork);
    const id = this.db.prepare(`INSERT INTO hosting (source_board_id, name, port, token, status, base_json, doc_json, doc_seq, ext_json)
      VALUES (?, ?, ?, ?, 'paused', ?, ?, 0, ?)`).run(boardId, name || fork.meta?.name || '보드', this.#freePortNumber(), this.#token(), json, json,
      JSON.stringify(ext ?? [])).lastInsertRowid;
    return { id: Number(id), existed: false, ...(await this.open(Number(id))) };
  }

  /** (다시) 연다 — 스냅샷 + 그 뒤 변경을 다시 적용하고 웹 서버를 띄운다 */
  async open(id) {
    if (this.live.has(id)) return this.#info(this.live.get(id));
    const row = this.db.prepare('SELECT * FROM hosting WHERE id = ?').get(id);
    if (!row) throw new Error('호스팅을 찾을 수 없습니다.');
    if (!['open', 'paused'].includes(row.status)) throw new Error('이미 거두었거나 버린 호스팅입니다.');
    const doc = JSON.parse(row.doc_json);
    let seq = row.doc_seq;
    for (const r of this.db.prepare('SELECT seq, op_json FROM hosting_op WHERE hosting_id = ? AND seq > ? ORDER BY seq').all(id, row.doc_seq)) {
      const m = JSON.parse(r.op_json);
      applyOps(doc, m.ops);
      applyOps(doc, m.fix ?? []);
      seq = r.seq;
    }
    const s = {
      id, name: row.name, port: row.port, token: row.token, sourceBoardId: row.source_board_id,
      doc, seq, ext: row.ext_json ? JSON.parse(row.ext_json) : [], snapSeq: row.doc_seq, snapTimer: null,
      clients: new Map([[HOST_CID, { cid: HOST_CID, name: '호스트', role: 'edit', online: true, sel: null, host: true }]]),
      streams: new Map(), banned: new Set(), server: null,
    };
    await this.#listen(s);
    this.live.set(id, s);
    this.db.prepare("UPDATE hosting SET status = 'open', port = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(s.port, id);
    return this.#info(s);
  }

  /** 멈춘다 — 참가자 연결을 닫고 스냅샷을 남긴다. 다시 열면 이어진다 */
  pause(id, status = 'paused') {
    const s = this.live.get(id);
    if (s) {
      this.#broadcast(s, { type: 'closed' });
      for (const res of s.streams.values()) { try { res.end(); } catch { /* 이미 끊김 */ } }
      s.server?.close();
      s.server?.closeAllConnections?.();
      this.#snapshot(s);
      this.live.delete(id);
    }
    this.db.prepare("UPDATE hosting SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND status IN ('open','paused')").run(status, id);
  }

  /** 앱을 끄기 전 — 스냅샷만 남기고 닫는다(상태는 다음 실행 때 '꺼짐') */
  shutdown() {
    for (const s of this.live.values()) {
      try { this.#snapshot(s); s.server?.close(); s.server?.closeAllConnections?.(); } catch { /* 끄는 중 */ }
    }
    this.live.clear();
  }

  /** 버린다 — 이력은 남긴다 */
  discard(id) {
    this.pause(id);
    this.db.prepare("UPDATE hosting SET status = 'discarded', closed_at = datetime('now','localtime') WHERE id = ?").run(id);
  }

  /** 이력(지운 호스팅 행과 변경까지) 지우기 — 거두었거나 버린 것만 */
  remove(id) {
    const row = this.db.prepare('SELECT status FROM hosting WHERE id = ?').get(id);
    if (!row || ['open', 'paused'].includes(row.status)) throw new Error('호스팅 중이거나 멈춘 것은 지울 수 없습니다 — 거두거나 버린 뒤에');
    this.db.prepare('DELETE FROM hosting WHERE id = ?').run(id);
  }

  // ── 화면과 주고받기 ─────────────────────────────────────

  /** 화면이 처음 받는 상태 */
  state(id, cid = HOST_CID) {
    const s = this.#live(id);
    const c = s.clients.get(cid);
    return { doc: s.doc, seq: s.seq, hash: docHash(s.doc), ext: s.ext, name: s.name, cid, role: c?.role ?? 'edit',
      host: cid === HOST_CID, people: this.#people(s), port: s.port, urls: this.urls(s.port, s.token) };
  }

  /** 참가자 입장 — 이름만 받는다(링크만 입장, 2026-10-12 사용자). 다시 들어온 사람(같은 cid)은 그대로 */
  hello(id, { name, cid, ip }) {
    const s = this.#live(id);
    let c = cid ? s.clients.get(cid) : null;
    if (!c || c.host) {
      c = { cid: crypto.randomBytes(8).toString('hex'), role: 'edit', sel: null };
      s.clients.set(c.cid, c);
    }
    c.name = String(name || '참가자').slice(0, 40);
    c.ip = ip;
    this.#presence(s);
    return { cid: c.cid, role: c.role };
  }

  /**
   * 변경을 받는다 — 순서(seq)를 붙여 사본에 적용, 정규화가 고친 것(fix)까지 기록하고 모두에게 뿌린다.
   * 보기 전용 참가자의 변경은 거절한다.
   */
  submit(id, cid, { ops, cseq }) {
    const s = this.#live(id);
    const c = s.clients.get(cid);
    if (!c) return { ok: false, error: 'unknown', resync: true };
    if (c.role !== 'edit') return { ok: false, error: 'readonly', resync: true };
    if (!Array.isArray(ops) || !ops.length) return { ok: true, seq: s.seq };
    applyOps(s.doc, ops);
    // 정규화 — 동시에 고친 것이 모순을 만들면(서로를 부모로 등) 문서 규칙대로 고치고 그 고침도 뿌린다
    const { doc: norm } = prepare(clone(s.doc));
    const fix = norm ? diffDocs(s.doc, norm) : [];
    if (fix.length) applyOps(s.doc, fix);
    s.seq += 1;
    const msg = { type: 'ops', seq: s.seq, ops, fix, cid, cseq: cseq ?? null, author: c.name, hash: docHash(s.doc) };
    this.db.prepare('INSERT INTO hosting_op (hosting_id, seq, author, at, op_json) VALUES (?, ?, ?, datetime(\'now\',\'localtime\'), ?)')
      .run(id, s.seq, c.name, JSON.stringify({ ops, fix, cid, summary: summarize(ops, s.doc) }));
    this.#broadcast(s, msg);
    this.#scheduleSnapshot(s);
    return { ok: true, seq: s.seq };
  }

  /** 누가 무엇을 고르고 있나 — 기록하지 않는다 */
  presence(id, cid, { sel }) {
    const s = this.live.get(id);
    const c = s?.clients.get(cid);
    if (!c) return;
    c.sel = typeof sel === 'string' ? sel : null;
    this.#presence(s);
  }

  /** 보기 전용 / 편집 */
  setRole(id, cid, role) {
    const s = this.#live(id);
    const c = s.clients.get(cid);
    if (!c || c.host) return false;
    c.role = role === 'view' ? 'view' : 'edit';
    this.#send(s, cid, { type: 'role', role: c.role });
    this.#presence(s);
    return true;
  }

  /** 내보내기 — 연결을 끊고 그 주소는 이 호스팅이 열려 있는 동안 다시 들어오지 못한다 */
  kick(id, cid) {
    const s = this.#live(id);
    const c = s.clients.get(cid);
    if (!c || c.host) return false;
    if (c.ip) s.banned.add(c.ip);
    this.#send(s, cid, { type: 'kicked' });
    try { s.streams.get(cid)?.end(); } catch { /* 이미 끊김 */ }
    s.streams.delete(cid);
    s.clients.delete(cid);
    this.#presence(s);
    return true;
  }

  /** 링크 다시 만들기 — 옛 링크는 막히고 들어와 있던 참가자도 나간다 */
  newToken(id) {
    const s = this.#live(id);
    s.token = this.#token();
    this.db.prepare('UPDATE hosting SET token = ? WHERE id = ?').run(s.token, id);
    for (const [cid, c] of [...s.clients]) {
      if (c.host) continue;
      this.#send(s, cid, { type: 'kicked', reason: 'token' });
      try { s.streams.get(cid)?.end(); } catch { /* 이미 끊김 */ }
      s.streams.delete(cid);
      s.clients.delete(cid);
    }
    this.#presence(s);
    return this.#info(s);
  }

  /** 이력 — 최근 변경부터 */
  history(id, limit = 200) {
    return this.db.prepare('SELECT seq, author, at, op_json FROM hosting_op WHERE hosting_id = ? ORDER BY seq DESC LIMIT ?').all(id, limit)
      .map((r) => { const m = JSON.parse(r.op_json); return { seq: r.seq, author: r.author, at: r.at, summary: m.summary ?? '', n: (m.ops ?? []).length }; });
  }

  // ── 거두기 재료(§5) ─────────────────────────────────────

  /** 기준(떼어 낸 시점)·사본(지금) — 3방향 합치기는 렌더러가 한다(src/core/merge3.js) */
  material(id) {
    const row = this.db.prepare('SELECT * FROM hosting WHERE id = ?').get(id);
    if (!row) throw new Error('호스팅을 찾을 수 없습니다.');
    const s = this.live.get(id);
    if (s) this.#snapshot(s);
    const doc = s ? clone(s.doc) : this.#replayed(row);
    const authors = {};
    for (const r of this.db.prepare('SELECT author, op_json FROM hosting_op WHERE hosting_id = ? ORDER BY seq').all(id)) {
      const m = JSON.parse(r.op_json);
      for (const op of m.ops ?? []) {
        for (const key of this.#keys(op)) { (authors[key] ??= new Set()).add(r.author); }
      }
    }
    const byKey = Object.fromEntries(Object.entries(authors).map(([k, v]) => [k, [...v]]));
    return { id, name: row.name, sourceBoardId: row.source_board_id, status: row.status, base: JSON.parse(row.base_json), theirs: doc, authors: byKey };
  }

  /** 거두었다 — 호스팅을 닫고 결과를 남긴다(이력은 남는다) */
  finish(id, result) {
    this.pause(id);
    this.db.prepare("UPDATE hosting SET status = 'harvested', closed_at = datetime('now','localtime'), result_json = ? WHERE id = ?")
      .run(JSON.stringify(result ?? {}), id);
  }

  /** 독립된 보드로 거둘 문서 — 새 id 전부(원래 보드와 남, 2026-10-12 사용자) */
  independentDoc(id, name) {
    const m = this.material(id);
    const doc = reidentify(clone(m.theirs));
    doc.meta = { ...(doc.meta ?? {}), name: name || `${m.name} (호스팅)` };
    return doc;
  }

  // ── 안쪽 ────────────────────────────────────────────────

  #keys(op) {
    if (op.k === 'meta' || op.k === 'doc' || op.k === 'order') return [];
    if (op.add || op.del) return [`${op.k}:${op.id}`];
    return Object.keys(op.set ?? {}).map((f) => `${op.k}:${op.id}:${f}`);
  }

  #replayed(row) {
    const doc = JSON.parse(row.doc_json);
    for (const r of this.db.prepare('SELECT op_json FROM hosting_op WHERE hosting_id = ? AND seq > ? ORDER BY seq').all(row.id, row.doc_seq)) {
      const m = JSON.parse(r.op_json);
      applyOps(doc, m.ops);
      applyOps(doc, m.fix ?? []);
    }
    return doc;
  }

  #live(id) {
    const s = this.live.get(id);
    if (!s) throw new Error('열려 있지 않은 호스팅입니다.');
    return s;
  }

  #info(s) {
    return { id: s.id, port: s.port, urls: this.urls(s.port, s.token), name: s.name };
  }

  #token() { return crypto.randomBytes(16).toString('hex'); }

  /** 다른 호스팅이 쓰지 않는 가장 작은 포트(1126부터) — 실제로 비었는지는 열 때 본다 */
  #freePortNumber() {
    const used = new Set(this.db.prepare("SELECT port FROM hosting WHERE status IN ('open','paused')").all().map((r) => r.port));
    let p = BASE_PORT;
    while (used.has(p)) p += 1;
    return p;
  }

  #people(s) {
    return [...s.clients.values()].filter((c) => c.host || c.online)
      .map((c) => ({ cid: c.cid, name: c.name, role: c.role, sel: c.sel, host: !!c.host }));
  }

  #presence(s) { this.#broadcast(s, { type: 'presence', people: this.#people(s) }); }

  #broadcast(s, msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of s.streams.values()) { try { res.write(data); } catch { /* 끊긴 연결은 close에서 정리 */ } }
    this.toHost?.(s.id, msg);
  }

  #send(s, cid, msg) {
    const res = s.streams.get(cid);
    if (res) { try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch { /* 끊김 */ } }
  }

  #scheduleSnapshot(s) {
    if (s.seq - s.snapSeq >= SNAP_EVERY) { this.#snapshot(s); return; }
    clearTimeout(s.snapTimer);
    s.snapTimer = setTimeout(() => this.#snapshot(s), SNAP_MS);
  }

  #snapshot(s) {
    clearTimeout(s.snapTimer);
    if (s.seq === s.snapSeq) return;
    this.db.prepare("UPDATE hosting SET doc_json = ?, doc_seq = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(JSON.stringify(s.doc), s.seq, s.id);
    s.snapSeq = s.seq;
  }

  /** 렌더러가 import하는 파일만 내준다 — index.html·src·assets·도움말, import map이 가리키는 패키지. electron/·DB는 내주지 않는다 */
  #allowedPaths() {
    const prefixes = ['/src/', '/assets/'];
    const exact = new Set(['/index.html', '/docs/HELP.md']);
    try {
      const html = fs.readFileSync(path.join(this.root, 'index.html'), 'utf8');
      const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '{}');
      for (const target of Object.values(map.imports ?? {})) {
        const m = String(target).match(/^\.\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
        if (m) prefixes.push(`/node_modules/${m[1]}/`);
      }
    } catch { /* import map이 없으면 node_modules는 안 내준다 */ }
    return { prefixes, exact };
  }

  async #listen(s) {
    const server = http.createServer((req, res) => this.#handle(s, req, res));
    server.on('clientError', (_e, sock) => { try { sock.destroy(); } catch { /* noop */ } });
    const host = this.localOnly ? '127.0.0.1' : undefined;
    for (let tries = 0; tries < 50; tries += 1) {
      const ok = await new Promise((resolve) => {
        const onErr = (err) => { server.off('listening', onOk); resolve(err.code === 'EADDRINUSE' ? false : Promise.reject(err)); };
        const onOk = () => { server.off('error', onErr); resolve(true); };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(s.port, host);
      });
      if (ok) { s.server = server; return; }
      // 포트가 다른 프로그램에 쓰이고 있으면 다음 번호로 — 이 호스팅의 포트로 기억한다
      const used = new Set(this.db.prepare("SELECT port FROM hosting WHERE status IN ('open','paused') AND id != ?").all(s.id).map((r) => r.port));
      do { s.port += 1; } while (used.has(s.port));
    }
    throw new Error('열 수 있는 포트를 찾지 못했습니다.');
  }

  #handle(s, req, res) {
    const ip = req.socket.remoteAddress;
    const deny = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
    // 사내망만(2026-10-12 사용자)
    if (!isPrivateAddress(ip)) return deny(403, '사내망에서만 접속할 수 있습니다.');
    if (s.banned.has(ip)) return deny(403, '호스트가 내보냈습니다.');
    const url = new URL(req.url, 'http://x');
    const cookieName = `wp${s.port}`;
    const cookie = Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((x) => x.trim().split('=')).filter((x) => x.length === 2));
    const given = url.searchParams.get('t') || req.headers['x-wolfpack-token'] || cookie[cookieName];
    const ok = given && crypto.timingSafeEqual(Buffer.from(String(given).padEnd(64).slice(0, 64)), Buffer.from(s.token.padEnd(64).slice(0, 64)));
    if (!ok) return deny(403, '링크가 올바르지 않거나 바뀌었습니다. 호스트에게 새 링크를 받으세요.');
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (url.searchParams.get('t')) headers['Set-Cookie'] = `${cookieName}=${s.token}; HttpOnly; SameSite=Strict; Path=/`;

    const p = url.pathname;
    if (p.startsWith('/api/')) return this.#api(s, req, res, url, ip, headers);
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, '');
    // 디코딩한 뒤 정규화한 경로로 허용 목록을 본다 — '%2e%2e%2f'처럼 인코딩한 '..'로 앱 밖(electron/·DB)에 닿지 못하게
    let rel;
    try { rel = p === '/' ? '/index.html' : path.posix.normalize(decodeURIComponent(p)); } catch { return deny(400, ''); }
    if (/[\u0000\\]/.test(rel)) return deny(400, '');   // NUL·역슬래시(윈도 경로 구분자)는 받지 않는다
    const { prefixes, exact } = this.allowed;
    if (!exact.has(rel) && !prefixes.some((x) => rel.startsWith(x))) return deny(404, '');
    const file = path.join(this.root, rel);
    if (!file.startsWith(this.root + path.sep)) return deny(403, '');
    fs.readFile(file, (err, buf) => {
      if (err) return deny(404, '');
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return undefined;
  }

  #api(s, req, res, url, ip, headers) {
    const json = (code, body) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    const cid = url.searchParams.get('cid') || null;
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      const c = cid && s.clients.get(cid);
      if (!c || c.host) return json(403, { error: 'hello first' });
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'welcome', seq: s.seq })}\n\n`);
      s.streams.get(cid)?.end();
      s.streams.set(cid, res);
      c.online = true;
      this.#presence(s);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* 끊김 */ } }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        if (s.streams.get(cid) === res) { s.streams.delete(cid); c.online = false; this.#presence(s); }
      });
      return undefined;
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      if (!cid || !s.clients.get(cid)) return json(403, { error: 'hello first' });
      return json(200, this.state(s.id, cid));
    }
    if (req.method !== 'POST') return json(405, { error: 'method' });
    let size = 0;
    const chunks = [];
    req.on('data', (b) => { size += b.length; if (size > BODY_MAX) { req.destroy(); return; } chunks.push(b); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return json(400, { error: 'json' }); }
      try {
        if (url.pathname === '/api/hello') return json(200, this.hello(s.id, { name: body.name, cid: body.cid, ip }));
        if (!cid || !s.clients.get(cid)) return json(403, { error: 'hello first', resync: true });
        if (url.pathname === '/api/ops') return json(200, this.submit(s.id, cid, body));
        if (url.pathname === '/api/presence') { this.presence(s.id, cid, body); return json(200, { ok: true }); }
        return json(404, { error: 'api' });
      } catch (err) {
        return json(500, { error: String(err?.message ?? err) });
      }
    });
    return undefined;
  }
}
