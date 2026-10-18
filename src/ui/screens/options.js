// Options screen: every control writes straight to ctx.settings (persisted in localStorage).
import { DEFAULT_SETTINGS } from '../storage.js';

export function mount(root, ctx) {
  const ui = ctx.ui;
  const { h, clear } = ui;
  const s = ctx.settings;
  const body = h('div.opt-body');

  const percent = (v) => `${Math.round(v * 100)}%`;
  function sliderRow(label, key, { min, max, step, format = percent, hint, onCommit }) {
    const value = h('span.opt-value', null, format(s.get(key)));
    const slider = ui.Slider({ min, max, step, value: s.get(key),
      onChange: (v) => { s.set(key, v); value.textContent = format(s.get(key)); },
      onCommit: () => { if (onCommit) onCommit(); } });
    return ui.Field(label, h('div.k-row', null, slider, value), hint);
  }
  const check = (label, key, hint) => ui.Field(label, ui.Checkbox({ label: hint, checked: !!s.get(key), onChange: (v) => s.set(key, v) }));

  function render() {
    clear(body,
      h('h3.opt-h', null, 'Sound'),
      sliderRow('Volume', 'volume', { min: 0, max: 1, step: 0.05, onCommit: () => ctx.audio.play('coin') }),
      check('Mute', 'muted', 'Silence all sound effects'),
      h('div.k-row', null, ['click', 'coin', 'sword', 'spell', 'levelup', 'daystart'].map((n) => ui.Button(n, { size: 'sm', sound: n }))),
      h('h3.opt-h', null, 'Game'),
      ui.Field('Animation speed', h('div.k-row', null, [0.5, 1, 2, 4].map((v) => ui.Button(`${v}x`, { size: 'sm', active: s.get('animSpeed') === v, onClick: () => { s.set('animSpeed', v); render(); } }))),
        'How fast heroes walk and battles animate.'),
      check('Autosave', 'autosave', 'Save automatically at the start of every turn'),
      check('Quick combat', 'quickCombat', 'Resolve battles automatically'),
      check('Confirm end turn', 'confirmEndTurn', 'Ask before ending the turn while heroes can still move'),
      h('h3.opt-h', null, 'Display'),
      check('Show grid', 'showGrid', 'Draw a grid over the adventure map and the battlefield'),
      check('Edge scrolling', 'edgeScroll', 'Scroll the map when the pointer touches the screen edge'),
      sliderRow('UI scale', 'uiScale', { min: 0.5, max: 1, step: 0.05, hint: 'Share of the window used by the game (it always keeps a 16:9 shape).' }));
  }

  root.appendChild(h('div.opt', null,
    h('div.opt-heading', null, 'Options'),
    ui.Panel({ class: 'opt-panel' }, body),
    h('div.k-row.k-row-center', null,
      ui.Button('Defaults', { onClick: async () => { if (await ui.confirm('Reset every option to its default?', { title: 'Options' })) { s.reset(); render(); } } }),
      ui.Button('Back', { kind: 'primary', hotkey: 'Esc', onClick: () => ctx.back() }))));
  ctx.keys.bind('escape', () => ctx.back(), 'Back');
  render();
  return { render, defaults: DEFAULT_SETTINGS };
}

export function unmount() {}
