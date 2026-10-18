// Binds the real engine modules written by the other agents into the deps seam (see deps.js).
// Lookups happen at call time (module namespaces), so the import cycles
// adventure <-> town/economy/hero are harmless.
import * as bonuses from '../bonuses.js';
import * as hero from '../hero.js';
import * as economy from '../economy.js';
import * as town from '../town.js';
import { registerRealModule } from './deps.js';

for (const ns of [bonuses, hero, economy, town]) registerRealModule(ns);
