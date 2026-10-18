// Registry of every creature ability. Creatures (src/data/creatures.js) may only use ids declared
// here, and must supply every name listed in `params`. Exact combat semantics of each ability are
// specified in docs/mechanics/creatures.md.
//
// kind:
//   'tag'      - classification only (used by spell `immune` lists and by other abilities)
//   'attack'   - changes how the stack attacks / retaliates
//   'on_hit'   - extra effect triggered by a successful attack
//   'defense'  - immunities, resistances, reactions to being hit
//   'aura'     - passive effect on armies / heroes while the stack is alive
//   'cast'     - activated or automatic spell casting
//   'adventure'- works outside combat
//   'machine'  - war machine behaviour

/**
 * @typedef {Object} AbilityDef
 * @property {string} name
 * @property {string} description
 * @property {string[]} params   required parameter names on the creature's ability entry
 * @property {string} kind
 */

/** @type {Record<string, AbilityDef>} */
export const ABILITIES = {
  // ---- tags ---------------------------------------------------------------------------------
  undead: { kind: 'tag', name: 'Undead', params: [],
    description: 'Undead: always neutral morale, immune to mind spells, death-type effects, poison, aging, disease, life drain and resurrection (raised by Animate Dead instead).' },
  non_living: { kind: 'tag', name: 'Non-living', params: [],
    description: 'Not alive (golems, gargoyles, elementals): always neutral morale, immune to mind spells, death stare, poison, aging, disease, life drain, resurrection.' },
  mechanical: { kind: 'tag', name: 'Mechanical', params: [],
    description: 'A machine: counts as non-living for effects, and can be repaired by Mechanics/Engineers.' },
  mind_immune: { kind: 'tag', name: 'Immune to mind spells', params: [],
    description: 'Immune to all mind-affecting spells (Berserk, Blind, Forgetfulness, Frenzy, Hypnotize, Mirth, Sorrow) and to fear/paralysis-by-mind effects.' },
  elemental: { kind: 'tag', name: 'Elemental', params: [],
    description: 'Elemental being (target of elemental-specific effects).' },
  dragon: { kind: 'tag', name: 'Dragon', params: [],
    description: 'Dragon (target of Slayer and dragon-specific bonuses).' },

  // ---- movement -----------------------------------------------------------------------------
  teleport: { kind: 'attack', name: 'Teleports', params: [],
    description: 'Moves by teleporting: reaches any free hex within speed ignoring obstacles, walls and moats (like flying, but instantaneous).' },
  burrow: { kind: 'attack', name: 'Burrows', params: [],
    description: 'Travels underground: ignores obstacles and other stacks in its path, but not walls or moats.' },

  // ---- attack modifiers ---------------------------------------------------------------------
  double_attack: { kind: 'attack', name: 'Strikes twice', params: [],
    description: 'Makes two melee attacks per attack action (second after the retaliation).' },
  double_shot: { kind: 'attack', name: 'Shoots twice', params: [],
    description: 'Fires two shots per shoot action (uses two units of ammunition).' },
  no_melee_penalty: { kind: 'attack', name: 'No melee penalty', params: [],
    description: 'A shooter that deals full damage in hand-to-hand combat.' },
  no_range_penalty: { kind: 'attack', name: 'No range penalty', params: [],
    description: 'Shots deal full damage at any distance.' },
  no_obstacle_penalty: { kind: 'attack', name: 'No obstacle penalty', params: [],
    description: 'Shots ignore the damage penalty for town walls.' },
  no_enemy_retaliation: { kind: 'attack', name: 'No enemy retaliation', params: [],
    description: 'Melee attacks by this stack are never retaliated against.' },
  unlimited_retaliations: { kind: 'attack', name: 'Unlimited retaliations', params: [],
    description: 'Retaliates against every melee attack in a round.' },
  extra_retaliations: { kind: 'attack', name: 'Extra retaliations', params: ['count'],
    description: 'Retaliates `count` additional times per round (Griffin: 1 extra = 2 total).' },
  first_strike: { kind: 'attack', name: 'First strike', params: [],
    description: 'Its retaliation is resolved before the attacker\'s blow.' },
  attack_all_adjacent: { kind: 'attack', name: 'Attacks all adjacent enemies', params: [],
    description: 'A melee attack hits every enemy stack adjacent to the attacker.' },
  three_headed_attack: { kind: 'attack', name: 'Three-headed attack', params: [],
    description: 'A melee attack also hits enemies in the two hexes flanking the target.' },
  breath_attack: { kind: 'attack', name: 'Breath attack', params: [],
    description: 'A melee attack also hits whatever stands in the hex directly behind the target (friend or foe).' },
  area_shot: { kind: 'attack', name: 'Area shot', params: ['radius', 'affects'],
    description: 'Ranged attacks hit every stack within `radius` hexes of the target hex. `affects`: "all" or "living".' },
  strike_and_return: { kind: 'attack', name: 'Strike and return', params: [],
    description: 'After a melee attack the stack flies back to the hex it started its move from.' },
  jousting: { kind: 'attack', name: 'Jousting', params: ['percentPerHex'],
    description: 'Deals +percentPerHex% damage for every hex travelled before the attack.' },
  charge_immunity: { kind: 'defense', name: 'Immune to jousting', params: [],
    description: 'Negates the jousting bonus of attackers.' },
  hates: { kind: 'attack', name: 'Hates', params: ['targets', 'percent'],
    description: 'Deals +percent% damage against the listed creature ids.' },
  double_damage_chance: { kind: 'attack', name: 'Death blow', params: ['chance'],
    description: 'Each melee attack has `chance`% to deal double damage.' },
  reduce_enemy_defense: { kind: 'attack', name: 'Ignores defense', params: ['percent'],
    description: 'The target\'s Defense is reduced by percent% when this stack attacks it.' },
  reduce_enemy_attack: { kind: 'defense', name: 'Ignores attack', params: ['percent'],
    description: 'The attacker\'s Attack is reduced by percent% when it attacks this stack.' },
  siege_attack: { kind: 'attack', name: 'Attacks walls', params: ['level'],
    description: 'Can shoot town walls like a catapult with Ballistics of the given level (1 basic, 2 advanced).' },
  ferocity: { kind: 'attack', name: 'Ferocity', params: [],
    description: 'If a melee attack kills at least one creature, the stack immediately strikes once more.' },
  accurate_shot: { kind: 'attack', name: 'Accurate shot', params: ['percentPerCreature'],
    description: 'After a ranged attack, kills extra creatures (Death-Stare-like) with percentPerCreature% per shooter.' },
  revenge: { kind: 'attack', name: 'Revenge', params: [],
    description: 'Damage grows with the stack\'s own losses in this battle.' },
  preemptive_shot: { kind: 'attack', name: 'Preemptive shot', params: [],
    description: 'Once per round shoots an enemy that moves next to it to attack, before that attack resolves.' },
  ranged_retaliation: { kind: 'attack', name: 'Ranged retaliation', params: [],
    description: 'Retaliates against ranged attacks with a shot of its own.' },

  // ---- on-hit effects -----------------------------------------------------------------------
  death_stare: { kind: 'on_hit', name: 'Death stare', params: ['percentPerCreature'],
    description: 'After a melee attack, each attacker has percentPerCreature% to slay one extra creature outright.' },
  cast_on_hit: { kind: 'on_hit', name: 'Casts on attack', params: ['spellId', 'chance', 'mastery', 'duration', 'timing'],
    description: 'Attacks have chance% to cast a spell on the target. timing: "before" (applied before damage) or "after". Optional `mode`: "melee" restricts it to melee attacks.' },
  petrify_attack: { kind: 'on_hit', name: 'Stone gaze', params: ['chance', 'duration'],
    description: 'Melee attacks have chance% to turn the target to stone for `duration` rounds.' },
  paralyze_attack: { kind: 'on_hit', name: 'Paralyzing venom', params: ['chance', 'duration'],
    description: 'Attacks have chance% to paralyze the target for `duration` rounds.' },
  disease_attack: { kind: 'on_hit', name: 'Disease', params: ['chance', 'duration', 'attack', 'defense'],
    description: 'Attacks have chance% to infect the target: attack/defense modified for `duration` rounds.' },
  aging_attack: { kind: 'on_hit', name: 'Aging', params: ['chance', 'duration', 'hpPercent'],
    description: 'Attacks have chance% to age the target: max HP reduced by hpPercent% for `duration` rounds.' },
  poison_attack: { kind: 'on_hit', name: 'Poison', params: ['chance', 'duration', 'hpPercentPerRound'],
    description: 'Attacks have chance% to poison: max HP drops by hpPercentPerRound% of base each round for `duration` rounds.' },
  lightning_strike: { kind: 'on_hit', name: 'Lightning strike', params: ['chance', 'damagePerCreature'],
    description: 'Melee attacks have chance% to call a Lightning Bolt dealing damagePerCreature x count.' },
  binding: { kind: 'on_hit', name: 'Binding', params: [],
    description: 'A creature hit in melee is rooted in place until this stack moves away or dies.' },
  acid_breath: { kind: 'on_hit', name: 'Acid breath', params: ['defenseReduction', 'chance', 'damagePerCreature'],
    description: 'Every attack permanently lowers target Defense by defenseReduction; chance% for bonus damagePerCreature x count.' },
  life_drain: { kind: 'on_hit', name: 'Life drain', params: ['percent'],
    description: 'Heals and resurrects members of the stack with percent% of the damage dealt to living creatures.' },
  fear: { kind: 'aura', name: 'Fear', params: ['chance'],
    description: 'Each enemy stack has chance% to lose its turn, frozen in fear.' },

  // ---- defenses -----------------------------------------------------------------------------
  spell_damage_reduction: { kind: 'defense', name: 'Spell damage resistance', params: ['percent'],
    description: 'Damage from spells is reduced by percent%.' },
  magic_resistance: { kind: 'defense', name: 'Magic resistance', params: ['percent'],
    description: 'percent% chance to completely resist any hostile spell.' },
  spell_level_immunity: { kind: 'defense', name: 'Spell immunity', params: ['maxLevel'],
    description: 'Immune to every spell (friendly or hostile) of level 1..maxLevel. maxLevel 5 = immune to all magic.' },
  spell_immunity: { kind: 'defense', name: 'Immune to spells', params: ['spells'],
    description: 'Immune to the listed spell ids.' },
  school_immunity: { kind: 'defense', name: 'Immune to school', params: ['school'],
    description: 'Immune to every spell of the given school (fire immunity covers Fire Shield damage and Fire Wall too).' },
  spell_vulnerability: { kind: 'defense', name: 'Vulnerable to spells', params: ['spells', 'percent'],
    description: 'Takes +percent% damage from the listed spells.' },
  fire_shield: { kind: 'defense', name: 'Fire shield', params: ['percent'],
    description: 'Melee attackers take percent% of the damage they inflict as fire damage.' },
  magic_mirror: { kind: 'defense', name: 'Magic mirror', params: ['chance'],
    description: 'chance% to reflect a hostile single-target spell onto a random enemy stack.' },
  regeneration: { kind: 'defense', name: 'Regenerating', params: [],
    description: 'The top creature of the stack is restored to full health at the start of each of its turns.' },
  rebirth: { kind: 'defense', name: 'Rebirth', params: ['percent'],
    description: 'Once per battle, when the stack is destroyed, percent% of its original number rises again.' },
  invulnerability: { kind: 'defense', name: 'Invulnerability', params: ['rounds', 'casts'],
    description: 'Can become immune to all damage and spells for `rounds` rounds, `casts` times per battle; it cannot act meanwhile.' },
  explode_on_death: { kind: 'defense', name: 'Explodes', params: ['damagePerCreature'],
    description: 'When creatures of the stack die, every adjacent stack takes damagePerCreature per creature killed.' },

  // ---- auras / hero interaction -------------------------------------------------------------
  resistance_aura: { kind: 'aura', name: 'Aura of magic resistance', params: ['percent'],
    description: 'This stack and all adjacent allied stacks gain percent% magic resistance.' },
  army_morale: { kind: 'aura', name: 'Morale bonus', params: ['value'],
    description: 'All allied stacks get +value morale while this stack is alive.' },
  enemy_morale: { kind: 'aura', name: 'Lowers enemy morale', params: ['value'],
    description: 'All enemy stacks get `value` (negative) morale while this stack is alive.' },
  enemy_luck: { kind: 'aura', name: 'Lowers enemy luck', params: ['value'],
    description: 'All enemy stacks get `value` (negative) luck while this stack is alive.' },
  positive_morale: { kind: 'aura', name: 'Always positive morale', params: [],
    description: 'This stack\'s morale is never below +1.' },
  positive_luck: { kind: 'aura', name: 'Always positive luck', params: [],
    description: 'This stack\'s luck is never below +1.' },
  luck_doubling: { kind: 'aura', name: 'Doubles luck chance', params: [],
    description: 'Allied stacks roll for good luck at twice the normal chance.' },
  hero_spell_cost: { kind: 'aura', name: 'Reduces spell cost', params: ['value'],
    description: 'The owning hero\'s spells cost `value` fewer mana (minimum 1).' },
  enemy_spell_cost: { kind: 'aura', name: 'Magic damper', params: ['value'],
    description: 'The enemy hero\'s spells cost `value` more mana.' },
  magic_channel: { kind: 'aura', name: 'Magic channel', params: ['percent'],
    description: 'percent% of the mana spent by the enemy hero is given to the owning hero.' },
  mana_drain: { kind: 'aura', name: 'Drains mana', params: ['value'],
    description: 'At the start of each of its turns drains `value` mana from the enemy hero.' },

  // ---- casters ------------------------------------------------------------------------------
  spellcaster: { kind: 'cast', name: 'Spellcaster', params: ['spells', 'casts', 'mastery', 'target'],
    description: 'Can cast one of `spells` instead of acting, `casts` times per battle. target: "friendly"|"enemy". Optional: random (bool), duration, powerPerCreature.' },
  mass_caster: { kind: 'cast', name: 'Mass enchanter', params: ['friendlySpells', 'enemySpells', 'mastery', 'duration', 'interval'],
    description: 'Automatically casts a random mass spell every `interval` rounds.' },
  resurrection: { kind: 'cast', name: 'Resurrection', params: ['hpPerCreature', 'casts'],
    description: 'Can permanently resurrect hpPerCreature x count hit points of a fallen allied living stack.' },
  raise_demons: { kind: 'cast', name: 'Summon demons', params: ['hpPerCreature', 'casts', 'creatureId'],
    description: 'Can turn a dead allied stack into creatureId, using hpPerCreature x count hit points.' },
  repair: { kind: 'cast', name: 'Repair', params: ['hpPerCreature', 'casts'],
    description: 'Can restore (and rebuild) hpPerCreature x count hit points of an adjacent allied mechanical stack or war machine.' },
  devour_corpse: { kind: 'cast', name: 'Devours corpses', params: ['hpPercent'],
    description: 'Can consume an adjacent corpse to heal/resurrect itself by hpPercent% of the corpse stack\'s total hit points; the corpse is removed.' },
  heat_stroke: { kind: 'on_hit', name: 'Heat stroke', params: ['radius', 'percent'],
    description: 'Melee attacks also scorch every other enemy within `radius` hexes of the target for percent% of the damage (fire).' },

  // ---- adventure map ------------------------------------------------------------------------
  spying: { kind: 'adventure', name: 'Spying', params: [],
    description: 'A hero with this creature sees exact army sizes and hero details of enemies (Visions / thieves\' guild style info).' },
  sandwalker: { kind: 'adventure', name: 'Sandwalker', params: [],
    description: 'A hero with this creature in the army ignores the sand terrain movement penalty.' },
  resource_generation: { kind: 'adventure', name: 'Generates resources', params: ['resource', 'amount', 'period'],
    description: 'Each stack owned yields `amount` of `resource` per creature every `period` ("day"|"week"). Optional `perStack: true` = flat per stack.' },

  // ---- war machines -------------------------------------------------------------------------
  immobile: { kind: 'machine', name: 'Immobile', params: [],
    description: 'Cannot move, cannot be targeted by most spells, does not retaliate, unaffected by morale/luck.' },
  hero_attack_scaling: { kind: 'machine', name: 'Artillery', params: [],
    description: 'Damage is (minDamage..maxDamage) x (hero Attack + 1); controlled by the Artillery skill.' },
  heals: { kind: 'machine', name: 'First aid', params: ['min', 'max'],
    description: 'Each round heals the top creature of one allied stack for min..max hit points (scaled by First Aid skill).' },
  ammo_supply: { kind: 'machine', name: 'Ammo supply', params: [],
    description: 'While alive, allied shooters never run out of ammunition.' },
  catapult: { kind: 'machine', name: 'Catapult', params: [],
    description: 'Shoots town fortifications during sieges (see Ballistics).' },
};

export const ABILITY_IDS = Object.keys(ABILITIES);

/** Ability ids that are pure classification tags; spells list these in their `immune` arrays. */
export const ABILITY_TAGS = ABILITY_IDS.filter((id) => ABILITIES[id].kind === 'tag');

/** @param {string} id @returns {AbilityDef} */
export function getAbility(id) {
  const def = ABILITIES[id];
  if (!def) throw new Error(`Unknown ability: ${id}`);
  return def;
}

/**
 * Validates one creature ability entry against the registry.
 * @param {{id: string}} entry
 * @returns {string[]} list of problems (empty = valid)
 */
export function validateAbilityEntry(entry) {
  const def = ABILITIES[entry.id];
  if (!def) return [`unknown ability '${entry.id}'`];
  return def.params
    .filter((p) => entry[p] === undefined || entry[p] === null)
    .map((p) => `ability '${entry.id}' is missing param '${p}'`);
}
