/**
 * 조합(포함)·동일(합치기) 고르기 — 공용 모듈. 카드(ItemPanel)든 트랙(ConfigPanel)이든 '이벤트'는
 * 다른 프로젝트의 트랙·카드를 다룬다(docs/SYSTEM.md §7). 다른 프로젝트를 프로젝트 → 트랙 → 카드
 * 트리로 펼치고, 텍스트로 검색한다.
 *   조합 = 포함 관계(카드 렌더 아님). doc.refs(포함 간선)에만 담고 보드에 안 그린다. 둘 이상의
 *          이벤트 묶음이라 하나만 고르면 적용되지 않는다.
 *   동일 = 두 이벤트를 하나로 합치는 작업. 트리에서 대상 하나를 고른다.
 */
import { askTree } from './dialog.js';

/** 이 이벤트가 조합(포함)한 다른 보드 이벤트 id들 = doc.refs에서 parent가 이 이벤트인 것. */
export function containedChildren(store, eventId) {
  const set = new Set();
  if (!eventId) return set;
  for (const r of (store.doc.refs ?? [])) if (r.parent === eventId) set.add(r.child);
  return set;
}

/** eventCards의 평탄한 depth 목록을 중첩 노드로 만든다. */
function nestByDepth(flat) {
  const roots = []; const stack = [];
  for (const c of (flat ?? [])) {
    const node = { id: c.id, label: c.title || '(카드)', sub: '카드', checkable: true, children: [] };
    const depth = c.depth || 0;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node); else roots.push(node);
    stack.push({ depth, node });
  }
  return roots;
}

/**
 * 다른 프로젝트(현재 보드 제외)를 프로젝트 → 트랙 → 카드 트리로 만든다. selfId·현재 보드 이벤트는
 * 뺀다(같은 보드 이중 부모 = 순서축 위치 모순, 자기 자신 순환).
 */
async function buildEventTree(adapter, selfId) {
  let events = [];
  try { events = (await adapter?.listEvents?.()) ?? []; } catch { events = []; }
  const curBoard = String(adapter?.projectId ?? '');
  const inBoard = (e) => String(e.boardIds ?? '').split(',').includes(curBoard);
  const boards = events.filter((e) => e.kind === 'board' && !inBoard(e));
  const nodes = [];
  for (const b of boards) {
    const bid = String(b.boardId ?? b.boardIds ?? '');
    const trackNodes = [];
    for (const tr of events.filter((e) => e.kind === 'track' && String(e.boardIds ?? '').split(',').includes(bid))) {
      if (tr.id === selfId) continue;
      let cards = [];
      try { cards = (await adapter?.eventCards?.(tr.id)) ?? []; } catch { cards = []; }
      trackNodes.push({ id: tr.id, label: tr.title || '(트랙)', sub: '트랙', checkable: true, children: nestByDepth(cards.filter((c) => c.id !== selfId)) });
    }
    nodes.push({ id: b.id, label: b.title || '(프로젝트)', sub: '프로젝트', checkable: false, children: trackNodes });
  }
  return nodes;
}

/**
 * 조합(포함) 트리 팝업 — 체크한 트랙·카드를 eventId의 조합으로 담는다. 둘 이상이어야 적용된다.
 * @returns {Promise<boolean>} 적용했으면 true
 */
export async function openCombinePicker(store, adapter, eventId) {
  if (!eventId || store.readonly) return false;
  const nodes = await buildEventTree(adapter, eventId);
  const checked = containedChildren(store, eventId);
  const result = await askTree({
    title: '조합 — 다른 프로젝트의 이벤트 품기',
    message: '체크한 트랙·카드를 이 이벤트의 조합(포함)으로 담습니다. 둘 이상 골라야 합니다(조합은 묶음). 보드에 카드로 그리지 않고, 상세·펼침에서 보입니다.',
    nodes, checked, select: 'multi', minSelect: 2,
  });
  if (!result) return false;
  const want = new Set(result);
  store.commit('조합(포함)', (doc) => {
    const others = (Array.isArray(doc.refs) ? doc.refs : []).filter((r) => r.parent !== eventId);
    doc.refs = [...others, ...[...want].map((child) => ({ parent: eventId, child }))];
  });
  return true;
}

/**
 * 동일(합치기) 트리 팝업 — 이 이벤트와 하나로 합칠 다른 보드 이벤트 하나를 고른다.
 * @returns {Promise<string|null>} 고른 이벤트 id, 취소하면 null
 */
export async function pickEventForMerge(adapter, selfId) {
  const nodes = await buildEventTree(adapter, selfId);
  const result = await askTree({
    title: '동일 — 같은 이벤트로 합치기',
    message: '이 이벤트와 하나로 합칠 다른 프로젝트의 이벤트를 하나 고르세요. 합치면 본질을 어느 쪽으로 남길지 다시 묻습니다.',
    nodes, select: 'single',
  });
  return typeof result === 'string' ? result : null;
}
