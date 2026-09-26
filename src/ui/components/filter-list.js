/**
 * 필터 리스트 — 엑셀 필터식 "검색창 + 목록" 콤보.
 *
 * 카드를 무언가에 잇는 UI(선행·상위·별칭)를 하나로 통일하기 위한 재사용 부품이다.
 * 검색어를 치면 이름이 맞는 후보만 남고, 비우면 전체가 보인다. 팝업이 아니라 패널 안에
 * 늘 펼쳐진 목록이라, 곁의 다른 필드와 같은 흐름으로 읽힌다.
 *
 *   mode 'single'  하나만 고른다 (상위 일정·보드 별칭). '없음' 항목을 목록에 넣어 해제.
 *   mode 'multi'   여럿 고른다 (선행 일정). 각 항목에 체크.
 *
 * 선택 상태는 바깥(문서)이 진실이다. onChange가 문서를 바꾸고, 컴포넌트는 isSelected를
 * 다시 물어 스스로 다시 그린다 — 자체 상태를 들지 않아 어긋날 일이 없다.
 */
import { el, clear, icon, ICONS } from '../dom.js';

/**
 * @param {object} opts
 *   mode        'single' | 'multi'
 *   placeholder 검색창 안내문
 *   emptyText   후보가 없을 때 문구
 *   isSelected  (id) => boolean  현재 선택 여부 (문서에서 읽는다)
 *   onChange    (id, next) => void  next=선택될 상태(single은 항상 true)
 * @returns {{root:HTMLElement, render:(options)=>void, refresh:()=>void}}
 *   options = [{ id, label, sub }]
 */
export function createFilterList({ mode = 'single', placeholder = '검색…', emptyText = '후보가 없습니다.', isSelected = () => false, onChange }) {
  let options = [];
  let query = '';

  const input = el('input.fl-input', {
    type: 'text', placeholder,
    on: { input: (e) => { query = e.target.value.trim().toLowerCase(); paint(); } },
  });
  const search = el('div.fl-search', {}, [icon(ICONS.search), input]);
  const listBox = el('div.fl-options', { attrs: { role: 'listbox' } });
  const root = el('div.filter-list', { dataset: { mode } }, [search, listBox]);

  const match = (o) => !query || `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(query);

  function paint() {
    clear(listBox);
    const shown = options.filter(match);
    if (!shown.length) {
      listBox.append(el('div.fl-empty', { text: query ? '검색 결과 없음' : emptyText }));
      return;
    }
    for (const o of shown) {
      const on = isSelected(o.id);
      const row = el('div.fl-opt', {
        dataset: { id: o.id }, attrs: { role: 'option', 'aria-selected': String(on) },
      });
      if (on) row.classList.add('sel');
      // 실제 네모 체크박스. 행 클릭이 토글을 담당하므로 입력은 표시용(pointer-events 없음).
      const box = el('input.fl-box', { type: 'checkbox', checked: on, tabIndex: -1 });
      box.style.pointerEvents = 'none';
      row.append(box);
      row.append(el('span.fl-label', {}, [
        document.createTextNode(o.label),
        o.sub ? el('em', { text: o.sub }) : null,
      ]));
      // 다중이든 단일이든 클릭하면 토글 — 켜진 걸 다시 누르면 꺼진다(=없음).
      row.addEventListener('click', () => {
        onChange(o.id, !on);
        paint();
      });
      listBox.append(row);
    }
  }

  return {
    root,
    render(opts) { options = Array.isArray(opts) ? opts : []; paint(); },
    refresh: paint,
  };
}
