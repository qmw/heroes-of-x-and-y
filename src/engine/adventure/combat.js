// Combat seam of the adventure engine: starting battles through the hero.js adapters and
// receiving their outcome. Context kinds used (all prefixed `adv_`):
//   adv_monster { objectId, then? }      wandering monster
//   adv_object  { objectId, stage, then? } guards of an object (bank, artifact, pandora, mine, dwelling, garrison, event)
//   adv_hero    { defenderHeroId, teleportTo? } hero vs hero
//   adv_town    { townId, objectId }     siege
import { getTerrain } from '../../data/terrain.js';
import { deps, hasRealDep, registerLocalCombatOutcome, getRealDep } from './deps.js';
import { getTile } from './map.js';
import { getPlayer } from './util.js';

const handlers = {};
let wired = false;

/** Register an outcome handler `fn(state, context, result) -> {events}` for a context kind. */
export function onCombatOutcome(kind, fn) {
  handlers[kind] = fn;
  registerLocalCombatOutcome(kind, fn);
  wired = false;
}

/** Register our handlers with the real hero.js (lazily: avoids import-cycle ordering problems). */
export function ensureCombatWired() {
  if (wired) return;
  const real = getRealDep('registerCombatOutcome');
  if (!real) return;
  for (const [kind, fn] of Object.entries(handlers)) real(kind, fn);
  wired = true;
}

/**
 * Start a battle with the hero as attacker.
 * @param {object} defender `{army}` | `{heroId}` | `{townId}`
 * @param {object} context  `{kind, ...}` plain JSON, handed back to the outcome handler
 * @param {{bank?:boolean, pos?:object, noOverlay?:boolean, spellLevelCap?:number}} [extra]
 */
export function beginCombat(state, hero, defender, context, extra = {}) {
  ensureCombatWired();
  const pos = extra.pos || hero.pos;
  const tile = getTile(state.map, pos);
  const opts = {
    attackerHeroId: hero.id,
    defender,
    terrain: hero.inBoat ? 'ship' : getTerrain(tile.t).battlefield,
    bank: !!extra.bank,
    context,
  };
  if (tile.overlay && !extra.bank && !extra.noOverlay) opts.overlay = tile.overlay;
  if (extra.spellLevelCap != null) opts.spellLevelCap = extra.spellLevelCap;
  const player = getPlayer(state, hero.owner);
  // a computer attacker fights at once - unless a human defends: then the battle is left in
  // state.combat for the human to play or quick-resolve (game.endTurn stops the AI turn, the UI
  // asks the defender); `settings.quickCombat` only applies to battles a human starts
  const computer = !!player && player.isHuman === false;
  const quick = computer ? !humanDefends(state, defender) : !!state.settings?.quickCombat;
  const res = quick ? deps.quickCombat(state, opts) : deps.startCombat(state, opts);
  return res || { ok: true, events: [] };
}

/** True when the defender of a battle (`{heroId}` / `{townId}` / `{army}`) belongs to a human player. */
export function humanDefends(state, defender) {
  if (!defender) return false;
  let owner = null;
  if (defender.heroId != null) owner = state.heroes[defender.heroId]?.owner ?? null;
  else if (defender.townId != null) owner = state.towns[defender.townId]?.owner ?? null;
  if (owner == null) return false;
  const p = getPlayer(state, owner);
  return !!p && p.isHuman === true;
}

/**
 * Start a battle and report it: on success `combatEvent` (the `{type:'combat', ...}` announcement)
 * and the battle's events are appended to `events`; when the combat adapter refuses (no army,
 * engine missing, ...) nothing is announced, a `{type:'combat_failed', error, ...}` event is appended
 * instead and `moveHero` turns it into `ok:false` (no phantom battle). @returns the adapter result
 */
export function fight(state, hero, events, combatEvent, defender, context, extra = {}) {
  const res = beginCombat(state, hero, defender, context, extra);
  if (res && res.ok === false) {
    const { type, ...rest } = combatEvent || {};
    events.push({ ...rest, type: 'combat_failed', heroId: hero.id, error: res.error || 'combat_failed' });
    return res;
  }
  if (combatEvent) events.push(combatEvent);
  if (res && res.events) events.push(...res.events);
  return res;
}

export const attackerWon = (result) => !!result && result.winner === 'attacker';

/** Surviving stacks of the defending (neutral) army as a 7-slot army. */
export function defenderSurvivors(result) {
  const army = (result && result.defender && result.defender.army) || [];
  const out = new Array(7).fill(null);
  army.slice(0, 7).forEach((s, i) => { if (s && s.count > 0) out[i] = { creatureId: s.creatureId, count: s.count }; });
  return out;
}

export { hasRealDep };
