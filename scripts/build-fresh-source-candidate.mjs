// Explicit source-newgame producer. The legacy candidate CLI and authored
// collection keep their historical compatibility mode and strict recipe pins.
import {sourceCandidateCli} from './source-candidate.mjs';
import {FRESH_SOURCE_PRODUCTS} from './source-production-mode.mjs';
await sourceCandidateCli({productMode:FRESH_SOURCE_PRODUCTS,defaultOutput:'build/reports/fresh-source-candidate'});
