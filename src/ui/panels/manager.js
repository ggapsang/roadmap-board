/** 우측 슬라이드 패널 전환. 한 번에 하나만 열린다. */
import { $ } from '../dom.js';

export class PanelManager {
  constructor(onClose) {
    this.onClose = onClose;
    this.current = null;
    $('scrim').addEventListener('click', () => this.close());
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.close());
    }
  }

  open(id) {
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('open', p.id === id);
    $('scrim').classList.add('on');
    this.current = id;
  }

  close() {
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('open');
    $('scrim').classList.remove('on');
    this.current = null;
    this.onClose?.();
  }

  get isOpen() { return this.current !== null; }
}
