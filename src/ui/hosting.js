/**
 * 보드 호스팅 — 호스트 PC의 화면 (docs/SHARE.md §5·§6).
 *
 *   startHosting        도구 모음 '호스팅' — 지금 보드를 떼어 내 사내망에 연다(호스팅 창이 뜬다)
 *   renderHostingList   첫 화면의 호스팅 목록 — 창 열기·다시 열기 · 멈춤 · 거두기 · 이력 · 버리기 · (버린 것) 다시 호스팅 · 이력 지우기
 *   harvest             거두기 — 원래 보드에 3방향 합치기(충돌만 묻는다) / 독립된 보드로(새 id) / 그만두기
 *
 * 호스팅 사본은 이벤트가 아니다 — 거두기 전까지 시스템(이벤트·포함·관계)에는 아무 일도 없다.
 */
import { el, clear } from './dom.js';
import { toast } from './toast.js';
import { askConfirm, askChoice, askText, openSheet } from './dialog.js';
import { merge3, findEntity } from '../core/merge3.js';
import { statusList, ITEM_TYPES } from '../config/index.js';

const STATUS = { open: '호스팅 중', paused: '멈춤', harvested: '거둠', discarded: '버림' };

/** 도구 모음 '호스팅' — 지금 보드를 떼어 낸다. 이 보드에 이미 열린(멈춘) 호스팅이 있으면 그것을 연다(한 보드에 하나) */
export async function startHosting({ api, adapter, store, before }) {
  const boardId = adapter.projectId;
  if (boardId == null) { toast('보드를 연 뒤에 호스팅할 수 있습니다', 'warn'); return null; }
  const list = await api.list().catch(() => []);
  const had = list.find((h) => h.sourceBoardId === boardId && ['open', 'paused'].includes(h.status));
  if (!had) {
    const ok = await askConfirm({
      title: '이 보드 호스팅',
      message: '지금 보드를 떼어 낸 사본을 사내망에 엽니다. 주소(http://이 PC의 사내 IP:포트/)를 크롬 등 브라우저로 열면 누구나 바로 들어와 함께 보고 고칩니다. '
        + '호스팅하는 동안 사본과 이 보드는 서로 영향을 주지 않고, 고친 것은 나중에 첫 화면의 호스팅 목록에서 거둡니다. '
        + '사내망 HTTP라 내용이 암호화되지 않습니다 — 미공개 자료가 든 보드인지 확인하세요.',
      confirmLabel: '호스팅 시작',
    });
    if (!ok) return null;
  }
  await before?.();
  const doc = JSON.parse(JSON.stringify(store.doc));
  const ext = await outsideEvents(adapter, doc);
  try {
    const r = await api.start({ boardId, name: store.meta.name, doc, ext });
    if (r.existed) toast('이 보드에는 호스팅이 이미 있습니다 — 그 호스팅 창을 엽니다');
    else toast(`호스팅을 시작했습니다 — ${r.urls?.[0] ?? `포트 ${r.port}`}`);
    return r;
  } catch (err) {
    toast('호스팅을 시작하지 못했습니다: ' + err.message, 'warn');
    return null;
  }
}

/** 사본 밖 이벤트(참조·조합 상대) 이름 — 참가자 화면에 이름만 보이게 사본에 함께 담는다 */
async function outsideEvents(adapter, doc) {
  const known = new Set([...(doc.items ?? []).map((x) => x.id), ...(doc.tracks ?? []).map((x) => x.id)]);
  for (const it of doc.items ?? []) for (const t of it.tasks ?? []) known.add(t.id);
  const need = new Set();
  for (const r of doc.relations ?? []) for (const id of [r.from, r.to]) if (!known.has(id)) need.add(id);
  for (const c of doc.compose ?? []) for (const id of [c.parent, c.child]) if (!known.has(id)) need.add(id);
  if (!need.size) return [];
  let all = [];
  try { all = (await adapter.listEvents?.()) ?? []; } catch { all = []; }
  const out = all.filter((e) => need.has(e.id))
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, boardNames: e.boardNames ?? '', boardIds: '' }));
  const missing = [...need].filter((id) => !out.some((e) => e.id === id));
  if (missing.length) {
    try { for (const e of (await adapter.eventsById?.(missing)) ?? []) out.push({ id: e.id, title: e.title, kind: e.kind ?? 'card', boardNames: '', boardIds: '' }); } catch { /* 이름 없이 */ }
  }
  return out;
}

