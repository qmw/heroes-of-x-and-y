// initObject(state, obj): rolls the instance data of a freshly placed map object ("rolled at map
// start" in docs/mechanics/adventure-objects.md). Fields already present in obj.data are kept, so
// scenarios / the map generator can pin anything.
import { PRIMARY_SKILLS } from '../../core/constants.js';
import { randInt, pick, shuffle } from '../../core/rng.js';
import { getMapObject, MONSTER_DISPOSITIONS, MONSTER_COUNT_BY_TIER, PANDORA_PRESETS } from '../../data/mapObjects.js';
import { CREATURES, getCreature } from '../../data/creatures.js';
import { SKILL_IDS } from '../../data/skills.js';
import { HEROES } from '../../data/heroes.js';
import { rollRange, rollTable, pickDistinct, splitGuards, emptyArmy, armyFromList, weekNumber, dist2 } from './util.js';
import { resolveReward, rollArtifact, rollSpell } from './rewards.js';
import { pairSubterraneanGates, objectsByEffect } from './map.js';

export const PUZZLE_COLS = 8;
export const PUZZLE_ROWS = 6;

/** Guard army: explicit army / list in data wins, otherwise built from the definition entries. */
function guardArmy(state, entries) {
  return splitGuards(entries.map((e) => ({ creatureId: e.creatureId, count: rollRange(state.rng, e.count), stacks: e.stacks || 1 })));
}

function normalizeArmyField(data, key) {
  if (!data[key]) return;
  if (data[key].length !== 7 || data[key].some((s) => s && s.stacks)) data[key] = splitGuards(data[key].filter(Boolean));
}

export function rollBankLevel(state, fx, levelIndex) {
  const level = fx.levels[levelIndex];
  const army = guardArmy(state, level.guards);
  if (level.upgradedStack && randInt(state.rng, 1, 100) <= level.upgradedStack.chance) {
    const first = army.find((s) => s && s.creatureId === level.guards[0].creatureId);
    if (first) first.creatureId = level.upgradedStack.creatureId;
  }
  return { guards: army, reward: resolveReward(state, level.reward) };
}

/** Roll what a refugee camp sells this week. */
export function rollRefugeeCamp(state, obj, fx) {
  const pool = CREATURES.filter((c) => !c.warMachine && c.tier >= 1 && c.tier <= fx.maxTier);
  const c = pick(state.rng, pool);
  obj.data.creatureId = c.id;
  obj.data.count = c.growth;
}

export function rollBlackMarket(state, obj, fx) {
  obj.data.stock = [];
  for (let i = 0; i < fx.slots; i++) obj.data.stock.push(rollArtifact(state, pick(state.rng, fx.classes)));
}

export function rollWeeklyReward(state, obj, fx) {
  const first = fx.firstWeekTable && weekNumber(state) === 1;
  obj.data.reward = resolveReward(state, rollTable(state.rng, first ? fx.firstWeekTable : fx.table).reward);
  obj.data.visitedWeek = null;
}

export function resetDwellingStock(state, obj, fx) {
  if (fx.restock === false && obj.data.stock) return;
  obj.data.stock = {};
  for (const c of fx.creatures) {
    obj.data.stock[c] = fx.stockFixed ? rollRange(state.rng, fx.stockFixed) : getCreature(c).growth * (fx.growthMultiplier || 1);
  }
}

/** Fixed removal order of the 48 puzzle pieces: outer pieces first (random among equals). */
export function ensurePuzzleOrder(state) {
  const map = state.map;
  if (map.puzzleOrder) return map.puzzleOrder;
  const pieces = [];
  for (let i = 0; i < PUZZLE_COLS * PUZZLE_ROWS; i++) {
    const cx = (i % PUZZLE_COLS) - (PUZZLE_COLS - 1) / 2;
    const cy = Math.floor(i / PUZZLE_COLS) - (PUZZLE_ROWS - 1) / 2;
    pieces.push({ i, ring: Math.max(Math.abs(cx) / PUZZLE_COLS, Math.abs(cy) / PUZZLE_ROWS) });
  }
  shuffle(state.rng, pieces);
  pieces.sort((a, b) => b.ring - a.ring);
  map.puzzleOrder = pieces.map((p) => p.i);
  return map.puzzleOrder;
}

