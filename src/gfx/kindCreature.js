// `creature` kind: wires the creature painter into the sprite cache.

import { CREATURES, CREATURE_BY_ID } from '../data/creatures.js';
import { CREATURE_GROUND, STATE_FRAMES, paintCreature } from './creatures.js';

export const CREATURE_IDS = CREATURES.map((c) => c.id);

/**
 * opts: size = pixel HEIGHT of the sprite (width = size for 1-hex, 2*size for 2-hex creatures),
 *       state = idle|move|attack|shoot|hit|defend|dead, frame, facing 1|-1.
 * Anchor: feet at (width/2, 0.92*height).
 */
export function creatureHandler(id, o) {
  const c = CREATURE_BY_ID[id];
  if (!c) throw new Error(`gfx: unknown creature '${id}'`);
  const state = STATE_FRAMES[o.state] ? o.state : 'idle';
  const n = STATE_FRAMES[state];
  const frame = ((((o.frame | 0) % n) + n) % n);
  const dw = c.size === 2 ? 200 : 100;
  return {
    dw, dh: 100, unit: 100, size: 96, frames: n,
    ax: dw / 2, ay: CREATURE_GROUND,
    key: `${state}|${frame}`,
    mirror: o.facing === -1,
    paint: (g) => paintCreature(g, id, state, frame),
  };
}
