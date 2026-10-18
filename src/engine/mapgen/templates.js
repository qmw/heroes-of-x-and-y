// Random map templates (data). A template describes a zone graph in the spirit of the original
// RMG templates: zones (player start / treasure / junction) with a relative size, terrain,
// monster strength, treasure value bands, mines and towns, and connections between zones with a
// guard value (0 = unguarded), `wide` (no guard, 3-tile gap) or `border` (keymaster gate).
// Spec: docs/mechanics/mapgen.md §3.
//
// Templates that scale with the number of players use `perPlayer` zones (ids `<key>_<player>`),
// `shared` zones and link references: `'key'` (same player), `'key+1'` (next player around the
// ring) or the id of a shared zone. `expandTemplate(tpl, players, rng)` turns them into a plain
// `{ zones, links }` graph.
import { randInt, pick, rand } from '../../core/rng.js';

/** Treasure value bands: piles per 1000 tiles of zone = density (see docs §5). */
export const BANDS = {
  start: [{ min: 500, max: 3000, density: 9 }, { min: 3000, max: 6000, density: 4 }, { min: 6000, max: 9000, density: 1 }],
  low: [{ min: 500, max: 3000, density: 9 }, { min: 3000, max: 6000, density: 6 }, { min: 10000, max: 15000, density: 1 }],
  mid: [{ min: 3000, max: 6000, density: 8 }, { min: 6000, max: 10000, density: 5 }, { min: 10000, max: 15000, density: 2 }],
  high: [{ min: 5000, max: 10000, density: 7 }, { min: 10000, max: 20000, density: 4 }, { min: 20000, max: 30000, density: 2 }],
  rich: [{ min: 3000, max: 9000, density: 10 }, { min: 10000, max: 15000, density: 4 }, { min: 15000, max: 25000, density: 2 }],
  junction: [{ min: 500, max: 3000, density: 6 }, { min: 3000, max: 6000, density: 3 }],
  under: [{ min: 1000, max: 4000, density: 8 }, { min: 4000, max: 9000, density: 4 }, { min: 9000, max: 15000, density: 1 }],
};

const start = (o = {}) => ({
  type: 'start', size: 30, terrain: 'native', monsters: 'normal', towns: { neutral: 0 },
  mines: { wood: 1, ore: 1, rare: 1 }, treasure: BANDS.start, ...o,
});
const treasure = (o = {}) => ({
  type: 'treasure', size: 20, terrain: 'random', monsters: 'normal', towns: { neutral: 0 },
  mines: { rare: 1 }, treasure: BANDS.mid, ...o,
});
const junction = (o = {}) => ({
  type: 'junction', size: 12, terrain: 'random', monsters: 'normal', towns: { neutral: 0 },
  mines: {}, treasure: BANDS.junction, ...o,
});
const link = (a, b, guard = 3000, o = {}) => ({ a, b, guard, ...o });

/**
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {[number, number]} players     supported player count
 * @property {string[]} sizes               recommended map sizes
 * @property {string|null} water            forced water mode (null = the option decides)
 */

