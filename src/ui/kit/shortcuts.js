// Keyboard shortcut manager. Two scopes: 'global' (lives for the whole app) and 'screen'
// (cleared automatically when the screen changes). Open dialogs take priority over both - app.js
// routes keys to the dialog stack first (Esc closes the top dialog).
//
//   ctx.keys.bind('e', () => endTurn(), 'End turn');          // screen scope
//   ctx.keys.bind('ctrl+s', save, 'Quick save');
//   ctx.keys.bind(['arrowleft', 'a'], () => scroll(-1, 0));
//   ctx.keys.bindGlobal('f1', showHelp, 'Help');
//
// Combos are lower-case, modifiers in the order ctrl+alt+shift+key. Key names are
// `KeyboardEvent.key` lower-cased, with ' ' => 'space'. Letters/digits ignore Shift unless the
// binding asks for it ('shift+a').

/** Normalise a combo string: 'Shift+Ctrl+S' -> 'ctrl+shift+s'. */
export function normalizeCombo(combo) {
  const parts = String(combo).toLowerCase().split('+').map((p) => (p === ' ' ? 'space' : p.trim())).filter(Boolean);
  if (String(combo).endsWith('+') && String(combo).length > 0) parts.push('+');
  const key = parts.pop() || '';
  const mods = ['ctrl', 'alt', 'shift'].filter((m) => parts.includes(m) || (m === 'ctrl' && (parts.includes('cmd') || parts.includes('meta'))));
  return [...mods, KEY_ALIASES[key] || key].join('+');
}

const KEY_ALIASES = { ' ': 'space', spacebar: 'space', esc: 'escape', return: 'enter', del: 'delete',
  left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', plus: '+', minus: '-' };

/** Combo candidates for a keyboard event, most specific first. */
export function eventCombos(e) {
  let key = String(e.key ?? '').toLowerCase();
  key = KEY_ALIASES[key] || key;
  if (!key || key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return [];
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  const full = [...mods, ...(e.shiftKey ? ['shift'] : []), key].join('+');
  const noShift = [...mods, key].join('+');
  return e.shiftKey ? [full, noShift] : [full];
}

function isTyping(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'range', 'button'].includes(String(t.type || 'text'));
  return !!t.isContentEditable;
}

/**
 * @returns {{ bind, bindGlobal, unbind, clearScreen, handle, list, enabled }}
 */
export function createShortcuts() {
  const scopes = { global: new Map(), screen: new Map() };
  const api = {
    enabled: true,
    /** Bind in the screen scope. Returns an unbind function. */
    bind(combo, fn, description = '') { return add('screen', combo, fn, description); },
    bindGlobal(combo, fn, description = '') { return add('global', combo, fn, description); },
    unbind(combo, scope = 'screen') { for (const c of [].concat(combo)) scopes[scope].delete(normalizeCombo(c)); },
    clearScreen() { scopes.screen.clear(); },
    /**
     * Dispatch a keydown event. Returns true when a binding handled it.
     * Keys typed into text fields are ignored (except Escape and F-keys).
     */
    handle(e) {
      if (!api.enabled) return false;
      const combos = eventCombos(e);
      if (!combos.length) return false;
      const key = combos[combos.length - 1];
      if (isTyping(e) && key !== 'escape' && !/^f\d+$/.test(key)) return false;
      for (const scope of ['screen', 'global']) {
        for (const c of combos) {
          const b = scopes[scope].get(c);
          if (b) {
            const res = b.fn(e);
            if (res !== false && e.preventDefault) e.preventDefault();
            return true;
          }
        }
      }
      return false;
    },
    /** [{ combo, description, scope }] - for a help overlay. */
    list() {
      const out = [];
      for (const scope of ['screen', 'global']) {
        for (const [combo, b] of scopes[scope]) out.push({ combo, description: b.description, scope });
      }
      return out;
    },
  };
  function add(scope, combo, fn, description) {
    const combos = [].concat(combo).map(normalizeCombo);
    for (const c of combos) scopes[scope].set(c, { fn, description });
    return () => { for (const c of combos) if (scopes[scope].get(c)?.fn === fn) scopes[scope].delete(c); };
  }
  return api;
}

/** 'ctrl+s' -> 'Ctrl+S' (for hints in tooltips and the help list). */
export function comboLabel(combo) {
  return normalizeCombo(combo).split('+').map((p) => (p.length === 1 ? p.toUpperCase()
    : p.startsWith('arrow') ? { arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down' }[p]
      : p[0].toUpperCase() + p.slice(1))).join('+');
}
