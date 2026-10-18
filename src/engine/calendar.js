// Calendar: day / week / month rollover and the weekly "Week of ..." / monthly events.
// Spec: docs/mechanics/game-loop.md §2.

import { DAYS_PER_WEEK, WEEKS_PER_MONTH, FACTIONS } from '../core/constants.js';
import { randInt, pick } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import { getCreature } from '../data/creatures.js';

export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH;

/** Chance (percent) that a new week (not the first of a month) is a "Week of the <creature>". */
export const WEEK_OF_CREATURE_CHANCE = 25;
/** Chance (percent) that a new month is a "Month of the <creature>" (population doubles). */
export const MONTH_OF_CREATURE_CHANCE = 40;
/** Chance (percent) that a new month is a Plague month (never month 1; rolled after the above). */
export const PLAGUE_CHANCE = 10;
/** Weekly growth bonus of the creature of the week. */
export const WEEK_OF_GROWTH_BONUS = 5;

export const PLAIN_WEEK_NAMES = [
  'Squirrel', 'Rabbit', 'Gopher', 'Badger', 'Rat', 'Eagle', 'Weasel', 'Raven', 'Mongoose', 'Dog',
  'Aardvark', 'Lizard', 'Tortoise', 'Hedgehog', 'Condor',
];
export const PLAIN_MONTH_NAMES = [
  'Ant', 'Grasshopper', 'Dragonfly', 'Spider', 'Butterfly', 'Bumblebee', 'Locust', 'Earthworm', 'Hornet', 'Beetle',
];

/** `{day 1-7, week 1-4, month 1+}` of an absolute 1-based day number. */
export function dateFromTurn(turn) {
  const d = turn - 1;
  return {
    day: (d % DAYS_PER_WEEK) + 1,
    week: (Math.floor(d / DAYS_PER_WEEK) % WEEKS_PER_MONTH) + 1,
    month: Math.floor(d / DAYS_PER_MONTH) + 1,
  };
}

/** Absolute 1-based week number of the current day. */
export function absoluteWeek(state) {
  return Math.floor((state.turn - 1) / DAYS_PER_WEEK) + 1;
}

/** Advance to the next day. @returns {{newWeek: boolean, newMonth: boolean}} */
export function advanceDate(state) {
  state.turn += 1;
  state.date = dateFromTurn(state.turn);
  const newWeek = state.date.day === 1;
  return { newWeek, newMonth: newWeek && state.date.week === 1 };
}

/**
 * Creatures eligible for "Week of": every town creature, base or upgraded, tiers 1-7 (the original
 * picks any non-neutral creature, e.g. "Week of the Halberdier"; the +5 goes to the dwelling of
 * either form).
 */
export function weekCreaturePool() {
  return FACTIONS.flatMap((f) => {
    const fac = getFaction(f);
    return [...fac.creatures, ...(fac.altCreatures || []).map((a) => a.creatures)].flat();
  });
}

/** Creatures eligible for "Month of": un-upgraded town creatures of tiers 1-6. */
export function monthCreaturePool() {
  return FACTIONS.flatMap((f) => getFaction(f).creatures.slice(0, 6).map((pair) => pair[0]));
}

/**
 * Roll the event of a new week and store it in `state.weekOf`:
 * `{ kind: 'normal'|'week_of'|'month_of'|'plague', creatureId: id|null, name }`.
 * `state.settings.forceWeekEvent` (a weekOf-like object or a list consumed one per week) overrides
 * the roll (scenarios / tests).
 */
export function rollWeekEvent(state, newMonth) {
  const forced = state.settings?.forceWeekEvent;
  let ev = null;
  if (Array.isArray(forced)) ev = forced.length ? forced.shift() : null;
  else if (forced) ev = forced;
  if (!ev) {
    const roll = randInt(state.rng, 0, 99);
    if (newMonth) {
      if (roll < MONTH_OF_CREATURE_CHANCE) ev = { kind: 'month_of', creatureId: pick(state.rng, monthCreaturePool()) };
      else if (roll < MONTH_OF_CREATURE_CHANCE + PLAGUE_CHANCE && state.date.month > 1) ev = { kind: 'plague' };
      else ev = { kind: 'normal' };
    } else if (roll < WEEK_OF_CREATURE_CHANCE) {
      ev = { kind: 'week_of', creatureId: pick(state.rng, weekCreaturePool()) };
    } else ev = { kind: 'normal' };
  }
  const out = { kind: ev.kind || 'normal', creatureId: ev.creatureId ?? null, name: ev.name };
  if (!out.name) {
    if (out.kind === 'week_of') out.name = `Week of the ${getCreature(out.creatureId).name}`;
    else if (out.kind === 'month_of') out.name = `Month of the ${getCreature(out.creatureId).name}`;
    else if (out.kind === 'plague') out.name = 'Month of the Plague';
    else if (newMonth) out.name = `Month of the ${pick(state.rng, PLAIN_MONTH_NAMES)}`;
    else out.name = `Week of the ${pick(state.rng, PLAIN_WEEK_NAMES)}`;
  }
  state.weekOf = out;
  return out;
}
