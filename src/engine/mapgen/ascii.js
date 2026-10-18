// ASCII rendering of a MapBlueprint for debugging and tests.
import { MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';

const TERRAIN_CHAR = { dirt: ',', sand: ':', grass: '.', snow: '*', swamp: '%', rough: ';', subterranean: '_', lava: '^', highlands: '"', wasteland: '`', water: '~', rock: '#' };
const EFFECT_CHAR = {
  monster: 'M', mine: 'm', bank: 'B', dwelling: 'D', pickup: '$', chest: '$', artifact: 'a', spell_scroll: 'a',
  boat: 'b', teleport: 'O', garrison: 'G', border_guard: 'K', keymaster_tent: 'k', quest_guard: 'Q', seer_hut: 'S',
  pandoras_box: 'P', shipyard: 'Y', obelisk: '!', prison: 'J',
};

/**
 * One block per level; legend: terrain chars `.`=grass `,`=dirt `:`=sand `*`=snow `%`=swamp `;`=rough
 * `_`=subterranean `^`=lava `"`=highlands `` ` ``=wasteland `~`=water `#`=rock; `=` road; `X` obstacle;
 * `T` town (footprint `t`), `H` starting hero, `M` monster, `m` mine, `B` bank, `D` dwelling, `$` pickup,
 * `a` artifact, `O` teleport, `b` boat, `Y` shipyard, `S` seer hut, `P` pandora, `!` obelisk, `o` other object.
 * @param {object} bp MapBlueprint
 * @param {{showGrail?: boolean}} [opts]
 */
export function renderBlueprintAscii(bp, opts = {}) {
  const { map } = bp;
  const W = map.width; const H = map.height;
  const grid = [];
  for (let z = 0; z < map.levels; z++) {
    const rows = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const t = map.tiles[z][y][x];
        let c = TERRAIN_CHAR[t.t] || '?';
        if (t.road) c = '=';
        if (t.blocked) c = 'X';
        row.push(c);
      }
      rows.push(row);
    }
    grid.push(rows);
  }
  for (const obj of Object.values(map.objects || {})) {
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def) continue;
    const z = obj.pos.z || 0;
    if (def.effect.type === 'grail') {
      if (opts.showGrail) grid[z][obj.pos.y][obj.pos.x] = 'g';
      continue;
    }
    if (def.category === 'decor' || !def.visitable) continue;
    grid[z][obj.pos.y][obj.pos.x] = EFFECT_CHAR[def.effect.type] || 'o';
  }
  for (const t of bp.towns || []) {
    const z = t.pos.z || 0;
    for (let y = t.pos.y - 2; y <= t.pos.y; y++) {
      for (let x = t.pos.x - 2; x <= t.pos.x + 2; x++) if (grid[z][y] && grid[z][y][x] !== undefined) grid[z][y][x] = 't';
    }
    grid[z][t.pos.y][t.pos.x] = 'T';
  }
  for (const h of bp.heroes || []) {
    const z = h.pos.z || 0;
    if (grid[z][h.pos.y]) grid[z][h.pos.y][h.pos.x] = 'H';
  }
  return grid.map((rows) => rows.map((r) => r.join('')).join('\n')).join('\n\n');
}
