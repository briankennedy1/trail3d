import curatedRides from '../data/curated-rides.json' with { type: 'json' };

// Keep assigned colors stable when the visible catalog is filtered or archived.
const routeIds=['beckwourth-peak',...curatedRides.map(ride=>ride.id)];
export function overviewRouteColor(id){
  const index=routeIds.indexOf(id);
  let hash=0;for(const character of id)hash=(Math.imul(hash,31)+character.charCodeAt(0))>>>0;
  const hue=index<0?hash%360:(32+index*137.508)%360;
  return `hsl(${hue.toFixed(2)}, 68%, 43%)`;
}
