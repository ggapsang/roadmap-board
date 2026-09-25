/**
 * 데이터 패널 — 표시 기간, JSON 반출/반입, 변경 이력, 초기화.
 * 변경 이력 섹션은 SQLite(Electron)에서만 나타난다.
 */
import { SEED } from '../../config/seed.js';
import { $, el, clear, button } from '../dom.js';
import { toast } from '../toast.js';

export class DataPanel {
  constructor({ store, view, panels, adapter, onReplaced }) {
    Object.assign(this, { store, view, panels, adapter, onReplaced });
    this.#bind();
  }

  #bind() {
    $('d-start').addEventListener('change', () => this.#setRange('start', $('d-start').value));
    $('d-end').addEventListener('change', () => this.#setRange('end', $('d-end').value));

    $('d-trim').addEventListener('click', () => this.#trim());
    $('d-copy').addEventListener('click', () => this.#copy());
    $('d-load').addEventListener('click', () => this.#applyJson());
    $('d-reset').addEventListener('click', () => this.#reset());

    $('d-export').addEventListener('click', () => this.#exportFile());
    $('d-import').addEventListener('click', () => this.#importFile());
  }

  open() {
    $('d-json').value = this.store.toJSON();
    this.syncRange();
    this.#renderHistory();
    this.panels.open('pData');
  }

  syncRange() {
    $('d-start').value = this.store.meta.start;
    $('d-end').value = this.store.meta.end;
  }

  #setRange(which, value) {
    if (!value) return;
    const meta = this.store.meta;
    if (which === 'start' && value >= meta.end) { toast('시작일은 종료일보다 앞서야 합니다', 'warn'); this.syncRange(); return; }
    if (which === 'end' && value <= meta.start) { toast('종료일은 시작일보다 뒤여야 합니다', 'warn'); this.syncRange(); return; }
    this.store.commit('표시 기간', (doc) => { doc.meta[which] = value; });
    this.onReplaced?.();
  }

  /**
   * 표시 기간을 실제 일정 범위에 맞춘다 — 맨 앞·뒤의 빈 구간을 없앤다.
   * 내보내기(PNG) 때 빈 칸이 과도한 문제를 없앤다. ISO 문자열 비교 = 날짜순.
   */
  #trim() {
    const items = this.store.items;
    if (!items.length) { toast('일정이 없어 자를 수 없습니다', 'warn'); return; }
    let min = null, max = null;
    for (const it of items) {
      if (it.s && (min === null || it.s < min)) min = it.s;
      const e = it.e || it.s;
      if (e && (max === null || e > max)) max = e;
    }
    if (!min || !max) return;
    if (min === this.store.meta.start && max === this.store.meta.end) {
      toast('이미 일정에 맞춰져 있습니다');
      return;
    }
    this.store.commit('여백 자르기', (doc) => { doc.meta.start = min; doc.meta.end = max; });
    this.syncRange();
    this.onReplaced?.();
    toast('일정 범위에 맞춰 여백을 잘랐습니다');
  }

  async #copy() {
    try {
      await navigator.clipboard.writeText($('d-json').value);
      toast('클립보드에 복사했습니다');
    } catch {
      $('d-json').select();
      toast('Ctrl+C로 복사해 주세요');
    }
  }

  #applyJson() {
    let parsed;
    try {
      parsed = JSON.parse($('d-json').value);
    } catch {
      toast('JSON 형식을 확인해 주세요', 'warn');
      return;
    }
    this.#replace(parsed, 'JSON 적용');
  }

  #replace(raw, label) {
    const { ok, error, warnings } = this.store.replace(raw, label);
    if (!ok) { toast(error, 'warn'); return false; }
    this.onReplaced?.();
    this.panels.close();
    if (warnings.length) toast(`적용했습니다 · 보정 ${warnings.length}건: ${warnings[0]}`, 'warn');
    else toast('데이터를 적용했습니다');
    return true;
  }

  #reset() {
    if (!confirm('기본 로드맵으로 되돌립니다. 현재 편집 내용은 사라집니다.')) return;
    if (this.#replace(structuredClone(SEED), '기본 로드맵 복원')) {
      toast('기본 로드맵으로 복원했습니다');
    }
  }

  // ── 파일 반출입 (Electron) ──────────────────────────────

  async #exportFile() {
    const json = this.store.toJSON(2);
    const name = `roadmap-${new Date().toISOString().slice(0, 10)}.json`;

    if (this.adapter.exportJson) {
      const saved = await this.adapter.exportJson(json, name);
      if (saved) toast('저장했습니다: ' + saved);
      return;
    }
    // 브라우저 폴백
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
    toast('파일을 내려받았습니다');
  }

  async #importFile() {
    if (this.adapter.importJson) {
      const text = await this.adapter.importJson();
      if (!text) return;
      try { this.#replace(JSON.parse(text), '파일 반입'); }
      catch { toast('JSON 형식을 확인해 주세요', 'warn'); }
      return;
    }
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { this.#replace(JSON.parse(await file.text()), '파일 반입'); }
      catch { toast('JSON 형식을 확인해 주세요', 'warn'); }
    });
    input.click();
  }

  // ── 변경 이력 (SQLite 전용) ─────────────────────────────

  async #renderHistory() {
    const section = $('d-history');
    if (!this.adapter.hasHistory) { section.hidden = true; return; }
    section.hidden = false;

    const list = $('d-revisions');
    clear(list);
    let rows = [];
    try { rows = await this.adapter.listRevisions(30); } catch { /* noop */ }

    if (!rows.length) {
      list.append(el('p.note', { text: '아직 저장된 이력이 없습니다.' }));
      return;
    }

    for (const row of rows) {
      list.append(el('div.trow', {}, [
        el('div.names', {}, [
          el('span', { text: row.created_at, style: { fontSize: '12px', fontWeight: '500' } }),
          el('span', { text: `${row.items}건${row.label ? ' · ' + row.label : ''}`, style: { fontSize: '11px', color: 'var(--text-tertiary)' } }),
        ]),
        button({ className: 'btn outline', label: '복원', onClick: () => this.#restore(row.id) }),
      ]));
    }
  }

  async #restore(id) {
    if (!confirm('이 시점으로 되돌립니다. 현재 내용은 되돌리기(Ctrl+Z)로 복구할 수 있습니다.')) return;
    const doc = await this.adapter.getRevision(id);
    if (!doc) { toast('이력을 찾을 수 없습니다', 'warn'); return; }
    this.#replace(doc, '이력 복원');
  }
}
