import './beckwourth.css';
import { mountRideViewer, type RideViewerOptions } from './ride-viewer';
import { BECKWOURTH_VIEW } from './beckwourth-preset';

type EmbeddedRide = Omit<RideViewerOptions['data'], 'heights'> & { terrain: string };
async function main() {
  const embedded = (window as Window & { __BECKWOURTH__?: EmbeddedRide }).__BECKWOURTH__;
  const [map, ride, heights] = embedded
    ? [embedded.map, embedded.ride, Uint8Array.from(atob(embedded.terrain), c => c.charCodeAt(0)).buffer]
    : await Promise.all([
      fetch('beckwourth/map.json').then(r => r.json()),
      fetch('beckwourth/ride.json').then(r => r.json()),
      fetch('beckwourth/terrain.bin').then(r => r.arrayBuffer()),
    ]);
  await mountRideViewer({ ...BECKWOURTH_VIEW, data: { map, ride, heights } });
}
main().catch(error => {
  console.error(error);
  document.getElementById('loading')!.textContent = 'Could not load the ride map. Check the browser console.';
});
