/** 우측 슬라이드 패널 전환. 한 번에 하나만 열린다. */
import { $ } from '../dom.js';

export class PanelManager {
  constructor(onClose, onReflow) {
    this.onClose = onClose;
    this.onReflow = onReflow;
    this.current = null;
    $('scrim').addEventListener('click', () => this.close());
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.close());
    }
  }

  open(id) {
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('open', p.id === id);
    $('scrim').classList.add('on');
    document.body.classList.add('panel-open');
    this.current = id;
    this.#reflow();
  }

  close() {
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('open');
    $('scrim').classList.remove('on');
    document.body.classList.remove('panel-open');
    this.current = null;
    this.onClose?.();
    this.#reflow();
  }

  /** 본문 폭이 바뀌었으니 좌표를 다시 읽어야 하는 것들에 알린다 (화살표 등) */
  #reflow() {
    this.onReflow?.();
    // 트랜지션이 끝난 뒤 최종 폭으로 한 번 더
    clearTimeout(this._t);
    this._t = setTimeout(() => this.onReflow?.(), 200);
  }

  get isOpen() { return this.current !== null; }
}
