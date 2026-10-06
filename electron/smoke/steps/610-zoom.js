// 스모크 단계 'zoom' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'zoom',
  areas: ["board","drag","axis"],
  async run({ target, wrote }) {
    // 보드 확대·축소 — 브라우저처럼 Ctrl+휠 위 = 확대, 아래 = 축소. 단 **보드만**(도구 모음·패널·창 배율은 그대로).
    // 확대한 채로 만들기·카드 끌기·칸 높이 끌기가 제자리(마우스 좌표 ÷ 배율)에 맞는지도 본다. 끝나면 100%·원래 설정으로.
    let zoomCheck = null;
    if (wrote) {
      try {
        const wc = target.webContents;
        const saved = await wc.executeJavaScript(`localStorage.getItem('wolfpack:board-zoom')`);
        const wheel = async (dy) => {
          const g = await wc.executeJavaScript(`(() => { const r = document.getElementById('scroll').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
          wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(g[0]), y: Math.round(g[1]), deltaX: 0, deltaY: dy, canScroll: true, modifiers: ['control'] });
          await new Promise((res) => setTimeout(res, 300));
          return wc.executeJavaScript(`Math.round((window.__roadmap.view.boardZoom || 1) * 100)`);
        };
        const tb0 = await wc.executeJavaScript(`Math.round(document.querySelector('body > .bar')?.getBoundingClientRect().height ?? 0)`);
        await wc.executeJavaScript('window.__toasts = []; new MutationObserver(() => { const t = document.getElementById("toast")?.textContent; if (t) window.__toasts.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true }); true');
        const up = await wheel(120);                        // 휠 위(양수 deltaY가 위 — Electron 입력 이벤트 규약)
        const winZoom = Math.round(wc.getZoomFactor() * 100);
        const tb1 = await wc.executeJavaScript(`Math.round(document.querySelector('body > .bar')?.getBoundingClientRect().height ?? 0)`);
        const calZoom = await wc.executeJavaScript(`document.querySelector('.cal').style.zoom`);
        await wheel(120); const at150 = await wheel(120);   // 1.1 → 1.25 → 1.5
        // 150%에서 좌표 — 만들기(누른 자리 날짜), 카드 끌기(7일 = 화면 7×ppd×1.5px), 칸 높이(화면 60px = 보드 40px)
        const acc = await wc.executeJavaScript(`(async () => {
          const r = window.__roadmap, z = r.view.boardZoom, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const { dateAt } = await import('./src/core/dates.js');
          const sc = document.getElementById('scroll'), grid = document.getElementById('grid');
          const col = grid.querySelector('.col');
          // 만들기 — 빈 칸을 찾아 누른다(카드 위는 끌기라). 누른 자리의 날짜 = 새 이벤트 시작
          const n0 = r.store.items.length;
          let made = null;
          for (let d = 3; d < r.board.totalDays - 10 && !made; d += 5) {
            sc.scrollTop = Math.max(0, r.board.scale.y(d) * z - 200); await sleep(30);
            const cr = col.getBoundingClientRect();
            const y = cr.top + (r.board.scale.y(d) + r.board.scale.dayHeight(d) / 2) * z, x = cr.left + 6;
            const hit = document.elementFromPoint(x, y);
            if (!hit || hit.closest('.ev') || !hit.closest('.col')) continue;
            const at = (yy) => ({ bubbles: true, clientX: x, clientY: yy, button: 0, pointerId: 21 });
            hit.dispatchEvent(new PointerEvent('pointerdown', at(y)));
            grid.dispatchEvent(new PointerEvent('pointerup', at(y)));
            await sleep(120);
            if (r.store.items.length === n0 + 1) made = { want: dateAt(r.board.origin, r.board.timeline.snap(d)), got: r.store.items[r.store.items.length - 1].s };
          }
          if (made) { r.store.undo(); await sleep(80); }
          // 카드 끌기 — 크기 강제 아닌 최상위 기간 카드를 화면 7일만큼 아래로
          const it = r.store.items.find((i) => !i.parent && i.ty !== 'ms' && i.place.hd == null);
          const card = () => document.querySelector('.col > .ev[data-id="' + it.id + '"]');
          card().scrollIntoView({ block: 'center' }); await sleep(60);
          const b = card().getBoundingClientRect();
          const s0 = it.s, dy = 7 * r.board.scale.ppd * z;
          const at2 = (yy) => ({ bubbles: true, clientX: b.left + b.width / 2, clientY: yy, button: 0, pointerId: 22 });
          card().dispatchEvent(new PointerEvent('pointerdown', at2(b.top + 10)));
          grid.dispatchEvent(new PointerEvent('pointermove', at2(b.top + 10 + dy)));
          await sleep(80);
          grid.dispatchEvent(new PointerEvent('pointerup', at2(b.top + 10 + dy)));
          await sleep(120);
          const moved = { from: s0, to: r.store.item(it.id).s, days: Math.round((new Date(r.store.item(it.id).s) - new Date(s0)) / 86400000) };
          r.store.undo(); await sleep(80);
          // 칸 높이 — 구간 없는 낱개 칸 손잡이를 화면 60px 위로 = 보드 40px
          const gutM = document.getElementById('gutM');
          const cell = [...gutM.querySelectorAll('b:not(.merged)')].find((c) => c.getBoundingClientRect().height > 150 * z / 1.5);
          cell.scrollIntoView({ block: 'center' }); await sleep(60);
          const h = cell.querySelector('.band-resize'), hb = h.getBoundingClientRect();
          const full = (Number(cell.dataset.to) - Number(cell.dataset.from)) * r.board.scale.ppd;
          const at3 = (yy) => ({ bubbles: true, clientX: hb.left + 10, clientY: yy, button: 0, pointerId: 23 });
          const nb = r.store.doc.bands.length, ids0 = new Set(r.store.doc.bands.map((x) => x.id));
          h.dispatchEvent(new PointerEvent('pointerdown', at3(hb.top + 2)));
          gutM.dispatchEvent(new PointerEvent('pointermove', at3(hb.top + 2 - 10)));
          gutM.dispatchEvent(new PointerEvent('pointermove', at3(hb.top + 2 - 60)));
          await sleep(80);
          gutM.dispatchEvent(new PointerEvent('pointerup', at3(hb.top + 2 - 60)));
          await sleep(120);
          const band = r.store.doc.bands.find((x) => !ids0.has(x.id));     // 새로 생긴 구간(구간은 정렬돼 있어 끝이 아닐 수 있다)
          const bandOk = r.store.doc.bands.length === nb + 1 && Math.abs(band.scale - Math.round((full - 60 / z) / full * 100) / 100) <= 0.011;
          if (r.store.doc.bands.length === nb + 1) r.store.commit('정리', (doc) => { doc.bands = doc.bands.filter((x) => x.id !== band.id); });
          return { z, made, moved, bandOk, bandScale: band?.scale, want: Math.round((full - 60 / z) / full * 100) / 100 };
        })()`);
        // 보기 메뉴 '보드 원래 크기'와 같은 신호로 100%
        wc.send('view:board-zoom', 0);
        await new Promise((res) => setTimeout(res, 300));
        const reset = await wc.executeJavaScript(`[Math.round(window.__roadmap.view.boardZoom * 100), document.querySelector('.cal').style.zoom]`);
        const toast = await wc.executeJavaScript('window.__toasts.join(" / ")');
        await wc.executeJavaScript(`(() => { const v = ${JSON.stringify(saved)}; if (v == null) localStorage.removeItem('wolfpack:board-zoom'); else localStorage.setItem('wolfpack:board-zoom', v); return true; })()`);
        zoomCheck = { up, winZoom, tb0, tb1, calZoom, at150, acc, reset, toast: toast.slice(0, 100) };
      } catch (err) { zoomCheck = { error: String(err) }; }
      console.log('[smoke] zoom ' + JSON.stringify(zoomCheck));
    }
    return zoomCheck;
  },
  check: (zoomCheck) => (zoomCheck?.up === 110 && zoomCheck?.winZoom === 100 && zoomCheck?.tb0 === zoomCheck?.tb1 && zoomCheck?.calZoom === '1.1'
      && zoomCheck?.at150 === 150 && zoomCheck?.acc?.made?.want === zoomCheck?.acc?.made?.got && !!zoomCheck?.acc?.made
      && zoomCheck?.acc?.moved?.days === 7 && zoomCheck?.acc?.bandOk === true
      && zoomCheck?.reset?.[0] === 100 && zoomCheck?.reset?.[1] === '' && /보드 110%/.test(zoomCheck?.toast ?? '')),
};