/** @type {Template[]} */
export const TEMPLATES = [
  {
    id: 'default', name: 'Balanced', players: [2, 8], sizes: ['S', 'M', 'L', 'XL'], water: null,
    description: 'Every player gets a home zone and a treasure zone; the treasure zones meet in a central junction and form a ring.',
    perPlayer: { start: start(), t: treasure({ size: 20 }) },
    shared: { hub: junction({ size: 14, treasure: BANDS.mid, mines: { gold: 1 }, towns: { neutral: 1 } }) },
    links: [link('start', 't', 3000), link('t', 'hub', 6000), link('t', 't+1', 9000, { minPlayers: 3 })],
  },
  {
    id: 'duel', name: 'Duel (2SM4d)', players: [2, 2], sizes: ['S', 'M'], water: null,
    description: 'Classic two-player duel: each home zone has two treasure zones, which border the opponent\'s.',
    zones: {
      s0: start({ owner: 0, size: 26 }), s1: start({ owner: 1, size: 26 }),
      a0: treasure({ size: 14, treasure: BANDS.low }), a1: treasure({ size: 14, treasure: BANDS.low }),
      b0: treasure({ size: 14, mines: { rare: 1, gold: 1 } }), b1: treasure({ size: 14, mines: { rare: 1, gold: 1 } }),
    },
    links: [link('s0', 'a0', 3000), link('s0', 'b0', 3000), link('s1', 'a1', 3000), link('s1', 'b1', 3000),
      link('a0', 'a1', 6000), link('b0', 'b1', 6000)],
  },
  {
    id: 'crossroads', name: 'Crossroads', players: [2, 4], sizes: ['M', 'L', 'XL'], water: null,
    description: 'Rich home zones with every mine around one central treasure hub held by a very strong guard - build up, then fight for the middle.',
    perPlayer: {
      start: start({ size: 40, mines: { wood: 2, ore: 2, mercury: 1, sulfur: 1, crystal: 1, gems: 1, gold: 1 }, treasure: BANDS.rich, towns: { neutral: 1 } }),
      t: treasure({ size: 12, treasure: BANDS.low, mines: {} }),
    },
    shared: { center: treasure({ size: 30, monsters: 'strong', treasure: BANDS.high, mines: { gold: 2 } }) },
    links: [link('start', 't', 1500, { wide: true }), link('start', 'center', 25000)],
  },
  {
    id: 'ring', name: 'Ring', players: [2, 8], sizes: ['S', 'M', 'L', 'XL'], water: null,
    description: 'Home zones and treasure zones alternate around one big ring; every player has two neighbours.',
    perPlayer: { start: start(), t: treasure({ size: 22 }) },
    links: [link('start', 't', 3000), link('t', 'start+1', 6000)],
  },
  {
    id: 'small_ring', name: 'Small Ring', players: [2, 6], sizes: ['S', 'M'], water: null,
    description: 'Compact ring of home zones joined directly, each with a small guarded treasure pocket. Fast, aggressive games.',
    perPlayer: { start: start({ size: 24 }), p: treasure({ size: 8, treasure: BANDS.low, mines: { rare: 1 } }) },
    links: [link('start', 'p', 4500), link('start', 'start+1', 4500, { border: true, minPlayers: 3 }), link('start', 'start+1', 4500, { maxPlayers: 2 })],
  },
  {
    id: 'wilderness', name: 'Wilderness', players: [2, 8], sizes: ['S', 'M', 'L', 'XL'], water: null,
    description: 'A different zone graph for every seed: random treasure zones, junctions and connections.',
    random: { treasurePerPlayer: [1, 2], junctions: [1, 3], extraLinks: 0.5, guards: [3000, 12000] },
  },
  {
    id: 'archipelago', name: 'Archipelago', players: [2, 8], sizes: ['M', 'L', 'XL'], water: 'islands',
    description: 'Every zone is an island. Start with a shipyard and a boat; sail for the treasure islands.',
    perPlayer: { start: start({ size: 26 }), t: treasure({ size: 16 }) },
    shared: { center: treasure({ size: 20, treasure: BANDS.high, mines: { gold: 1 }, towns: { neutral: 1 } }) },
    links: [link('start', 't', 0), link('t', 'center', 0), link('t', 'start+1', 0)],
  },
  {
    id: 'grand_melee', name: 'Grand Melee (8mm6)', players: [3, 8], sizes: ['M', 'L', 'XL'], water: null,
    description: 'Big multiplayer free-for-all: home zones on the rim, two treasure zones each linking to the neighbours, and a rich central zone with a neutral castle.',
    perPlayer: {
      start: start({ size: 24 }),
      a: treasure({ size: 11, treasure: BANDS.low }),
      b: treasure({ size: 12, treasure: BANDS.mid, mines: { rare: 1 } }),
    },
    shared: {
      center: treasure({ size: 26, treasure: BANDS.high, mines: { gold: 2 }, towns: { neutral: 1 }, monsters: 'strong' }),
    },
    links: [link('start', 'a', 3000), link('start', 'b', 3000), link('a', 'b+1', 6000), link('b', 'center', 12000)],
  },
  {
    id: 'balance', name: 'Balance', players: [2, 8], sizes: ['S', 'M', 'L', 'XL'], water: null,
    description: 'Mirrored fairness: identical home zones, a poor and a rich satellite each, and a central zone with a neutral castle.',
    perPlayer: {
      start: start({ size: 28 }),
      t1: treasure({ size: 12, treasure: BANDS.low, mines: { rare: 1 } }),
      t2: treasure({ size: 14, treasure: BANDS.mid, mines: { rare: 1, gold: 1 } }),
    },
    shared: { center: treasure({ size: 24, treasure: BANDS.high, towns: { neutral: 1 }, mines: {} }) },
    links: [link('start', 't1', 2000, { wide: true }), link('start', 't2', 4000), link('t1', 'center', 9000), link('t2', 'center', 9000),
      link('t2', 't1+1', 6000, { minPlayers: 3 })],
  },
];

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id) {
  return TEMPLATE_BY_ID[id] || null;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function resolveRef(ref, i, n, tpl) {
  if (tpl.shared && tpl.shared[ref]) return ref;
  const m = /^(\w+?)(?:\+(\d+))?$/.exec(ref);
  if (!m || !tpl.perPlayer || !tpl.perPlayer[m[1]]) throw new Error(`template ${tpl.id}: bad zone reference ${ref}`);
  return `${m[1]}_${(i + Number(m[2] || 0)) % n}`;
}

function expandRandom(tpl, n, rng) {
  const p = tpl.random;
  const zones = {};
  const links = [];
  const guard = () => Math.round(randInt(rng, p.guards[0], p.guards[1]) / 500) * 500;
  const lastT = [];
  for (let i = 0; i < n; i++) {
    zones[`start_${i}`] = start({ owner: i, size: randInt(rng, 22, 32) });
    const k = randInt(rng, p.treasurePerPlayer[0], p.treasurePerPlayer[1]);
    let prev = `start_${i}`;
    for (let j = 0; j < k; j++) {
      const id = `t${j}_${i}`;
      const band = pick(rng, ['low', 'mid', 'mid', 'high']);
      zones[id] = treasure({ size: randInt(rng, 10, 20), treasure: BANDS[band], mines: rand(rng) < 0.3 ? { rare: 1, gold: 1 } : { rare: 1 } });
      links.push(link(prev, id, j === 0 ? 3000 : guard()));
      prev = id;
    }
    lastT.push(prev);
  }
  const nj = Math.min(n, randInt(rng, p.junctions[0], p.junctions[1]));
  for (let j = 0; j < nj; j++) {
    zones[`j${j}`] = junction({ size: randInt(rng, 10, 18), towns: { neutral: rand(rng) < 0.5 ? 1 : 0 }, treasure: BANDS[pick(rng, ['junction', 'mid', 'high'])] });
    if (j > 0) links.push(link(`j${j - 1}`, `j${j}`, guard()));
  }
  lastT.forEach((t, i) => links.push(link(t, `j${i % nj}`, guard())));
  for (let i = 0; i < n && n > 2; i++) {
    if (rand(rng) < p.extraLinks) links.push(link(lastT[i], `start_${(i + 1) % n}`, guard()));
  }
  return { zones, links };
}

/**
 * Expand a template for `n` players into `{ zones: [{id, ...zone}], links: [{a, b, guard, ...}] }`.
 * Start zones get `owner` = player index.
 */
export function expandTemplate(tpl, n, rng) {
  let zones = {};
  let links = [];
  if (tpl.random) {
    ({ zones, links } = expandRandom(tpl, n, rng));
  } else {
    for (const [id, z] of Object.entries(tpl.zones || {})) zones[id] = clone(z);
    for (const [id, z] of Object.entries(tpl.shared || {})) zones[id] = clone(z);
    for (let i = 0; i < n; i++) {
      for (const [key, z] of Object.entries(tpl.perPlayer || {})) {
        zones[`${key}_${i}`] = { ...clone(z), ...(z.type === 'start' ? { owner: i } : {}) };
      }
    }
    for (const l of tpl.links || []) {
      if (l.minPlayers && n < l.minPlayers) continue;
      if (l.maxPlayers && n > l.maxPlayers) continue;
      const perPlayer = tpl.perPlayer && [l.a, l.b].some((r) => !(tpl.shared && tpl.shared[r]) && !(tpl.zones && tpl.zones[r]));
      const reps = perPlayer ? n : 1;
      for (let i = 0; i < reps; i++) {
        const a = tpl.zones && tpl.zones[l.a] ? l.a : resolveRef(l.a, i, n, tpl);
        const b = tpl.zones && tpl.zones[l.b] ? l.b : resolveRef(l.b, i, n, tpl);
        if (a === b) continue;
        links.push({ ...clone(l), a, b });
      }
    }
  }
  // de-duplicate undirected links (2-player rings)
  const seen = new Set();
  links = links.filter((l) => {
    const k = [l.a, l.b].sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const zoneList = Object.entries(zones).map(([id, z]) => ({ id, ...z }));
  // drop start zones of absent players (explicit-zone templates) -> they become treasure zones
  for (const z of zoneList) {
    if (z.type === 'start' && z.owner >= n) { z.type = 'treasure'; delete z.owner; z.terrain = 'random'; z.towns = { neutral: 1 }; }
  }
  return { zones: zoneList, links };
}

/** Metadata for the UI: `[{ id, name, description, players, sizes, water }]`. */
export function listTemplates() {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, players: t.players.slice(), sizes: t.sizes.slice(), water: t.water }));
}