/**
 * 첫 화면 — 호스팅 목록. 호스팅이 하나도 없으면 칸을 숨긴다.
 * @param {{api, mount:HTMLElement, onHarvest:(row)=>void}} o
 */
export async function renderHostingList({ api, mount, onHarvest }) {
  let rows = [];
  try { rows = await api.list(); } catch { rows = []; }
  clear(mount);
  mount.hidden = !rows.length;
  if (!rows.length) return;
  mount.append(el('div.hsect-head', {}, [
    el('h2', { text: '호스팅' }),
    el('span.muted', { text: '보드를 떼어 내 사내망에 연 사본 — 호스팅하는 동안 원래 보드와 따로 운영됩니다' }),
  ]));
  for (const h of rows) {
    const active = ['open', 'paused'].includes(h.status);
    const meta = [
      h.sourceName ? `원래 보드: ${h.sourceName}` : (h.sourceBoardId ? '' : '원래 보드 없음(지워짐)'),
      `변경 ${h.ops}건`,
      h.live ? `참가자 ${h.guests}명` : '',
      `포트 ${h.port}`,
      `마지막 ${h.updatedAt}`,
    ].filter(Boolean).join(' · ');
    const btn = (label, on, cls = 'btn sm outline') => el(`button.${cls.split(' ').join('.')}`, { type: 'button', text: label, on: { click: on } });
    mount.append(el('div.hrow', { dataset: { id: String(h.id) } }, [
      el('div.hrow-main', {}, [
        el('div.hrow-name', {}, [el('b', { text: h.name }), el('span', { className: `hchip st-${h.status}`, text: STATUS[h.status] ?? h.status })]),
        el('div.muted', { text: meta }),
        h.result ? el('div.muted', { text: h.result.mode === 'independent' ? '독립된 보드로 거뒀습니다' : `원래 보드에 합쳤습니다${h.result.conflicts ? ` · 충돌 ${h.result.conflicts}건 고름` : ''}` }) : null,
      ]),
      el('div.hrow-actions', {}, [
        active ? btn(h.live ? '창 열기' : '다시 열기', async () => { try { await api.window(h.id); } catch (e) { toast(e.message, 'warn'); } }) : null,
        // 버린 것 — 사본과 이력이 남아 있어 버리기 전 그대로 이어 연다(이력 지우기 전까지)
        h.status === 'discarded' ? btn('다시 호스팅', async () => { try { await api.revive(h.id); } catch (e) { toast(e.message, 'warn'); } }) : null,
        h.live ? btn('멈춤', async () => { await api.pause(h.id); }) : null,
        active ? btn('거두기', () => onHarvest(h), 'btn sm cta') : null,
        btn('이력', () => showHistory(api, h)),
        active ? btn('버리기', async () => {
          if (await askConfirm({ title: '호스팅 버리기', message: `'${h.name}' 사본의 변경을 거두지 않고 끝냅니다. 사본과 이력은 남아, 이력을 지우기 전까지 '다시 호스팅'으로 이어 열 수 있습니다.`, confirmLabel: '버리기', danger: true })) await api.discard(h.id);
        }) : btn('이력 지우기', async () => {
          if (await askConfirm({ title: '이력 지우기', message: `'${h.name}' 호스팅의 사본과 변경 이력을 지웁니다. 되돌릴 수 없습니다.`, confirmLabel: '지우기', danger: true })) await api.remove(h.id);
        }),
      ]),
    ]));
  }
}

async function showHistory(api, h) {
  let rows = [];
  try { rows = await api.history(h.id); } catch (e) { toast(e.message, 'warn'); return; }
  const list = el('div.sess-history');
  if (!rows.length) list.append(el('div.empty', { text: '아직 바뀐 것이 없습니다.' }));
  for (const r of rows) list.append(el('div.sess-hrow', {}, [el('em.muted', { text: `#${r.seq} · ${r.at}` }), el('b', { text: r.author }), el('span', { text: r.summary || `변경 ${r.n}개` })]));
  await openSheet({ title: `호스팅 이력 — ${h.name}`, message: '누가·언제·무엇을 — 최근 것부터', content: list, wide: true });
}

// ── 거두기 ─────────────────────────────────────────────────

