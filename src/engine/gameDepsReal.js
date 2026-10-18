// Binds the real engine modules into the gameDeps seam (imported once by game.js).
// Lookups are lazy (see bindRealModules), so the import cycles town.js <-> hero.js are harmless.
import * as hero from './hero.js';
import * as bonuses from './bonuses.js';
import * as adventure from './adventure/index.js';
import { bindRealModules } from './gameDeps.js';

export const REAL_MODULES = { hero, bonuses, adventure };
bindRealModules(REAL_MODULES);
