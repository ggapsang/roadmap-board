// 스모크 단계 'same-card' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'same-card',
  areas: ["panel","db"],
  async run({ target }) {
    let sameCheck = null;
    // 동일 이벤트 후보 목록 — 모든 단위가 이벤트(§3.2): 카드·트랙·프로젝트가 모두 나온다.
    // 그리고 실제 패널 '동일 카드' 목록이 채워지는지(같은 보드 카드 포함)도 본다.
    sameCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const events = await r.adapter.listEvents();
      const id = r.store.items[0].id;
      document.querySelector('[data-id="' + id + '"]').click();
      await new Promise((res) => setTimeout(res, 350));   // loadCrossBoard 대기
      document.querySelector('#pItem .ptab[data-tab="rel"]').click();
      await new Promise((res) => setTimeout(res, 80));
      // 동일·조합은 팝업 버튼(인라인 목록 아님).
      const sameBtn = !!document.querySelector('#i-same button');
      const combBtn = !!document.querySelector('#i-combine button');
      document.querySelector('#pItem [data-close]').click();
      return {
        count: events.length,
        hasBoard: events.some((e) => e.kind === 'board'),
        hasCard: events.some((e) => e.kind === 'card'),
        hasTrack: events.some((e) => e.kind === 'track'),
        hasBoardIds: events.every((e) => e.boardIds != null),
        sameBtn, combBtn,
      };
    })()`);
    console.log('[smoke] same-card ' + JSON.stringify(sameCheck));
    return sameCheck;
  },
  check: (sameCheck) => sameCheck?.count > 0
    && sameCheck?.hasBoard === true
    && sameCheck?.hasCard === true
    && sameCheck?.hasTrack === true
    && sameCheck?.hasBoardIds === true
    && sameCheck?.sameBtn === true
    && sameCheck?.combBtn === true,
};
