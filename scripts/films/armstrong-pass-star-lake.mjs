// Fountain Place → Armstrong Pass → Tahoe Rim Trail → Star Lake → Cold Creek → Railroad Grade
//
// Climbs Fountain Place Road and the Armstrong Pass Trail to the Rim, follows the Tahoe Rim
// Trail north to Star Lake, then descends the Star Lake Trail, Cold Creek, and Lower Cold Creek,
// and crosses over to the Railroad Grade Trail, which climbs gently to the bottom of Corral.
// Same framing and pace as fountain-place-corral.
//
// Two gaps have no trail in the map data, so the gold line bridges them straight across:
// the bottom of Star Lake Trail → the top of Cold Creek Trail (~870 m), and the end of
// Lower Cold Creek → the top of Railroad Grade (~930 m).

import { ride } from './lib/ride.mjs';

export const setup = ride({
  title: 'Armstrong Pass → Star Lake → Cold Creek',
  route: [
    { name: 'Fountain Place Road', from: [-119.9945, 38.8648], to: [-119.9404, 38.8564] },
    { name: 'Armstrong Pass Trail', from: [-119.9405, 38.8565], to: [-119.9122, 38.8321] },
    { name: 'Tahoe Rim Trail', from: [-119.9122, 38.8321], to: [-119.8902, 38.8771] },
    { name: 'Star Lake Trail', from: [-119.8902, 38.8771], to: [-119.91, 38.8951] },
    { name: 'Cold Creek Trail', from: [-119.9051, 38.9019], to: [-119.9488, 38.8988] },
    { name: 'Lower Cold Creek Trail', from: [-119.9488, 38.8988], to: [-119.9568, 38.9025] },
    { name: 'Railroad Grade Trail', from: [-119.966, 38.8981], to: [-119.9786, 38.8808] },
    { to: [-119.9776, 38.8813] }, // the bottom of Corral
  ],
  stops: [
    { afterLeg: 1, label: 'Armstrong Pass' },
    { afterLeg: 2, label: 'Star Lake' },
  ],
});
