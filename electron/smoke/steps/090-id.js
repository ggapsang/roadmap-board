// 스모크 단계 'id' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'id',
  areas: ["board","db"],
  async run({ target }) {
    let idCheck = null;
    // 보드-독립 재식별 — 복제본은 새 id, 참조(부모·관계) 정합 유지 (DIRECTION #3)
    idCheck = await target.webContents.executeJavaScript(`(async () => {
      const { reidentify } = await import('./src/core/schema.js');
      const r = window.__roadmap;
      const before = structuredClone(r.store.doc);
      const beforeIds = new Set(before.items.map((i) => i.id));
      const after = reidentify(structuredClone(before));
      const afterIds = after.items.map((i) => i.id);
      const set = new Set(afterIds);
      return {
        n: afterIds.length,
        allNew: afterIds.every((id) => !beforeIds.has(id)),
        unique: set.size === afterIds.length,
        relOk: (after.relations ?? []).every((x) => set.has(x.from) && set.has(x.to)),
        parentOk: after.items.every((i) => !i.parent || set.has(i.parent)),
        relKept: (after.relations ?? []).length === (before.relations ?? []).length,
      };
    })()`);
    console.log('[smoke] id ' + JSON.stringify(idCheck));
    return idCheck;
  },
  check: (idCheck) => idCheck?.n > 0
    && idCheck?.allNew === true
    && idCheck?.unique === true
    && idCheck?.relOk === true
    && idCheck?.parentOk === true
    && idCheck?.relKept === true,
};
