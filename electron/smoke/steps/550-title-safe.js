// 스모크 단계 'title-safe' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'title-safe',
  areas: ["board","axis"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, wrote }) {
    // 제목은 잘리지 않는다 — 일정이 몰린 달을 0.15배로 접어도 카드끼리 제목을 덮지 않고(화면 범위로 레인을 나눈다),
    // 좁은 카드는 메타를 먼저 숨기고 제목 글자는 읽히는 크기 아래로 안 줄인다. (2026-09-29 사용자 결정)
    let titleSafe = null;
    if (wrote) {
      titleSafe = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const { LAYOUT } = await import('./src/config/index.js');
          const audit = () => {
            const bad = [];
            for (const c of document.querySelectorAll('#grid .ev')) {
              const t = c.querySelector(':scope > .t');
              if (!t) continue;
              const tr = t.getBoundingClientRect();
              if (tr.bottom < 0 || tr.top > window.innerHeight) continue;          // 화면 밖은 elementFromPoint로 못 잰다
              const fs = parseFloat(getComputedStyle(t).fontSize);
              const over = t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1 || tr.height < 6;
              const y = Math.min(window.innerHeight - 2, Math.max(1, tr.top + tr.height / 2));
              const hit = document.elementFromPoint(tr.left + 4, y)?.closest('.ev');
              const covered = !!hit && hit !== c && !c.contains(hit) && !hit.contains(c);
              if (covered || over || fs < LAYOUT.minTitleFont) bad.push({ ti: t.textContent.slice(0, 16), fs, over, covered });
            }
            return bad;
          };
          // 일정이 가장 많이 시작하는 달
          const byMonth = new Map();
          for (const it of r.store.items) if (it.s) byMonth.set(it.s.slice(0, 7), (byMonth.get(it.s.slice(0, 7)) ?? 0) + 1);
          const month = [...byMonth].sort((a, b) => b[1] - a[1])[0][0];
          const [y, m] = month.split('-').map(Number);
          const last = new Date(y, m, 0).getDate();
          const lanes0 = [...r.board._layout.trackLanes.values()].reduce((a, b) => a + b, 0);
          r.store.commit('접기', (doc) => { doc.bands = doc.bands.filter((b) => b.to < month + '-01' || b.from > month + '-' + last);
            doc.bands.push({ id: 'bts', mode: 'month-week', from: month + '-01', to: month + '-' + String(last).padStart(2, '0'), label: 'T', scale: 0.15 }); });
          r.board.rebuild(); await sleep(250);
          const lanes1 = [...r.board._layout.trackLanes.values()].reduce((a, b) => a + b, 0);
          const sc = document.getElementById('scroll');
          sc.scrollTop = Math.max(0, r.board.scale.y(Math.round((new Date(y, m - 1, 1) - r.board.origin) / 86400000)) - 40);
          await sleep(150);
          const foldedBad = audit();
          r.store.commit('접기 원복', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== 'bts'); });
          r.board.rebuild(); await sleep(200);
          // 펼친 상태도 전체를 훑는다
          const openBad = [];
          for (let top = 0; top < r.board.scale.height; top += sc.clientHeight - 80) { sc.scrollTop = top; await sleep(60); openBad.push(...audit()); }
          return { month, lanes0, lanes1, foldedBad, openBad };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      console.log('[smoke] title-safe ' + JSON.stringify(titleSafe));
    }
    return titleSafe;
  },
  check: (titleSafe) => titleSafe?.foldedBad?.length === 0
    && titleSafe?.openBad?.length === 0
    && titleSafe?.lanes1 > titleSafe?.lanes0,
};
