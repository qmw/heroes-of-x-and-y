// Calendar hooks of the adventure map: daily / weekly ticks, mine income, monthly monster spawns.
import { RESOURCES } from '../../core/constants.js';
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { getCreature } from '../../data/creatures.js';
import { randInt } from '../../core/rng.js';
import { getTile, addObject, getHeroAt, objectsByEffect } from './map.js';
import { refreshVision } from './fog.js';
import { rollWeeklyReward, rollRefugeeCamp, rollBlackMarket, resetDwellingStock } from './init.js';
import { growMonster } from './monsters.js';
import { mineOutput } from './visit.js';
import { ok, weekNumber } from './util.js';

/** Start of every day: refresh what each player sees. (Per-hero daily flags are compared by turn.) */
export function startOfDayAdventure(state) {
  for (const p of state.players) if (p.alive !== false) refreshVision(state, p.id);
  return ok([]);
}

/**
 * Day 1 of a week: weekly rewards re-rolled, refugee camps / weekly markets restocked (monthly ones on
 * the first week of a month), dwelling stock reset, wandering monsters grow 10% (never at map start).
 * Banks do not refill.
 */
export function startOfWeekAdventure(state) {
  const week = weekNumber(state);
  const events = [];
  const newMonth = (week - 1) % 4 === 0;
  for (const obj of Object.values(state.map.objects)) {
    const fx = getMapObject(obj.defId).effect;
    switch (fx.type) {
      case 'weekly_reward': rollWeeklyReward(state, obj, fx); break;
      case 'refugee_camp': rollRefugeeCamp(state, obj, fx); break;
      case 'black_market': if (fx.restock === 'weekly' || (fx.restock === 'monthly' && newMonth)) rollBlackMarket(state, obj, fx); break;
      case 'dwelling': resetDwellingStock(state, obj, fx); break;
      case 'monster': if (week > 1) growMonster(obj); break;
      default: break;
    }
  }
  events.push({ type: 'adventure_week', week });
  return ok(events);
}

/** Daily income from flagged mines: `{ resource: amount }` (zero entries omitted). */
export function getMineIncome(state, playerId) {
  const out = {};
  if (playerId == null) return out;
  for (const obj of objectsByEffect(state, 'mine')) {
    if (obj.owner !== playerId) continue;
    const { resource, amount } = mineOutput(obj);
    if (!RESOURCES.includes(resource)) continue;
    out[resource] = (out[resource] || 0) + amount;
  }
  return out;
}

/** "Month of the X": wandering stacks of X appear on free land tiles (about one per 300 tiles). */
export function spawnMonthMonsters(state, creatureId) {
  getCreature(creatureId);
  const map = state.map;
  const events = [];
  const want = Math.max(1, Math.floor((map.width * map.height) / 300));
  let placed = 0;
  for (let i = 0; i < want * 30 && placed < want; i++) {
    const pos = { x: randInt(state.rng, 0, map.width - 1), y: randInt(state.rng, 0, map.height - 1), z: 0 };
    const tile = getTile(map, pos);
    const ter = getTerrain(tile.t);
    if (tile.blocked || tile.obj || tile.road || !ter.passable || ter.water || getHeroAt(state, pos)) continue;
    const obj = addObject(state, 'monster', pos, { data: { creatureId } });
    events.push({ type: 'monster_spawned', objectId: obj.id, creatureId, pos });
    placed++;
  }
  return ok(events);
}
