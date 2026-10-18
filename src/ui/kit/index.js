// The UI kit. `ctx.ui` is this module's namespace: `ctx.ui.Button(...)`, `await ctx.ui.confirm(...)`.
// Widgets are PascalCase factories returning their root element (with a small API attached);
// helpers are camelCase. Full reference with examples: docs/mechanics/ui.md.
export * from './dom.js';
export * from './stage.js';
export * from './button.js';
export * from './tooltip.js';
export * from './dialog.js';
export * from './widgets.js';
export * from './toast.js';
export * from './shortcuts.js';
export * from './anim.js';
export * from './canvas.js';
export * from './resourceBar.js';
export * from './creatureCard.js';
export * from './armyRow.js';
export * from './heroWidgets.js';
export * from './artifacts.js';
export * from './spellbook.js';
export * from './minimap.js';
export * from './pending.js';
export { sprite, drawSprite, placeholder, hasGfx } from '../sprites.js';
