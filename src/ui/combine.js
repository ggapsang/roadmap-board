/**
 * 조합(포함) 고르기 — 공용 모듈. 카드(ItemPanel)든 트랙(ConfigPanel)이든 '이벤트'는 다른
 * 프로젝트의 트랙·카드를 하위로 품을 수 있다(docs/SYSTEM.md §7.1). 조합은 **관계**이지 카드
 * 렌더가 아니다 — doc.refs(포함 간선)에만 담고 보드에 그리지 않는다. 상세·펼침에서만 보인다.
 */
import { askTree } from './dialog.js';

/** 이 이벤트가 조합(포함)한 다른 보드 이벤트 id들 = doc.refs에서 parent가 이 이벤트인 것. */
export function containedChildren(store, eventId) {
  const set = new Set();
  if (!eventId) return set;
  for (const r of (store.doc.refs ?? [])) if (r.parent === eventId) set.add(r.child);
  return set;
}

/**
 * 트리 팝업으로 다른 프로젝트(보드)의 트랙·카드를 펼쳐 체크해, eventId의 조합(포함)으로 담는다.
 * 현재 보드 이벤트는 넣지 않는다(같은 보드 이중 부모 = 순서축 위치 모순 §5.3).
 * @returns {Promise<boolean>} 적용했으면 true
 */
export async function openCombinePicker(store, adapter, eventId) {
  if (!eventId || store.readonly) return false;
  let events = [];
  try { events = (await adapter?.listEvents?.()) ?? []; } catch { events = []; }
  const curBoard = String(adapter?.projectId ?? '');
  const inBoard = (e) => String(e.boardIds ?? '').split(',').includes(curBoard);
  const boards = events.filter((e) => e.kind === 'board' && !inBoard(e));
  const rows = [];
  for (const b of boards) {
    rows.push({ id: b.id, label: b.title || '(프로젝트)', sub: '프로젝트', depth: 0, checkable: false });
    const bid = String(b.boardId ?? b.boardIds ?? '');
    const tracks = events.filter((e) => e.kind === 'track' && String(e.boardIds ?? '').split(',').includes(bid));
    for (const tr of tracks) {
      if (tr.id === eventId) continue;   // 자기 자신은 뺀다
      rows.push({ id: tr.id, label: tr.title || '(트랙)', sub: '트랙', depth: 1, checkable: true });
      let cards = [];
      try { cards = (await adapter?.eventCards?.(tr.id)) ?? []; } catch { cards = []; }
      for (const c of cards) {
        if (c.id === eventId) continue;
        rows.push({ id: c.id, label: c.title || '(카드)', sub: '카드', depth: 2 + (c.depth || 0), checkable: true });
      }
    }
  }
  const checked = containedChildren(store, eventId);
  const result = await askTree({
    title: '조합 — 다른 프로젝트의 이벤트 품기',
    message: '체크한 트랙·카드를 이 이벤트의 조합(포함)으로 담습니다. 보드에 카드로 그려지지 않고, 상세와 펼침에서 보입니다.',
    rows, checked,
  });
  if (!result) return false;
  const want = new Set(result);
  store.commit('조합(포함)', (doc) => {
    const others = (Array.isArray(doc.refs) ? doc.refs : []).filter((r) => r.parent !== eventId);
    doc.refs = [...others, ...[...want].map((child) => ({ parent: eventId, child }))];
  });
  return true;
}
