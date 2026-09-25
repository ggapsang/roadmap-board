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

/**
 * 순서 모드 레인 배치 (DIRECTION #4-c 초안). 세로는 rank(스케일이 잡는다), 가로는
 * 같은 트랙에서 같은 rank(동시적)인 이벤트끼리만 레인을 나눠 나란히 놓는다.
 * 중첩은 이 초안에선 펼쳐서(flatten) 각자 트랙의 한 카드로 다룬다.
 * @returns {Map<string, {lane:number, lanes:number}>}
 */
export function orderLayout(tracks, items, rank, isVisible = () => true) {
  const placement = new Map();
  for (const track of tracks) {
    const byRank = new Map();
    for (const it of items) {
      if (it.place.t !== track.id || !isVisible(it)) continue;
      const r = rank.get(it.id) ?? 0;
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(it);
    }
    for (const group of byRank.values()) {
      const lanes = group.length;
      group.forEach((it, lane) => placement.set(it.id, { lane, lanes }));
    }
  }
  return placement;
}

/**
 * 순서 스케일 (DIRECTION #4-c). TimeScale와 같은 인터페이스(topOf/heightOf/height)를
 * 순서 rank로 구현한다. 날짜가 아니라 rank × 행높이로 세로 위치를 잡는다.
 * 순서 모드에선 드래그·밴드가 꺼져 있어 나머지 메서드는 안전한 스텁이다.
 */
export class OrderScale {
  constructor(rank, rowH) {
    this.rank = rank;
    this.rowH = rowH;
    let max = 0;
    for (const v of rank.values()) max = Math.max(max, v);
    this.height = (max + 2) * rowH;              // 아래 여백 한 줄
  }

  topOf(item) { return (this.rank.get(item.id) ?? 0) * this.rowH; }
  heightOf() { return this.rowH; }

  y(row) { return row * this.rowH; }
  yOf() { return 0; }
  span() { return this.rowH; }
  dayHeight() { return this.rowH; }
  dayAt(py) { return Math.max(0, Math.round(py / this.rowH)); }
  get compressed() { return false; }
}
