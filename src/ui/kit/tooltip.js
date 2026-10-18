// Hover tooltips and the "right-click and hold" info popup of the original game.
import { h, toNode } from './dom.js';
import { getLayer, clientToStage, placeInStage } from './stage.js';

const TIP_DELAY = 350;
let tipEl = null;
let tipTimer = null;
let infoEl = null;

function hideTip() {
  if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
  if (tipEl) { tipEl.remove(); tipEl = null; }
}

function showTip(content, clientX, clientY) {
  hideTip();
  const node = toNode(content);
  if (!node || (node.textContent === '' && !node.children?.length)) return;
  tipEl = h('div.k-tooltip', null, node);
  getLayer('tooltips').appendChild(tipEl);
  const p = clientToStage(clientX, clientY);
  placeInStage(tipEl, p.x, p.y);
}

/**
 * Hover tooltip. `content` is a string, a node or a function returning either (evaluated lazily
 * each time, so it can show live values).
 *   attachTooltip(btn, 'End turn (E)');
 *   attachTooltip(slot, () => `${count} ${creature.name}`);
 * @returns {() => void} detach function
 */
export function attachTooltip(el, content, { delay = TIP_DELAY } = {}) {
  const enter = (e) => {
    hideTip();
    const x = e.clientX || 0;
    const y = e.clientY || 0;
    if (delay <= 0) showTip(content, x, y);
    else tipTimer = setTimeout(() => { tipTimer = null; showTip(content, x, y); }, delay);
    if (tipTimer && tipTimer.unref) tipTimer.unref();
  };
  const move = (e) => {
    if (!tipEl) return;
    const p = clientToStage(e.clientX || 0, e.clientY || 0);
    placeInStage(tipEl, p.x, p.y);
  };
  el.addEventListener('mouseenter', enter);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('mousedown', hideTip);
  return () => {
    el.removeEventListener('mouseenter', enter);
    el.removeEventListener('mousemove', move);
    el.removeEventListener('mouseleave', hideTip);
    el.removeEventListener('mousedown', hideTip);
  };
}

/** Hide any tooltip / info popup (called on screen change). */
export function hideTooltips() { hideTip(); hideInfoPopup(); }

/** Show an info popup at stage coords (used by attachInfo and by canvas screens). */
export function showInfoPopup(content, clientX = 0, clientY = 0) {
  hideInfoPopup();
  hideTip();
  const node = toNode(content);
  infoEl = h('div.k-infopopup', null, node);
  getLayer('tooltips').appendChild(infoEl);
  const p = clientToStage(clientX, clientY);
  placeInStage(infoEl, p.x, p.y, { offsetX: 10, offsetY: 10 });
  return infoEl;
}

export function hideInfoPopup() {
  if (infoEl) { infoEl.remove(); infoEl = null; }
}

export function isInfoPopupOpen() { return !!infoEl; }

/**
 * Right-click-and-hold info popup (like the original): while the right mouse button is held on
 * `el`, a panel built by `contentFn(event)` is shown; releasing the button hides it.
 *   attachInfo(slotEl, () => CreatureCard({ creatureId: 'pikeman', count: 20 }));
 * Also suppresses the browser context menu on the element.
 * @returns {() => void} detach function
 */
export function attachInfo(el, contentFn) {
  const down = (e) => {
    if (e.button !== 2) return;
    if (e.preventDefault) e.preventDefault();
    const content = typeof contentFn === 'function' ? contentFn(e) : contentFn;
    if (content == null) return;
    showInfoPopup(content, e.clientX || 0, e.clientY || 0);
    const up = () => {
      hideInfoPopup();
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };
  const menu = (e) => { if (e.preventDefault) e.preventDefault(); };
  el.addEventListener('mousedown', down);
  el.addEventListener('contextmenu', menu);
  return () => {
    el.removeEventListener('mousedown', down);
    el.removeEventListener('contextmenu', menu);
  };
}