const FIELD = {
  ti: '제목', s: '시작', e: '종료', st: '상태', og: '담당', pg: '진척', ty: '종류', note: '비고', parent: '상위 카드', alias: '별칭',
  tasks: '태스크', name: '이름', lab: '분류', w: '폭', fill: '채우기', text: '글',
};
const KIND = { item: '일정', track: '트랙', rel: '관계', band: '구간', memo: '메모', meta: '보드 표시', doc: '보드', order: '트랙 순서' };

function describe(c, ours, theirs) {
  const ent = c.id != null ? (findEntity(theirs, c.k, c.id) ?? findEntity(ours, c.k, c.id)) : null;
  const what = ent ? (ent.ti || ent.name || ent.text?.slice(0, 20) || '') : '';
  const kind = KIND[c.k] ?? c.k;
  const field = c.f == null ? '' : (c.f.startsWith('place.') ? '배치' : FIELD[c.f] ?? c.f);
  if (c.kind === 'ours-del') return `${kind} '${what}' — 보드에서는 지웠고 사본에서는 고쳤습니다`;
  if (c.kind === 'theirs-del') return `${kind} '${what}' — 사본에서는 지웠고 보드에서는 고쳤습니다`;
  if (c.kind === 'order') return '트랙 순서 — 양쪽이 다르게 바꿨습니다';
  return `${kind}${what ? ` '${what}'` : ''} · ${field || c.f}`;
}

/** 충돌 칸의 값을 사람이 읽게 — 상태·종류는 이름으로, 긴 값은 줄여서 */
const showField = (c, v, doc) => {
  if (c?.f === 'st') return statusList(doc).find((s) => s.key === v)?.label ?? show(v);
  if (c?.f === 'ty') return ITEM_TYPES.find((t) => t.key === v)?.label ?? show(v);
  if (c?.f === 'parent' && v) return doc.items?.find((x) => x.id === v)?.ti ?? show(v);
  return show(v);
};

const show = (v) => {
  if (v == null || v === '') return '(없음)';
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; }
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

/**
 * 거두기 — 원래 보드에 합치기 / 독립된 보드로 / 그만두기.
 * 원래 보드에 합치기는 그 보드를 이 창에 열어(다른 창에 열려 있으면 그 창이 앞으로 나오고 그만둔다) 지금 문서(ours)와
 * 기준(base)·사본(theirs)을 3방향으로 합친다. 합친 문서는 store.replace로 — 되돌리기 1단계, 저장은 보드가 본 것만(docs/SAVE.md).
 * 쓰기 전에 DB 백업(LESSONS 8).
 */
