/**
 * 조합(구성)·동일(합치기) 고르기 — 공용 모듈. 카드(ItemPanel)든 트랙(ConfigPanel)이든 '이벤트'다.
 * 프로젝트 → 트랙 → 카드 트리로 펼치고, 텍스트로 검색한다 (docs/SYSTEM.md §7, docs/SAVE.md §5).
 *   조합 = 여러 이벤트로 이 이벤트가 만들어진 것(구성) — 보드가 트랙들의 조합인 것과 같다.
 *          순서 없는 포함이지만 태스크와 본질이 다르다. doc.compose에만 담고 보드에 카드로 그리지 않는다.
 *          대상은 **다른 보드의 이벤트**뿐이다 — 같은 보드의 이벤트는 이미 이 보드의 포함 그래프 안이라
 *          조합으로 품으면 모순이다(트리에 아예 안 나온다). 둘 이상이어야 적용된다.
 *   동일 = 두 이벤트를 하나로 합치는 작업. 트리에서 대상 하나를 고른다.
 */
import { askTree } from './dialog.js';

/** 이 이벤트를 이루는 조합 대상 id들 = doc.compose에서 parent가 이 이벤트인 것. */
export function composedOf(store, eventId) {
  const set = new Set();
  if (!eventId) return set;
  for (const c of (store.doc.compose ?? [])) if (c.parent === eventId) set.add(c.child);
  return set;
}

/** eventCards의 평탄한 depth 목록을 중첩 노드로 만든다. */
function nestByDepth(flat, blocked) {
  const roots = []; const stack = [];
  for (const c of (flat ?? [])) {
    const node = { id: c.id, label: c.title || '(카드)', sub: '카드', checkable: !blocked.has(c.id), children: [] };
    const depth = c.depth || 0;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node); else roots.push(node);
    stack.push({ depth, node });
  }
  return roots;
}

/**
 * 다른 보드들의 프로젝트 → 트랙 → 카드 트리. 현재 보드는 넣지 않는다.
 * 현재 보드에도 놓인 이벤트(합치기로 공유된 것)는 트리에서 뺀다 — 이미 이 보드의 그래프 안이다.
 * blocked는 보이되 고를 수 없다.
 */
async function buildEventTree(adapter, { blocked = new Set() } = {}) {
  let events = [];
  try { events = (await adapter?.listEvents?.()) ?? []; } catch { events = []; }
  const curBoard = String(adapter?.projectId ?? '');
  const onBoard = (e, bid) => String(e.boardIds ?? '').split(',').includes(bid);
  const here = new Set(events.filter((e) => e.kind !== 'board' && onBoard(e, curBoard)).map((e) => e.id));
  const boards = events.filter((e) => e.kind === 'board' && String(e.boardId) !== curBoard);
  const nodes = [];
  for (const b of boards) {
    const bid = String(b.boardId ?? b.boardIds ?? '');
    const trackNodes = [];
    for (const tr of events.filter((e) => e.kind === 'track' && onBoard(e, bid) && !here.has(e.id))) {
      let cards = [];
      try { cards = (await adapter?.eventCards?.(tr.id)) ?? []; } catch { cards = []; }
      trackNodes.push({ id: tr.id, label: tr.title || '(트랙)', sub: '트랙', checkable: !blocked.has(tr.id), children: nestByDepth(cards.filter((c) => !here.has(c.id)), blocked) });
    }
    nodes.push({ id: b.id, label: b.title || '(프로젝트)', sub: '프로젝트', checkable: false, children: trackNodes });
  }
  return nodes;
}

/**
 * 다른 보드 트리 안에서도 고를 수 없는 것 — 자기 자신과 조상(모든 종류의 포함). 품으면 순환이다.
 * (같은 보드의 이벤트는 트리에 아예 없다.)
 */
async function blockedFor(adapter, eventId) {
  const blocked = new Set([eventId]);
  try { for (const id of (await adapter?.eventAncestors?.(eventId)) ?? []) blocked.add(id); } catch { /* 조상을 못 읽으면 저장이 순환을 거부한다 */ }
  return blocked;
}

/**
 * 조합 트리 팝업 — 체크한 트랙·카드가 이 이벤트를 이루는 조합(구성)이 된다. 둘 이상이어야 적용된다.
 * @returns {Promise<boolean>} 적용했으면 true
 */
export async function openCombinePicker(store, adapter, eventId) {
  if (!eventId || store.readonly) return false;
  const blocked = await blockedFor(adapter, eventId);
  const nodes = await buildEventTree(adapter, { blocked });
  const checked = composedOf(store, eventId);
  const result = await askTree({
    title: '조합설정 — 여러 이벤트로 이 이벤트를 이루기',
    message: '체크한 다른 보드의 트랙·카드로 이 이벤트가 이루어집니다(조합). 둘 이상 골라야 합니다. 같은 보드의 이벤트는 이미 이 보드 안에 있어 조합할 수 없습니다. 보드에 카드로 그리지 않고, 상세 탭 세부내역에서 보입니다.',
    nodes, checked, select: 'multi', minSelect: 2,
  });
  if (!result) return false;
  const here = new Set([...store.tracks.map((t) => t.id), ...store.items.map((i) => i.id)]);
  const want = [...result].filter((id) => !blocked.has(id) && !here.has(id));
  store.commit('조합(구성)', (doc) => {
    const others = (Array.isArray(doc.compose) ? doc.compose : []).filter((c) => c.parent !== eventId);
    doc.compose = [...others, ...want.map((child) => ({ parent: eventId, child }))];
  });
  return true;
}

/**
 * 동일(합치기) 트리 팝업 — 이 이벤트와 하나로 합칠 다른 보드 이벤트 하나를 고른다.
 * @returns {Promise<string|null>} 고른 이벤트 id, 취소하면 null
 */
export async function pickEventForMerge(adapter, selfId) {
  const nodes = await buildEventTree(adapter, { blocked: new Set([selfId]) });
  const result = await askTree({
    title: '항등설정 — 같은 이벤트로 합치기',
    message: '이 이벤트와 하나로 합칠 다른 프로젝트의 이벤트를 하나 고르세요. 합치면 본질을 어느 쪽으로 남길지 다시 묻습니다.',
    nodes, select: 'single',
  });
  return typeof result === 'string' ? result : null;
}
