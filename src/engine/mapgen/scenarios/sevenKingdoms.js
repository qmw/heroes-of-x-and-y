// Seven Kingdoms - a large seven-player map. The layout is computed from a few numbers (polar
// sectors around a central plateau) instead of being typed out. Original content. Cell = 4x4 tiles.
const N = 27;
const C = 13;
const KINGDOMS = [
  { faction: 'castle', t: 'g', name: 'Highmere' },
  { faction: 'tower', t: 'n', name: 'Frostcrown' },
  { faction: 'inferno', t: 'l', name: 'Cinderhold' },
  { faction: 'stronghold', t: 'r', name: 'Gorrak' },
  { faction: 'fortress', t: 'w', name: 'Mirefen' },
  { faction: 'conflux', t: 'h', name: 'Windspire' },
  { faction: 'factory', t: 'x', name: 'Brasswell' },
];
const ROT = -Math.PI / 2;
const sectorAngle = (k) => ROT + ((k + 0.5) / KINGDOMS.length) * Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
const polar = (r, a) => [Math.round(C + r * Math.cos(a)), Math.round(C + r * Math.sin(a))];

function cellChar(cx, cy) {
  const dx = cx - C; const dy = cy - C;
  const r = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const k = ((Math.floor(((a - ROT) / (Math.PI * 2)) * KINGDOMS.length) % 7) + 7) % 7;
  const nearGap = (radius, width) => KINGDOMS.some((_, j) => angDiff(a, sectorAngle(j)) * Math.max(radius, 1) < width);
  if (r <= 3.3) return 's';
  if (r <= 4.4) return nearGap(r, 0.75) ? 's' : 'S';
  if (r <= 6.0) return 'd';
  if (r <= 7.0) return nearGap(r, 0.8) ? KINGDOMS[k].t : 'D';
  const t = KINGDOMS[k].t;
  if (r > 16 || cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1) return t.toUpperCase();
  // walls between kingdoms
  for (let j = 0; j < KINGDOMS.length; j++) {
    const boundary = ROT + (j / KINGDOMS.length) * Math.PI * 2;
    if (angDiff(a, boundary) * r < 0.85) return t.toUpperCase();
  }
  // a few rocky outcrops inside each kingdom
  if (Math.abs(r - 10.5) < 0.5 && angDiff(a, sectorAngle(k) + 0.32) * r < 0.6) return t.toUpperCase();
  return t;
}

const layout = [];
for (let cy = 0; cy < N; cy++) {
  let row = '';
  for (let cx = 0; cx < N; cx++) row += cellChar(cx, cy);
  layout.push(row);
}

const towns = KINGDOMS.map((k, i) => ({ cell: polar(9.3, sectorAngle(i)), faction: k.faction, owner: i, name: k.name }));
towns.push({ cell: [C, C], faction: 'random', owner: null, name: 'The Seventh Throne' });
const roads = [];
const objects = [];
const scatter = [];
const GATE_GUARDS = ['halberdier', 'master_gremlin', 'demon', 'orc_chieftain', 'lizard_warrior', 'storm_elemental', 'armadillo'];
KINGDOMS.forEach((k, i) => {
  const a = sectorAngle(i);
  roads.push({ points: [`town:${i}`, polar(6.5, a), polar(5.2, a), polar(3.9, a), 'town:7'], type: 2 });
  roads.push({ points: [polar(5.2, a), polar(5.2, a + Math.PI / 7), polar(5.2, sectorAngle((i + 1) % 7))], type: 1 });
  objects.push({ def: 'monster', cell: polar(6.5, a), data: { creatureId: GATE_GUARDS[i], count: 25, disposition: 'hostile' } });
  objects.push({ def: 'monster', cell: polar(3.9, a), data: { creatureId: 'ogre_mage', count: 18, disposition: 'hostile' } });
  objects.push({ def: 'sawmill', cell: polar(8.6, a - 0.3) });
  objects.push({ def: 'ore_pit', cell: polar(8.6, a + 0.3) });
  objects.push({ def: ['alchemists_lab', 'sulfur_dune', 'crystal_cavern', 'gem_pond'][i % 4], cell: polar(11.6, a - 0.15), guard: 3500 });
  objects.push({ def: 'gold_mine', cell: polar(5.4, a + Math.PI / 7), guard: 7000 });
  const cells = [];
  for (const r of [8, 9.5, 11, 12]) for (const d of [-0.25, 0, 0.25]) cells.push(polar(r, a + d));
  scatter.push({ cells, band: { min: 500, max: 4000 }, count: 6, factions: [k.faction] });
});
objects.push({ def: 'library_of_enlightenment', cell: [C - 2, C], guard: 12000 });
objects.push({ def: 'artifact_relic', cell: [C + 2, C], guard: 20000 });
objects.push({ def: 'black_market', cell: [C, C + 2] });
scatter.push({ area: [C - 3, C - 3, C + 3, C + 3], band: { min: 5000, max: 12000 }, count: 5 });

export default {
  id: 'seven_kingdoms',
  name: 'Seven Kingdoms',
  description: 'Seven realms ring the plateau of the Seventh Throne, an empty seat of power whose ruler vanished a '
    + 'generation ago. Every kingdom borders two rivals and the old royal road. A large free-for-all for up to seven players.',
  size: 'L', players: 7, difficulty: 'hard', scale: 4, seed: 404, decor: 0.1,
  victory: 'standard', loss: 'standard',
  victoryText: 'Defeat all six rivals.', lossText: 'Lose all your towns and heroes.',
  playerInfo: KINGDOMS.map((k, i) => ({ slot: i, faction: k.faction })),
  layout, towns,
  heroes: KINGDOMS.map((_, i) => ({ owner: i, town: i })),
  roads, objects, scatter,
};
