/**
 * 휴지통 — 보드에서 빠져 부모를 모두 잃은 이벤트 (docs/SAVE.md §7).
 *
 * 첫 화면의 버튼으로 연다. 목록을 바로 펼쳐 두지 않고 팝업으로만 다룬다.
 *   영구 삭제  그 이벤트와 그 안에만 든 것을 지운다. 다른 곳에도 든 것은 남는다.
 *   비우기     전부 영구 삭제.
 * 영구 삭제 = SYSTEM.md의 '이벤트 삭제'(연결된 포함·배치·관계 전부 제거). 되돌릴 수 없어 매번 묻는다.
 */
import { el, clear, icon, ICONS } from './dom.js';
import { askConfirm, dialogOpen } from './dialog.js';
import { toast } from './toast.js';
import { shortMD } from '../core/dates.js';

const TYPE_LABEL = { task: '태스크', ms: '마일스톤' };

/** @param {import('../core/storage.js').StorageAdapter} adapter */
export function openTrash(adapter) {
  const scrim = el('div.dlg-scrim');
  const list = el('div.trash-list');
  const count = el('span.trash-count');
  const emptyBtn = el('button.btn.danger', { type: 'button', text: '비우기', on: { click: () => emptyAll() } });
  let rows = [];
  let busy = false;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape' || busy || dialogOpen()) return;   // 확인 창이 떠 있으면 그쪽 몫
    e.preventDefault(); e.stopPropagation(); close();
  };

  function paint() {
    clear(list);
    count.textContent = rows.length ? `${rows.length}건` : '';
    emptyBtn.disabled = !rows.length;
    if (!rows.length) { list.append(el('div.empty', { text: '휴지통이 비어 있습니다.' })); return; }
    for (const r of rows) {
      const kind = TYPE_LABEL[r.type] ?? '일정';
      const when = r.s ? (r.s === r.e ? shortMD(r.s) : `${shortMD(r.s)} – ${shortMD(r.e)}`) : '';
      const sub = [kind, when, r.inside ? `안에 ${r.inside}건` : ''].filter(Boolean).join(' · ');
      list.append(el('div.trash-row', { dataset: { id: r.id } }, [
        el('span.st-dot', { className: 'st-dot st-' + (r.st || 'plan') }),
        el('div.trash-main', {}, [
          el('div.trash-title', { text: r.title || '(제목 없음)' }),
          el('div.trash-sub', { text: sub }),
        ]),
        el('button.btn.outline.sm.trash-del', {
          type: 'button', title: '영구 삭제', on: { click: () => purgeOne(r) },
        }, [icon(ICONS.trash), document.createTextNode('영구 삭제')]),
      ]));
    }
  }

  async function reload() {
    try { rows = (await adapter.listTrash()) ?? []; } catch (err) { rows = []; toast('휴지통을 읽지 못했습니다: ' + err.message, 'warn'); }
    paint();
  }

  async function purgeOne(r) {
    busy = true;
    const inner = r.inside ? ` 안에만 든 ${r.inside}건도 함께 지웁니다.` : '';
    const ok = await askConfirm({
      title: '영구 삭제', confirmLabel: '영구 삭제', danger: true,
      message: `'${r.title || '(제목 없음)'}'을(를) 영구 삭제합니다.${inner} 다른 보드에도 있는 것은 남습니다. 되돌릴 수 없습니다.`,
    });
    busy = false;
    if (!ok) return;
    try { await adapter.purgeTrash([r.id]); } catch (err) { toast('삭제 실패: ' + err.message, 'warn'); }
    await reload();
  }

  async function emptyAll() {
    if (!rows.length) return;
    busy = true;
    const ok = await askConfirm({
      title: '휴지통 비우기', confirmLabel: '비우기', danger: true,
      message: `휴지통의 ${rows.length}건과 그 안에만 든 것을 모두 영구 삭제합니다. 되돌릴 수 없습니다.`,
    });
    busy = false;
    if (!ok) return;
    try {
      const res = await adapter.emptyTrash();
      toast(`${res?.purged ?? 0}건을 영구 삭제했습니다`);
    } catch (err) { toast('비우기 실패: ' + err.message, 'warn'); }
    await reload();
  }

  const box = el('div.dlg.dlg-wide.trash-dlg', { on: { click: (e) => e.stopPropagation() } }, [
    el('h2', {}, [document.createTextNode('휴지통 '), count]),
    el('p.note', { text: '보드에서 빼서 어디에도 담기지 않은 이벤트입니다. 방금 만들었다 바로 지운 것은 여기 오지 않고 바로 없어집니다.' }),
    list,
    el('div.dlg-actions', {}, [
      emptyBtn,
      el('div.grow'),
      el('button.btn.outline', { type: 'button', text: '닫기', on: { click: () => close() } }),
    ]),
  ]);
  scrim.append(box);
  scrim.addEventListener('click', () => { if (!busy) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  list.append(el('div.empty', { text: '불러오는 중…' }));
  reload();
  return close;
}