export async function harvest({ api, row, tabs, store, adapter, listEvents }) {
  let m;
  try { m = await api.material(row.id); } catch (e) { toast(e.message, 'warn'); return; }
  const choices = [];
  if (m.sourceBoardId != null) choices.push({ key: 'merge', label: '원래 보드에 합치기', sub: `${row.sourceName || '원래 보드'}에 — 한쪽만 바뀐 것은 그대로, 양쪽이 다르게 바꾼 것만 고릅니다` });
  choices.push({ key: 'independent', label: '독립된 보드로', sub: '사본을 새 보드로 만듭니다(새 이벤트 — 원래 보드와 서로 영향 없음)' });
  const mode = await askChoice({ title: `거두기 — ${row.name}`, message: '거두면 호스팅이 끝나고 참가자 연결이 닫힙니다. 이력은 남습니다.', choices });
  if (!mode) return;

  if (mode === 'independent') {
    const name = await askText({ title: '독립된 보드로', label: '새 보드 이름', value: `${row.name} (호스팅)`, confirmLabel: '만들기' });
    if (!name) return;
    try {
      const boardId = await api.independent(row.id, name);
      toast('사본을 새 보드로 만들었습니다');
      await tabs.openBoard(boardId);
    } catch (e) { toast('거두지 못했습니다: ' + e.message, 'warn'); }
    return;
  }

  // 원래 보드에 합치기 — 그 보드를 이 창에서 연다
  if (!(await tabs.openBoard(m.sourceBoardId))) { toast('원래 보드가 다른 창에 열려 있습니다 — 그 창에서 첫 화면을 열어 거두세요', 'warn'); return; }
  await store.flush();
  const ours = JSON.parse(JSON.stringify(store.doc));
  const r = merge3(m.base, m.theirs, ours);
  const picked = new Map(r.conflicts.map((c) => [c.key, 'theirs']));

  // 같은 이벤트가 다른 보드에도 놓여 있으면 본질(제목·날짜 등) 변경이 그 보드에도 보인다 — 알린다
  let shared = 0;
  try {
    const all = (await listEvents?.()) ?? [];
    const multi = new Set(all.filter((e) => String(e.boardIds ?? '').split(',').filter(Boolean).length > 1).map((e) => e.id));
    const merged = r.resolve(picked);
    for (const it of merged.items ?? []) {
      if (!multi.has(it.id)) continue;
      const before = ours.items.find((x) => x.id === it.id);
      if (before && ['ti', 's', 'e', 'st', 'og', 'pg', 'ty', 'note'].some((f) => JSON.stringify(before[f]) !== JSON.stringify(it[f]))) shared += 1;
    }
  } catch { shared = 0; }

  const content = el('div.harvest');
  content.append(el('p.muted', { text: `사본에서만 바뀐 것 ${r.applied}건은 그대로 들어갑니다.${shared ? ` 다른 보드에도 있는 일정 ${shared}개가 함께 바뀝니다.` : ''}` }));
  if (r.conflicts.length) {
    const bulk = el('div.harvest-bulk', {}, [
      el('span', { text: `충돌 ${r.conflicts.length}건 — 칸마다 남길 쪽을 고르세요` }),
      el('button.btn.sm.outline', { type: 'button', text: '전부 사본 쪽', on: { click: () => setAll('theirs') } }),
      el('button.btn.sm.outline', { type: 'button', text: '전부 보드 쪽', on: { click: () => setAll('ours') } }),
    ]);
    const list = el('div.harvest-list');
    const radios = [];
    r.conflicts.forEach((c, i) => {
      const who = (m.authors?.[authorKey(c)] ?? []).join(', ');
      const fixed = (t) => ({ fixed: t });
      const opt = (side, label, value) => {
        const input = el('input', { type: 'radio', name: `hv${i}`, value: side, checked: side === 'theirs', on: { change: () => picked.set(c.key, side) } });
        radios.push({ input, key: c.key, side });
        const text = value && typeof value === 'object' && 'fixed' in value ? value.fixed : showField(c, value, ours);
        return el('label.harvest-opt', {}, [input, el('span.harvest-side', { text: label }), el('em', { text: text })]);
      };
      list.append(el('div.harvest-row', {}, [
        el('div.harvest-what', { text: describe(c, ours, m.theirs) }),
        c.base !== undefined && c.kind === 'both' ? el('div.muted', { text: `원래 값: ${showField(c, c.base, ours)}` }) : null,
        opt('theirs', `사본${who ? ` (${who})` : ''}`, c.kind === 'theirs-del' ? fixed('지운다') : c.kind === 'ours-del' ? fixed('다시 살린다') : c.theirs),
        opt('ours', '보드', c.kind === 'ours-del' ? fixed('지운 채로 둔다') : c.kind === 'theirs-del' ? fixed('남긴다') : c.ours),
      ]));
    });
    const setAll = (side) => { for (const x of radios) { x.input.checked = x.side === side; if (x.input.checked) picked.set(x.key, side); } };
    content.append(bulk, list);
  } else {
    content.append(el('p', { text: '충돌이 없습니다.' }));
  }
  const key = await openSheet({
    title: `거두기 — ${row.name} → ${row.sourceName || '원래 보드'}`, content, wide: true,
    actions: [{ key: 'cancel', label: '그만두기' }, { key: 'apply', label: '합치기', cta: true }],
  });
  if (key !== 'apply') return;

  let backup = null;
  try { backup = await api.backup(row.id); } catch (e) { toast('백업하지 못해 거두지 않았습니다: ' + e.message, 'warn'); return; }
  const merged = r.resolve(picked);
  const res = store.replace(merged, '호스팅 거두기');
  if (!res.ok) { toast('합치지 못했습니다: ' + res.error, 'warn'); return; }
  await store.flush();
  const nOurs = [...picked.values()].filter((v) => v === 'ours').length;
  await api.finish(row.id, { mode: 'merge', boardId: m.sourceBoardId, applied: r.applied, conflicts: r.conflicts.length, keptBoard: nOurs, backup });
  toast(`거뒀습니다 — 원래 보드에 합쳤습니다(Ctrl+Z로 되돌릴 수 있습니다) · 백업 ${backup}`);
}

/** 이력의 '고친 사람' 열쇠(hosting material.authors)와 같은 모양 */
function authorKey(c) {
  if (c.id == null) return '';
  return c.f == null ? `${c.k}:${c.id}` : `${c.k}:${c.id}:${c.f}`;
}
