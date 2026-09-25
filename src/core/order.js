/**
 * 순서상 위치 (docs/DIRECTION.md #4-b).
 *
 * 축은 본래 순서다. 달력 눈금이 없을 때도 "무엇이 무엇보다 먼저인가"만으로 이벤트가
 * 배치돼야 한다. 그 앞뒤는 선행(dep) 관계 그래프에서 나온다.
 *
 * rank(이벤트) = 자기로 들어오는 선행들의 rank 최대 + 1 (선행이 없으면 0).
 * 관계선으로 이어지지 않은 이벤트는 서로 순서가 없다(동시적) — 같은 rank가 될 수 있다.
 *
 * 순수 계산이다. 날짜도 DOM도 모른다. 달력 눈금이 켜져 있을 때만 이 순서를 날짜로
 * 환산한다(그건 TimeScale의 몫). 순환은 정규화가 이미 끊지만, 안전하게 방문 제한을 둔다.
 *
 * @param {{id:string}[]} items
 * @param {{type:string, from:string, to:string}[]} relations
 * @returns {Map<string, number>} 이벤트 id → 순서 rank(0부터)
 */
export function computeOrder(items, relations = []) {
  const ids = new Set(items.map((i) => i.id));
  const preds = new Map();                 // to -> [from...] (from이 to의 선행)
  for (const r of relations) {
    if (r?.type !== 'dep') continue;
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) continue;
    if (!preds.has(r.to)) preds.set(r.to, []);
    preds.get(r.to).push(r.from);
  }

  const rank = new Map();
  const visiting = new Set();
  const of = (id, guard = 0) => {
    if (rank.has(id)) return rank.get(id);
    if (visiting.has(id) || guard > 100000) return 0;   // 순환 보호
    visiting.add(id);
    let r = 0;
    for (const p of (preds.get(id) ?? [])) r = Math.max(r, of(p, guard + 1) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };

  for (const it of items) of(it.id);
  return rank;
}
