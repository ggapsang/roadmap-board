// 스모크 단계 'style-ui' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'style-ui',
  areas: ["panel","board"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, db, wrote }) {
    // 스타일 탭(채우기·비고 표시) · 매핑 탭(제목·'편집') · 팝업 끌어 옮기기
    let styleUi = null;
    if (wrote) {
      styleUi = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
          const id = it.id;
          const node = () => document.querySelector('.col [data-id="' + id + '"]');
          const noteBefore = it.place.showNote;
          document.querySelector('[data-id="' + id + '"]').click();
          await sleep(250);
          const tabName = document.querySelector('#pItem .ptab[data-tab="disp"]').textContent.trim();
          document.querySelector('#pItem .ptab[data-tab="disp"]').click();
          await sleep(80);
          // 채우기 — 파랑
          document.querySelector('#i-fill .fill-sw[data-fill="blue"]').click();
          await sleep(150);
          const filled = node()?.dataset.fill === 'blue' && r.store.item(id).place.fill === 'blue';
          const bg = node() ? getComputedStyle(node()).backgroundImage : '';
          const painted = /gradient/.test(bg);
          // 점 마일스톤·하위 카드도 채우기가 보인다(자체 배경 규칙이 채우기를 덮던 버그)
          const pointMs = r.store.items.find((x) => x.ty === 'ms' && x.s === x.e && !x.parent);
          const childCard = r.store.items.find((x) => x.parent && x.ty !== 'ms');
          r.store.commit('채우기 점검', () => { pointMs.place.fill = 'green'; childCard.place.fill = 'pink'; });
          await sleep(120);
          const painted2 = (el) => !!el && /gradient/.test(getComputedStyle(el).backgroundImage);
          const pmEl = document.querySelector('.col [data-id="' + pointMs.id + '"]');
          const chEl = document.querySelector('[data-id="' + childCard.id + '"]');
          const msFilled = painted2(pmEl);
          const childFilled = painted2(chEl);
          r.store.commit('채우기 점검 원복', () => { pointMs.place.fill = null; childCard.place.fill = null; });
          await sleep(80);
          // 빗금 — 채우기 팔레트의 한 칸. 사선 무늬(repeating-linear-gradient)로 그린다
          document.querySelector('#i-fill .fill-sw[data-fill="hatch"]').click();
          await sleep(150);
          const hatchBg = node() ? getComputedStyle(node()).backgroundImage : '';
          const hatched = r.store.item(id).place.fill === 'hatch' && /repeating-linear-gradient/.test(hatchBg);
          document.querySelector('#i-fill .fill-sw[data-fill="blue"]').click();
          await sleep(150);
          // 비고 — 기본 숨김, 켜면 카드에
          const hiddenByDefault = noteBefore === false && !node()?.querySelector('.card-note');
          r.store.commit('비고', () => { r.store.item(id).note = '스모크 비고'; });
          await sleep(80);
          document.querySelector('#i-shownote .seg-btn[data-note="on"]').click();
          await sleep(150);
          const noteShown = node()?.querySelector('.card-note')?.textContent === '스모크 비고';
          document.querySelector('#i-shownote .seg-btn[data-note="off"]').click();
          await sleep(120);
          const noteHidden = !node()?.querySelector('.card-note');
          // 매핑 — 제목 4개, 버튼 전부 '편집'
          document.querySelector('#pItem .ptab[data-tab="rel"]').click();
          await sleep(300);
          const titles = [...document.querySelectorAll('#pItem .map-title')].map((h) => h.textContent.trim());
          const btns = ['i-same', 'i-combine', 'i-parent', 'i-deps', 'i-refs'].map((x) => document.querySelector('#' + x + ' > button.btn')?.textContent.trim());
          // 조합설정 팝업 — 현재 보드의 이벤트는 트리에 나오지 않는다(모순). 다른 보드를 하나 두고 본다.
          const other = await r.adapter.duplicateProject(r.adapter.projectId, '조합 후보 보드');
          document.querySelector('#i-combine > button.btn').click();
          await sleep(600);
          const rowIds = [...document.querySelectorAll('.dlg-tree-row')].map((x) => x.dataset.id);
          const hereIds = new Set([...r.store.tracks.map((t) => t.id), ...r.store.items.map((x) => x.id)]);
          const noCurrentInCombine = rowIds.length > 0 && !rowIds.some((x) => hereIds.has(x));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(100);
          await r.adapter.deleteProject(other);
          // 팝업 — 제목을 잡고 끌면 옮겨지고, 막 위에서 놓아도 닫히지 않는다
          document.querySelector('#i-deps > button.btn').click();
          await sleep(300);
          const box = document.querySelector('.dlg-scrim:not([hidden]) .dlg');
          const h = box.querySelector('h2');
          const b0 = box.getBoundingClientRect();
          const hr = h.getBoundingClientRect();
          const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7 });
          h.dispatchEvent(new PointerEvent('pointerdown', at(hr.left + 20, hr.top + 5)));
          window.dispatchEvent(new PointerEvent('pointermove', at(hr.left + 140, hr.top + 85)));
          window.dispatchEvent(new PointerEvent('pointerup', at(hr.left + 140, hr.top + 85)));
          const b1 = box.getBoundingClientRect();
          const moved = Math.round(b1.left - b0.left) === 120 && Math.round(b1.top - b0.top) === 80;
          // 막에서 누르지 않은 클릭(끌기 끝 등)은 닫지 않는다
          const scrim = box.parentElement;
          scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await sleep(50);
          const stillOpen = !scrim.hidden && document.body.contains(box);
          // 막에서 누르고 떼면 닫힌다
          scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await sleep(50);
          const closedOnScrim = scrim.hidden;
          document.querySelector('#pItem [data-close]')?.click();
          const detailLabel = document.querySelector('#i-children').closest('.fld').querySelector('label').firstChild.textContent.trim();
          const sizeLabel = document.getElementById('i-fixedh').closest('.fld').querySelector('label').textContent.trim();
          const descBlock = getComputedStyle(document.querySelector('#pItem .fld > label .desc')).display === 'block';
          return { id, tabName, filled, painted, hatched, msFilled, childFilled, hiddenByDefault, noteShown, noteHidden, titles, btns, moved, stillOpen, closedOnScrim, noCurrentInCombine, detailLabel, sizeLabel, descBlock };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      await new Promise((res) => setTimeout(res, 300));
      // DB 왕복 — 채우기는 배치(disp)에 저장된다
      try {
        const row = db.prepare('SELECT fill FROM disp WHERE child_id = ?').get(styleUi?.id ?? '');
        styleUi.dbFill = row?.fill ?? null;
      } catch (err) { styleUi = { ...(styleUi ?? {}), dbError: String(err) }; }
      console.log('[smoke] style-ui ' + JSON.stringify(styleUi));
    }
    return styleUi;
  },
  check: (styleUi) => styleUi?.tabName === '스타일'
    && styleUi?.filled === true
    && styleUi?.painted === true
    && styleUi?.hatched === true
    && styleUi?.msFilled === true
    && styleUi?.childFilled === true
    && styleUi?.dbFill === 'blue'
    && styleUi?.hiddenByDefault === true
    && styleUi?.noteShown === true
    && styleUi?.noteHidden === true
    && JSON.stringify(styleUi?.titles) === JSON.stringify(['항등설정', '조합설정', '모자관계설정', '선행관계설정', '참조관계설정'])
    && (styleUi?.btns ?? []).length === 5
    && styleUi.btns.every((t) => t === '편집')
    && styleUi?.moved === true
    && styleUi?.stillOpen === true
    && styleUi?.closedOnScrim === true
    && styleUi?.noCurrentInCombine === true
    && styleUi?.detailLabel === '세부내역'
    && styleUi?.sizeLabel === '사이즈 수동 설정'
    && styleUi?.descBlock === true,
};
