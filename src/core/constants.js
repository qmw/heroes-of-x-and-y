// Shared vocabulary. Every module imports ids from here instead of re-declaring them.

export const RESOURCES = ['gold', 'wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems'];
export const RARE_RESOURCES = ['mercury', 'sulfur', 'crystal', 'gems'];

export const PRIMARY_SKILLS = ['attack', 'defense', 'power', 'knowledge'];

// 9 classic towns + 2 expansion towns ("richer than the original").
export const FACTIONS = [
  'castle', 'rampart', 'tower', 'inferno', 'necropolis', 'dungeon',
  'stronghold', 'fortress', 'conflux', 'cove', 'factory',
];
export const NEUTRAL = 'neutral';

export const SPELL_SCHOOLS = ['air', 'earth', 'fire', 'water'];
export const MASTERY = { NONE: 0, BASIC: 1, ADVANCED: 2, EXPERT: 3 };

export const TERRAINS = [
  'dirt', 'sand', 'grass', 'snow', 'swamp', 'rough', 'subterranean', 'lava',
  'highlands', 'wasteland', 'water', 'rock',
];

export const ARTIFACT_SLOTS = [
  'head', 'neck', 'torso', 'shoulders', 'right_hand', 'left_hand', 'ring', 'feet',
  'misc', 'war_machine', 'spellbook',
];
// How many of each slot a hero has.
export const SLOT_COUNTS = {
  head: 1, neck: 1, torso: 1, shoulders: 1, right_hand: 1, left_hand: 1, ring: 2, feet: 1,
  misc: 5, war_machine: 4, spellbook: 1,
};

export const ARMY_SLOTS = 7;
export const MAX_SECONDARY_SKILLS = 8;
export const MAX_HEROES_PER_PLAYER = 8;

export const BATTLEFIELD = { WIDTH: 15, HEIGHT: 11 };

export const PLAYER_COLORS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];

export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_MONTH = 4;

export function emptyResources() {
  return { gold: 0, wood: 0, ore: 0, mercury: 0, sulfur: 0, crystal: 0, gems: 0 };
}
