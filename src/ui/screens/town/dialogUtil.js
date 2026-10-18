// Small helpers shared by the town / hero screens and their dialogs (DOM, via the kit).

/**
 * A modal dialog whose content is rebuilt from the state: `render(handle)` returns the body node;
 * it is called once at open and again after every state notification (`ctx.onState`) until the
 * dialog closes. Returns the kit dialog handle (+ `.refresh()`).
 */
export function liveDialog(ctx, { title, render, buttons, width, cls, icon, dismissable }) {
  const { h, clear } = ctx.ui;
  ensureDialogCss(ctx.ui);
  const body = h('div.town-dlg-live');
  const handle = ctx.ui.openDialog({
    title, icon, width, class: ['town-dlg', cls].filter(Boolean).join(' '), content: body, dismissable,
    buttons: buttons || [{ label: 'Close', value: null, default: true, cancel: true }],
  });
  const refresh = () => {
    if (!handle.isOpen()) return;
    try { clear(body, render(handle)); } catch (err) { ctx.showError(err); }
  };
  handle.refresh = refresh;
  const off = ctx.onState(() => refresh());
  handle.result.then(() => off());
  refresh();
  return handle;
}

/**
 * Run an engine action through `ctx.act`; on success let the player answer pending choices it
 * may have queued (level-ups after an altar sacrifice, ...). Returns the Result synchronously.
 */
export function act(ctx, fn, opts) {
  const res = ctx.act(fn, opts);
  if (res && res.ok !== false && ctx.state && Array.isArray(ctx.state.pending) && ctx.state.pending.length) {
    ctx.resolvePendings();
  }
  return res;
}

/** The hero who would use a town service: the visiting hero, else the garrison hero. */
export function serviceHero(state, town) {
  const id = town.visitingHero || town.garrisonHero;
  return id ? state.heroes[id] || null : null;
}

/** Inject a screen stylesheet once (no-op in Node tests without `import.meta.url` support). */
export function ensureCss(ui, href) {
  try {
    if (typeof document === 'undefined' || !document.head) return;
    if (Array.from(document.head.querySelectorAll('link')).some((l) => l.href === href)) return;
    document.head.appendChild(ui.h('link', { rel: 'stylesheet', href }));
  } catch { /* ignore */ }
}

const TOWN_CSS = new URL('./town.css', import.meta.url).href;
const HERO_CSS = new URL('../hero/hero.css', import.meta.url).href;

/** Make sure the stylesheets of the town / hero screens and their dialogs are loaded. */
export function ensureDialogCss(ui) {
  ensureCss(ui, TOWN_CSS);
  ensureCss(ui, HERO_CSS);
}

/** A small landscape thumbnail of a town's backdrop (gfx `town` sprites are 800x374 views). */
export function townThumb(ctx, faction, height = 48) {
  const c = ctx.sprite('town', faction, { size: height });
  c.classList.add('town-thumb');
  c.style.width = `${Math.round(height * 800 / 374)}px`;
  c.style.height = `${height}px`;
  return c;
}
