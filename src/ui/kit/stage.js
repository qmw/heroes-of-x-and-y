// The logical stage: a fixed 1280x720 box scaled to the window with a CSS transform (letterboxed).
// Widgets that need absolute positioning (tooltips, popups, dialogs, toasts) ask this module for
// their layer and for client -> stage coordinate conversion. Without a stage (unit tests, or a
// widget used before createApp) everything falls back to document.body and identity coordinates.

export const STAGE_W = 1280;
export const STAGE_H = 720;

const stage = { el: null, scale: 1, layers: {} };

/** Called by app.js. `layers` = { screen, dialogs, toasts, tooltips }. */
export function setStage(el, layers = {}) {
  stage.el = el;
  stage.layers = layers;
  stage.scale = 1;
}

export function setStageScale(scale) { stage.scale = scale || 1; }
export function getStageScale() { return stage.scale; }
export function getStageEl() { return stage.el; }

/** Layer element by name ('dialogs' | 'toasts' | 'tooltips' | 'screen'); falls back to <body>. */
export function getLayer(name) {
  return stage.layers[name] || stage.el || document.body;
}

/** Convert viewport (client) coordinates to logical stage coordinates. */
export function clientToStage(clientX, clientY) {
  if (!stage.el || !stage.el.getBoundingClientRect) return { x: clientX, y: clientY };
  const r = stage.el.getBoundingClientRect();
  const s = stage.scale || 1;
  return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
}

/** Compute the fit scale + offsets for a window (pure; used by app.js and tests). */
export function fitStage(winW, winH, uiScale = 1) {
  const fit = Math.min(winW / STAGE_W, winH / STAGE_H);
  const scale = Math.max(0.1, fit * Math.min(1, Math.max(0.5, uiScale || 1)));
  return { scale, left: Math.round((winW - STAGE_W * scale) / 2), top: Math.round((winH - STAGE_H * scale) / 2) };
}

/** Place an absolutely positioned popup near (x, y) in stage coords, kept inside the stage. */
export function placeInStage(el, x, y, { offsetX = 14, offsetY = 18, width, height } = {}) {
  const w = width ?? el.offsetWidth ?? 0;
  const hh = height ?? el.offsetHeight ?? 0;
  let left = x + offsetX;
  let top = y + offsetY;
  if (left + w > STAGE_W - 4) left = Math.max(4, x - offsetX - w);
  if (top + hh > STAGE_H - 4) top = Math.max(4, y - offsetY - hh);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  return { left, top };
}
