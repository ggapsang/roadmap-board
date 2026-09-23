/**
 * 화면 상태 — 저장되지도, 되돌려지지도 않는다.
 * 필터 · 검색 · 확대 배율 · 선택. 문서 상태(Store)와 엄격히 분리한다.
 */
import { Emitter } from './emitter.js';
import { STATUS_KEYS, ZOOM_LEVELS } from '../config/index.js';

const defaultZoom = (ZOOM_LEVELS.find((z) => z.default) ?? ZOOM_LEVELS[0]).weekHeight;

export class ViewState extends Emitter {
  constructor() {
    super();
    this.statusFilter = new Set(STATUS_KEYS);
    this.orgFilter = new Set();          // 비어 있으면 전체 표시
    this.query = '';
    this.weekHeight = defaultZoom;
    this.selectedItem = null;
    this.selectedTrack = null;
    /** 카드 글자를 긁어 복사할 수 있는 모드. 켜면 드래그 이동이 멈춘다. */
    this.textSelect = false;
  }

  /** px per day */
  get ppd() { return this.weekHeight / 7; }

  set(patch, reason = 'view') {
    Object.assign(this, patch);
    this.emit('change', { reason, patch });
  }

  toggleStatus(key) {
    this.statusFilter.has(key) ? this.statusFilter.delete(key) : this.statusFilter.add(key);
    this.emit('change', { reason: 'filter' });
  }

  toggleOrg(org) {
    this.orgFilter.has(org) ? this.orgFilter.delete(org) : this.orgFilter.add(org);
    this.emit('change', { reason: 'filter' });
  }

  /** 필터 통과 여부. 검색어는 숨기지 않고 흐리게 처리하므로 여기서 보지 않는다. */
  isVisible(item) {
    if (!this.statusFilter.has(item.st)) return false;
    if (this.orgFilter.size && !this.orgFilter.has(item.og)) return false;
    return true;
  }

  /** 검색 매칭 여부. query가 비면 null (강조/흐림 없음). */
  matches(item) {
    if (!this.query) return null;
    return `${item.ti} ${item.og} ${item.note ?? ''}`.toLowerCase().includes(this.query);
  }
}
