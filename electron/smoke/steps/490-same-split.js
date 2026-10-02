// 스모크 단계 'same-split' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'same-split',
  areas: ["db","panel","tabs"],
  requires: ['nesting', 'task'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, db, wrote }) {
    // 탭 캐시 — 다른 보드의 저장이 이 보드 화면을 바꾸면 그 탭은 '낡음'이 되어 돌아갈 때 다시 읽는다.
    // 항등 — 다른 보드 자리 목록 · 항등 해제(이 보드만 떼어 내기: 안쪽 복제·관계는 보이는 보드별) · 되돌리기 · 태스크도 후보 · 별칭
    let sameSplit = null;
    if (wrote) {
      sameSplit = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const b1 = r.adapter.projectId;
          // 안에 하위 카드가 있고 선행 화살표도 있는 카드
          const deps = r.store.relations.filter((x) => x.type === 'dep');
          const host = r.store.items.find((i) => r.store.items.some((k) => k.parent === i.id) && deps.some((d) => d.from === i.id || d.to === i.id))
            ?? r.store.items.find((i) => r.store.items.some((k) => k.parent === i.id));
          const K1 = host.id, title = host.ti;
          const kids1 = r.store.items.filter((k) => k.parent === K1).map((k) => k.id).sort();
          const b2 = await r.adapter.duplicateProject(b1, '분리 테스트');
          await r.tabs.openBoard(b2); await sleep(300);
          const K2 = r.store.items.find((i) => i.ti === title && !i.parent)?.id ?? r.store.items.find((i) => i.ti === title).id;
          const depsB2Before = r.store.relations.filter((x) => x.type === 'dep' && (x.from === K2 || x.to === K2)).length;
          await r.tabs.openBoard(b1); await sleep(250);
          const mres = await r.adapter.mergeEvents(K1, K2);                           // K1을 남긴다 — 두 보드가 같은 이벤트
          const merged = mres?.ok === true;
          r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
          const placesBefore = (await r.adapter.eventPlaces(K1)).map((p) => p.boardId);
          // 편집 창 — 항등설정 아래 다른 보드 자리 + 항등 해제 버튼
          document.querySelector('#grid .ev[data-id="' + K1 + '"]').click(); await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="rel"]').click();
          for (let i = 0; i < 20 && !document.querySelector('#i-same .same-place'); i += 1) await sleep(100);
          const ui = { place: document.querySelector('#i-same .same-place-board')?.textContent ?? '', split: !!document.querySelector('#i-same .same-split') };
          document.querySelector('#pItem [data-close]').click();
          // 태스크도 항등설정 후보 — 합치기 트리(카드 아래 태스크까지)·이벤트 목록
          const evs = await r.adapter.listEvents();
          const taskKind = evs.some((e) => e.kind === 'task');
          let treeTasks = 0;
          for (const tr of evs.filter((e) => e.kind === 'track')) treeTasks += (await r.adapter.eventCards(tr.id, { withTasks: true })).filter((c) => c.kind === 'task').length;
          // b2에서 항등 해제
          await r.tabs.openBoard(b2); await sleep(300);
          const b2kids0 = r.store.items.filter((k) => k.parent === K1).length;
          const res = await r.adapter.splitEvent(b2, K1);
          r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
          const nw = res?.newId;
          const b2items = r.store.items;
          const b2kids = b2items.filter((k) => k.parent === nw);
          const split = {
            ok: res?.ok === true, newOnB2: !!b2items.find((i) => i.id === nw && i.ti === title), oldGoneB2: !b2items.some((i) => i.id === K1),
            kidsCopied: b2kids.length === b2kids0 && b2kids.every((k) => !kids1.includes(k.id)),
            depsKept: r.store.relations.filter((x) => x.type === 'dep' && (x.from === nw || x.to === nw)).length === depsB2Before,
            placesAfter: (await r.adapter.eventPlaces(K1)).map((p) => p.boardId), newPlaces: (await r.adapter.eventPlaces(nw)).map((p) => p.boardId),
          };
          await r.tabs.openBoard(b1); await sleep(300);
          split.b1Same = r.store.items.some((i) => i.id === K1) && kids1.every((k) => r.store.items.some((i) => i.id === k && i.parent === K1));
          // 되돌리기
          const un = await r.adapter.unsplitEvent(res.undo);
          split.undo = un?.ok === true && (await r.adapter.eventPlaces(K1)).some((p) => p.boardId === b2) && !(await r.adapter.eventPlaces(nw)).length;
          // 별칭 — 이 보드에서만 보이는 이름. 카드에 별칭, 툴팁에 원래 제목
          r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
          const it = r.store.items.find((i) => !i.parent && i.ty !== 'ms' && !r.store.items.some((k) => k.parent === i.id));
          document.querySelector('#grid .ev[data-id="' + it.id + '"]').click(); await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="attr"]').click(); await sleep(60);
          const al = document.getElementById('i-alias');
          al.value = '별칭 테스트'; al.dispatchEvent(new Event('change')); await sleep(250);
          const cardEl = document.querySelector('#grid .ev[data-id="' + it.id + '"]');
          const alias = { stored: r.store.item(it.id).alias === '별칭 테스트', shown: cardEl?.querySelector('.t')?.textContent === '별칭 테스트',
            tip: (cardEl?.title ?? '').includes(it.ti), essenceKept: r.store.item(it.id).ti === it.ti };
          al.value = ''; al.dispatchEvent(new Event('change')); await sleep(200);
          alias.cleared = r.store.item(it.id).alias == null;
          document.querySelector('#pItem [data-close]').click();
          // 원래대로 — 합치기도 되돌려 이 보드에 b2의 하위 카드가 남지 않게(뒤 단계가 이 보드를 쓴다)
          const unm = await r.adapter.unmergeEvents(mres.undo);
          r.tabs.boardClosed(b2);
          await r.adapter.deleteProject(b2);
          r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
          const restored = unm?.ok === true && r.store.items.filter((k) => k.parent === K1).map((k) => k.id).sort().join() === kids1.join();
          return { merged, placesBefore, b2, ui, taskKind, treeTasks, split, alias, aliasId: it.id, restored };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 30000));
        return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
      })()`);
      try {
        const d = db.prepare('SELECT alias FROM disp WHERE child_id = ?').all(sameSplit?.aliasId ?? '');
        sameSplit.aliasDbCleared = d.every((x) => x.alias == null);
      } catch (err) { sameSplit = { ...(sameSplit ?? {}), dbError: String(err) }; }
      console.log('[smoke] same-split ' + JSON.stringify(sameSplit));
    }
    return sameSplit;
  },
  check: (sameSplit) => sameSplit?.merged === true
    && sameSplit?.placesBefore?.includes(sameSplit?.b2)
    && sameSplit?.ui?.place === '분리 테스트'
    && sameSplit?.ui?.split === true
    && sameSplit?.taskKind === true
    && sameSplit?.treeTasks > 0
    && sameSplit?.split?.ok === true
    && sameSplit?.split?.newOnB2 === true
    && sameSplit?.split?.oldGoneB2 === true
    && sameSplit?.split?.kidsCopied === true
    && sameSplit?.split?.depsKept === true
    && !sameSplit?.split?.placesAfter?.includes(sameSplit?.b2)
    && sameSplit?.split?.newPlaces?.includes(sameSplit?.b2)
    && sameSplit?.split?.b1Same === true
    && sameSplit?.split?.undo === true
    && sameSplit?.alias?.stored === true
    && sameSplit?.alias?.shown === true
    && sameSplit?.alias?.tip === true
    && sameSplit?.alias?.essenceKept === true
    && sameSplit?.alias?.cleared === true
    && sameSplit?.aliasDbCleared === true
    && sameSplit?.restored === true,
};
