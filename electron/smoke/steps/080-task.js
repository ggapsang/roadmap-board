// 스모크 단계 'task' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'task',
  areas: ["panel","board"],
  async run({ target }) {
    let taskCheck = null;
    // 태스크(순서 없는 할 일) — 카드 칩·정규화 라운드트립·id 유일 (DIRECTION #6)
    taskCheck = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const { prepare } = await import('./src/core/schema.js');
      const it = r.store.items[0];
      const id = it.id;
      r.store.commit('smoke-task', () => {
        it.tasks = [
          { id: 'kSmokeA', text: '할일 A', done: false },
          { id: 'kSmokeB', text: '할일 B', done: true },
        ];
      });
      await new Promise((res) => setTimeout(res, 60));
      const card = document.querySelector('.ev[data-id="' + id + '"]');
      const chip = card ? card.querySelector('.tasks-chip') : null;
      const chipText = chip ? chip.textContent : '';
      const { doc } = prepare(structuredClone(r.store.doc));
      const norm = doc.items.find((x) => x.id === id);
      const ids = new Set((norm.tasks ?? []).map((t) => t.id));
      return {
        count: norm.tasks?.length ?? 0,
        doneKept: (norm.tasks ?? []).filter((t) => t.done).length === 1,
        uniqueIds: ids.size === 2,
        chip: /1\\/2/.test(chipText),
      };
    })()`);
    console.log('[smoke] task ' + JSON.stringify(taskCheck));
    return taskCheck;
  },
  check: (taskCheck) => taskCheck?.count === 2
    && taskCheck?.doneKept === true
    && taskCheck?.uniqueIds === true
    && taskCheck?.chip === true,
};
