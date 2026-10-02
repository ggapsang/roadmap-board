// 스모크 단계 'rename-candidates' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'rename-candidates',
  areas: ["panel"],
  async run({ target }) {
    let renameKeepsCandidates = null;
    // 재현 — 카드 이름을 바꾼 뒤에도 조합·동일 후보(다른 트랙들)가 그대로 떠야 한다.
    renameKeepsCandidates = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const it0 = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        const id = it0.id;
        const snapTi = it0.ti;
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(120);
        const combBefore = document.querySelectorAll('#i-combine .fl-opt').length;
        const sameBefore = document.querySelectorAll('#i-same .fl-opt').length;
        // 이름 변경 — 속성 탭에서 제목 입력 (input 이벤트로 실제 타이핑처럼)
        document.querySelector('#pItem .ptab[data-tab="attr"]').click();
        await sleep(60);
        const ti = document.getElementById('i-title');
        ti.value = snapTi + ' [이름변경]';
        ti.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
        // 다시 매핑 탭으로
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(300);   // loadCrossBoard 재로드 대기
        const combAfter = document.querySelectorAll('#i-combine .fl-opt').length;
        const sameAfter = document.querySelectorAll('#i-same .fl-opt').length;
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('smoke 원복', (doc) => { const it = doc.items.find((x) => x.id === id); if (it) it.ti = snapTi; });
        return { combBefore, combAfter, sameBefore, sameAfter };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] rename-candidates ' + JSON.stringify(renameKeepsCandidates));
    return renameKeepsCandidates;
  },
  check: (renameKeepsCandidates) => renameKeepsCandidates != null && !renameKeepsCandidates?.error,
};