function pandoraFromPreset(state, data) {
  const preset = PANDORA_PRESETS.find((p) => p.id === data.preset);
  if (!preset) throw new Error(`Unknown pandora preset: ${data.preset}`);
  const r = resolveReward(state, preset.reward, { faction: data.faction });
  for (const k of ['resources', 'exp', 'creatures', 'spells']) if (r[k] && data[k] === undefined) data[k] = r[k];
}

/** Turn a SEER_PRESETS-style quest description into a concrete quest (ids instead of classes). */
export function concretizeQuest(state, quest, pos) {
  const q = { ...quest };
  if (q.type === 'bring_artifacts' && !q.artifactIds) {
    q.artifactIds = [];
    for (let i = 0; i < (q.count || 1); i++) {
      const id = rollArtifact(state, q.class || 'treasure');
      // the quest item itself is NOT placed by this call: free it again for the generator
      if (id) { state.map.placedArtifacts.pop(); q.artifactIds.push(id); }
    }
    delete q.class; delete q.count;
  }
  if (q.type === 'bring_creatures' && !q.creatures) {
    const pool = CREATURES.filter((c) => c.tier === (q.tier || 1) && !c.warMachine && !c.upgraded && c.faction !== 'neutral');
    q.creatures = [{ creatureId: pick(state.rng, pool).id, count: q.count || 10 }];
    delete q.tier; delete q.count;
  }
  if (q.type === 'kill_monster' && !q.objectId) {
    const monsters = objectsByEffect(state, 'monster').filter((m) => !pos || (m.pos.z || 0) === (pos.z || 0));
    if (monsters.length) {
      monsters.sort((a, b) => (pos ? dist2(a.pos, pos) - dist2(b.pos, pos) : 0));
      q.objectId = monsters[0].id;
    }
    delete q.nearest;
  }
  return q;
}

