// 스모크 단계 'contain' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'contain',
  areas: ["board"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target }) {
    let containCheck = null;
  // 포함(contain)도 관계로 노출되는가 — 정규화 후 doc.relations에 contain이 생긴다
    containCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const { prepare } = await import('./src/core/schema.js');
      const { doc } = prepare(structuredClone(r.store.doc));
      const contains = (doc.relations ?? []).filter((x) => x.type === 'contain');
      return {
        count: contains.length,
        hasE10: contains.some((x) => x.from === 'e10'),
        allValid: contains.every((x) => x.from && x.to && x.id),
      };
    })()`);
    console.log('[smoke] contain ' + JSON.stringify(containCheck));
    return containCheck;
  },
  check: (containCheck) => containCheck?.count > 0
    && containCheck?.hasE10 === true
    && containCheck?.allValid === true,
};
