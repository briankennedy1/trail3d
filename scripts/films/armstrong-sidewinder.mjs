// Fountain Place → Armstrong Connector → Sidewinder → Incense Cedar → Powerline Road → Corral
//
// Climbs Fountain Place Road all the way to its top, where Armstrong Connector begins; pauses;
// then descends Armstrong Connector, Sierra Sidewinder, and Incense Cedar, and rolls across
// Powerline Road to the bottom of Corral. Same framing and pace as fountain-place-corral.

import { ride } from './lib/ride.mjs';

export const setup = ride({
  title: 'Fountain Place → Incense Cedar',
  route: [
    // from the bottom of Fountain Place Road, near Oneidas, to its top
    { name: 'Fountain Place Road', from: [-119.9945, 38.8648], to: [-119.9404, 38.8564] },
    { name: 'Armstrong Connector Trail', to: [-119.9563, 38.8668] },
    { name: 'Sierra Sidewinder', from: [-119.9579, 38.8664], to: [-119.9633, 38.8705] },
    { name: 'Incense Cedar', from: [-119.9627, 38.8714], to: [-119.9662, 38.8872] },
    // Incense Cedar ends on Powerline Road; follow it southwest to its end
    { name: 'Powerline Road', to: [-119.9795, 38.8803] },
    // and a short hop to the bottom of Corral
    { to: [-119.9776, 38.8813] },
  ],
  stops: [{ afterLeg: 0, label: 'Top of Fountain Place' }],
});