const INIT = {
  artifact(state, obj, fx) {
    obj.data.artifactId ??= rollArtifact(state, fx.class);
    normalizeArmyField(obj.data, 'guards');
  },
  spell_scroll(state, obj, fx) {
    obj.data.spellId ??= rollSpell(state, { level: fx.spellLevel });
    obj.data.artifactId = 'spell_scroll';
    normalizeArmyField(obj.data, 'guards');
  },
  pandoras_box(state, obj) {
    if (obj.data.preset) pandoraFromPreset(state, obj.data);
    normalizeArmyField(obj.data, 'guards');
  },
  event(state, obj) {
    if (obj.data.preset) pandoraFromPreset(state, obj.data);
    normalizeArmyField(obj.data, 'guards');
  },
  mine(state, obj, fx) {
    if (fx.resource === 'random') {
      obj.data.resource ??= pick(state.rng, fx.pool);
      if (!obj.data.guards) obj.data.guards = guardArmy(state, fx.guards);
      else normalizeArmyField(obj.data, 'guards');
      obj.data.cleared ??= false;
    }
    if (obj.owner === undefined) obj.owner = null;
  },
  weekly_reward(state, obj, fx) {
    if (!obj.data.reward) rollWeeklyReward(state, obj, fx);
  },
  reward_once(state, obj, fx) {
    obj.data.reward ??= resolveReward(state, rollTable(state.rng, fx.table).reward);
    obj.data.visited ??= false;
  },
  bank(state, obj, fx) {
    if (obj.data.level == null) {
      const row = rollTable(state.rng, fx.levels);
      obj.data.level = fx.levels.indexOf(row);
    }
    const rolled = obj.data.guards && obj.data.reward ? null : rollBankLevel(state, fx, obj.data.level);
    if (!obj.data.guards) obj.data.guards = rolled.guards; else normalizeArmyField(obj.data, 'guards');
    obj.data.reward ??= rolled.reward;
    obj.data.visited ??= false;
    obj.data.cleared ??= false;
  },
  level_up(state, obj, fx) {
    obj.data.cost ??= { ...rollTable(state.rng, fx.costTable).cost };
  },
  learn_skill(state, obj, fx) {
    if (fx.mode === 'upgrade_existing') return;
    obj.data.skills ??= pickDistinct(state.rng, SKILL_IDS.filter((s) => !(fx.exclude || []).includes(s)), fx.choices || 1);
  },
  scholar(state, obj, fx) {
    if (!obj.data.kind) obj.data.kind = rollTable(state.rng, fx.table).kind;
    if (obj.data.kind === 'primary') obj.data.stat ??= pick(state.rng, PRIMARY_SKILLS);
    if (obj.data.kind === 'skill') obj.data.skillId ??= pick(state.rng, SKILL_IDS);
    if (obj.data.kind === 'spell') obj.data.spellId ??= rollSpell(state, { level: fx.table.find((r) => r.kind === 'spell').level });
  },
  university(state, obj, fx) {
    obj.data.skills ??= pickDistinct(state.rng, SKILL_IDS.filter((s) => !(fx.exclude || []).includes(s)), fx.skills);
  },
  learn_spell(state, obj, fx) {
    obj.data.spellId ??= rollSpell(state, { level: fx.level, school: fx.school });
  },
  black_market(state, obj, fx) {
    if (!obj.data.stock) rollBlackMarket(state, obj, fx);
  },
  refugee_camp(state, obj, fx) {
    if (!obj.data.creatureId) rollRefugeeCamp(state, obj, fx);
  },
  prison(state, obj) {
    if (!obj.data.heroDefId) {
      const used = new Set(Object.values(state.heroes).map((h) => h.defId));
      for (const o of objectsByEffect(state, 'prison')) if (o.data.heroDefId) used.add(o.data.heroDefId);
      const pool = HEROES.filter((h) => !h.special && !used.has(h.id));
      obj.data.heroDefId = pick(state.rng, pool.length ? pool : HEROES).id;
    }
  },
  lighthouse(state, obj) { if (obj.owner === undefined) obj.owner = null; },
  shipyard(state, obj) { if (obj.owner === undefined) obj.owner = null; },
  obelisk(state, obj) {
    obj.data.index ??= objectsByEffect(state, 'obelisk').length - 1;
    ensurePuzzleOrder(state);
  },
  grail(state) { ensurePuzzleOrder(state); },
  message(state, obj) { obj.data.text ??= ''; },
  quest_guard(state, obj) {
    if (obj.data.quest) obj.data.quest = concretizeQuest(state, obj.data.quest, obj.pos);
  },
  seer_hut(state, obj) {
    if (obj.data.quest) obj.data.quest = concretizeQuest(state, obj.data.quest, obj.pos);
    if (obj.data.reward) obj.data.reward = resolveReward(state, obj.data.reward);
    obj.data.completed ??= false;
  },
  garrison(state, obj, fx) {
    if (obj.owner === undefined) obj.owner = null;
    obj.data.army = obj.data.army ? armyFromList(obj.data.army) : emptyArmy();
    obj.data.removableUnits ??= fx.removableUnits;
  },
  teleport(state, obj, fx) {
    if (fx.kind === 'subterranean_gate') pairSubterraneanGates(state);
  },
  boat(state, obj) {
    obj.data.heroId ??= null;
    obj.data.owner ??= obj.owner ?? null;
  },
  dwelling(state, obj, fx) {
    if (obj.owner === undefined) obj.owner = null;
    if (!obj.data.stock) resetDwellingStock(state, obj, fx);
    if (fx.guards && fx.guards.length && !obj.data.guards && !obj.data.cleared) obj.data.guards = guardArmy(state, fx.guards);
    normalizeArmyField(obj.data, 'guards');
    obj.data.cleared ??= !(obj.data.guards && obj.data.guards.some(Boolean));
  },
  monster(state, obj, fx) {
    const d = obj.data;
    if (!d.creatureId) {
      const pool = CREATURES.filter((c) => !c.warMachine && (d.tier ? c.tier === d.tier : c.tier >= 1 && c.tier <= 7));
      d.creatureId = pick(state.rng, pool).id;
    }
    delete d.tier;
    const c = getCreature(d.creatureId);
    d.count ??= rollRange(state.rng, MONSTER_COUNT_BY_TIER[Math.min(8, Math.max(1, c.tier))]);
    d.disposition ??= fx.defaultDisposition;
    const disp = MONSTER_DISPOSITIONS.find((x) => x.id === d.disposition);
    if (!disp) throw new Error(`Unknown monster disposition: ${d.disposition}`);
    d.character ??= randInt(state.rng, disp.character[0], disp.character[1]);
    d.neverFlees ??= false;
    d.noGrowth ??= false;
  },
  town(state, obj) {
    const town = obj.data.townId && state.towns[obj.data.townId];
    if (town && town.owner != null) obj.owner = town.owner;
  },
};

export function initObject(state, obj) {
  const def = getMapObject(obj.defId);
  obj.data ??= {};
  const fn = INIT[def.effect.type];
  if (fn) fn(state, obj, def.effect, def);
  return obj;
}
