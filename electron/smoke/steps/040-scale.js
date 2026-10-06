// 스모크 단계 'scale' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'scale',
  areas: ["axis","config"],
  async run({ target, capture, shotDir, withTimeout }) {
    let scaleCheck = null;
    // 세로축 눈금 모드 (docs/SCALE.md) — 설정 › 표시의 고르기로 바꾼다. 일정 날짜는 그대로, 축만 바뀐다.
    // 구간은 모드마다 따로 기억한다. 눈금 없음은 날짜 표시를 걷고 칸 번호(한 칸 = 전환 전 안쪽 단위).
    scaleCheck = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const sel = document.getElementById('v-scale');
      const pick = async (k) => { sel.value = k; sel.dispatchEvent(new Event('change')); await sleep(200); };
      const dates = () => JSON.stringify(r.store.items.map((i) => [i.id, i.s, i.e]));
      const gutLabels = () => [...document.querySelectorAll('.gut-m b u')].map((u) => u.firstChild?.textContent ?? '');
      const d0 = dates();
      const out = { options: sel.options.length, defaultMode: r.store.meta.display.scale };
      const tl = () => r.board.timeline;
      const span = (p) => tl().newEnd(p) - p + 1;
      // 주-일: 왼쪽 칸 = 주, 한 행 = 하루(행 높이 그대로), 새 이벤트 1일, 드래그 1일
      await pick('week-day');
      out.weekDay = { outer: /월 \\d주/.test(gutLabels()[0] ?? ''), ppd: r.board.scale.ppd === r.view.weekHeight,
        newLen: span(10), step: tl().step };
      // 분기-월: 왼쪽 칸 = 분기, 새 이벤트 1개월, 드래그 1주
      await pick('quarter-month');
      const p0 = r.board.timeline.pos(r.store.items.find((i) => !i.parent)).s;
      out.quarter = { outer: /분기/.test(gutLabels()[0] ?? ''), newLen: span(0), step: tl().step,
        snapMonday: new Date(r.board.origin.getTime() + tl().snap(p0 + 3) * 86400000).getDay() === 1 };
      // 구간은 모드마다 — 분기-월에서 묶은 것은 월-주에 안 보인다
      r.store.commit('구간(분기)', (doc) => { doc.bands.push({ id: 'bq', mode: 'quarter-month', from: doc.meta.start, to: doc.meta.start, label: 'QTEST', scale: 1 }); });
      r.board.rebuild(); await sleep(150);
      out.bandHere = gutLabels().includes('QTEST');
      await pick('month-week');
      out.bandElsewhere = gutLabels().includes('QTEST');
      out.monthOuter = /^\\d+월$/.test(gutLabels()[0] ?? '');
      r.store.commit('구간(분기) 치우기', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== 'bq'); });
      // 눈금 없음: 한 칸 = 1주(월-주의 안쪽), 오늘선·바깥 칸 없음, 카드에 칸 번호
      await pick('none');
      const card = document.querySelector('.col > .ev:not(.ms) .dt');
      out.none = { slotUnit: r.store.meta.display.slotUnit, gut: document.querySelectorAll('.gut-m b').length,
        now: !!document.querySelector('.now'), label: card?.textContent ?? '', numbers: /^\\d+$/.test(document.querySelector('.gut-w s')?.textContent ?? '') };
      await pick('month-week');
      out.datesKept = dates() === d0;
      out.back = r.store.meta.display.scale === 'month-week' && document.querySelectorAll('.gut-m b').length > 0;
      return out;
    })()`), 20000, 'scale');
    console.log('[smoke] scale ' + JSON.stringify(scaleCheck));
    // 눈금 모드마다 한 장씩 — 주-일 · 분기-월 · 눈금 없음 (월-주는 'board')
    if (shotDir()) {
      for (const k of ['week-day', 'quarter-month', 'none', 'month-week']) {
        await target.webContents.executeJavaScript(`(async () => {
          const sel = document.getElementById('v-scale');
          sel.value = '${k}'; sel.dispatchEvent(new Event('change'));
          await new Promise((res) => setTimeout(res, 250));
          window.__roadmap.board.scrollToToday(document.getElementById('scroll'));
          return true;
        })()`);
        if (k !== 'month-week') await capture(target, 'scale-' + k);
      }
    }
    return scaleCheck;
  },
  check: (scaleCheck) => scaleCheck?.options === 4
    && scaleCheck?.defaultMode === 'month-week'
    && scaleCheck?.weekDay?.outer === true
    && scaleCheck?.weekDay?.ppd === true
    && scaleCheck?.weekDay?.newLen === 1
    && scaleCheck?.weekDay?.step === 'day'
    && scaleCheck?.quarter?.outer === true
    && scaleCheck?.quarter?.newLen >= 28
    && scaleCheck?.quarter?.newLen <= 31
    && scaleCheck?.quarter?.step === 'week'
    && scaleCheck?.quarter?.snapMonday === true
    && scaleCheck?.bandHere === true
    && scaleCheck?.bandElsewhere === false
    && scaleCheck?.monthOuter === true
    && scaleCheck?.none?.slotUnit === 'week'
    && scaleCheck?.none?.gut === 0
    && scaleCheck?.none?.now === false
    && /^칸 \d/.test(scaleCheck?.none?.label ?? '')
    && scaleCheck?.none?.numbers === true
    && scaleCheck?.datesKept === true
    && scaleCheck?.back === true,
};
