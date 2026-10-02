// 스모크 단계 'relations' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'relations',
  areas: ["board","arrows"],
  async run({ target }) {
    let relCheck = null;
    // 관계 일급화 — 선행(dep)이 doc.relations로 관리되고, 추가/삭제가 화살표에 반영되는가
    relCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const rels = r.store.relations;
      const allDep = rels.length > 0 && rels.every((x) => x.type === 'dep' && x.from && x.to && x.id);
      const paths = () => document.querySelectorAll('.arrows path').length;
      const c0 = paths();
      r.store.commit('rel+', (doc) => { doc.relations.push({ id: 'rtest', type: 'dep', from: 'e1', to: 'e20' }); });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const c1 = paths();
      r.store.commit('rel-', (doc) => { doc.relations = doc.relations.filter((x) => x.id !== 'rtest'); });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const c2 = paths();
      return { relCount: rels.length, allDep, c0, c1, c2, added: c1 === c0 + 1, removed: c2 === c0 };
    })()`);
    console.log('[smoke] relations ' + JSON.stringify(relCheck));
    return relCheck;
  },
  check: (relCheck) => relCheck?.allDep === true
    && relCheck?.added === true
    && relCheck?.removed === true,
};
