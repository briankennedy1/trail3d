// Build a small, self-contained terrain model around the September 25 ride.
// The polyline is copied from the public Trailforks ridelog's map data.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public', 'beckwourth');
const cache = path.join(root, '.cache', 'beckwourth');
fs.mkdirSync(cache, { recursive: true });
const encoded = fs.readFileSync(path.join(out, 'ride.polyline'), 'utf8').trim();

function decode(s) {
  const points = [];
  let lat = 0, lon = 0, i = 0;
  while (i < s.length) {
    for (let axis = 0; axis < 2; axis++) {
      let value = 0, shift = 0, byte;
      do {
        byte = s.charCodeAt(i++) - 63;
        value |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      const delta = value & 1 ? ~(value >> 1) : value >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

const coords = decode(encoded);
if (coords.length < 100) throw new Error('Ride polyline appears incomplete');
// The phone started recording partway up the shared stem. The return trace
// covers the missing City Park section; the recorded outbound trace is the
// canonical stem for both directions. Indices refer to ride.polyline.
const recordedStartOnReturn = 1474;
const outboundJunction = 386;
const returnJunction = 1170;
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 111320;
if (gap(coords[0], coords[recordedStartOnReturn]) > 20 ||
    gap(coords[outboundJunction], coords[returnJunction]) > 20) {
  throw new Error('Lollipop splice points no longer match the source trace');
}
const parkApproach = coords.slice(recordedStartOnReturn).reverse();
// Trailforks' mapped Salty Section follows the direct City Park approach.
// The return GPS trace adds a park overshoot, a backtrack, and a south spur.
// https://www.trailforks.com/trails/beckwourth-peak-trail-park-to-bottom-of-climb-salty-section/
const approachDetours = [[1, 6], [12, 30], [35, 44], [50, 69]];
const directParkApproach = parkApproach.filter((_, i) =>
  !approachDetours.some(([first, last]) => i >= first && i <= last));
const stem = [
  ...directParkApproach,
  ...coords.slice(0, outboundJunction + 1),
];
const cleanedCoords = [
  ...stem,
  ...coords.slice(outboundJunction + 1, returnJunction),
  ...stem.slice().reverse(),
];
const lons = coords.map(p => p[0]), lats = coords.map(p => p[1]);
const pad = 0.009;
const bbox = {
  west: Math.min(...lons) - pad,
  east: Math.max(...lons) + pad,
  south: Math.min(...lats) - pad,
  north: Math.max(...lats) + pad,
};
const metersLon = 111320 * Math.cos((bbox.south + bbox.north) * Math.PI / 360);
const metersLat = 111320;
const widthM = (bbox.east - bbox.west) * metersLon;
const heightM = (bbox.north - bbox.south) * metersLat;
const toXY = ([lon, lat]) => [(lon - bbox.west) * metersLon, (lat - bbox.south) * metersLat];

const zoom = 12, n = 2 ** zoom;
const lonTile = lon => ((lon + 180) / 360) * n;
const latTile = lat => ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * n;
const x0 = Math.floor(lonTile(bbox.west)), x1 = Math.floor(lonTile(bbox.east));
const y0 = Math.floor(latTile(bbox.north)), y1 = Math.floor(latTile(bbox.south));
const tiles = new Map();
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const file = path.join(cache, `${zoom}-${x}-${y}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Terrain tile ${x}/${y}: HTTP ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  tiles.set(`${x},${y}`, PNG.sync.read(fs.readFileSync(file)));
}
function pixel(x, y) {
  const tx = Math.floor(x / 256), ty = Math.floor(y / 256);
  const tile = tiles.get(`${tx},${ty}`);
  if (!tile) throw new Error(`Missing terrain tile ${tx}/${ty}`);
  const i = ((y - ty * 256) * 256 + x - tx * 256) * 4;
  return tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
}
function elevation(lon, lat) {
  const x = lonTile(lon) * 256 - 0.5, y = latTile(lat) * 256 - 0.5;
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
  return pixel(i, j) * (1 - u) * (1 - v) + pixel(i + 1, j) * u * (1 - v)
    + pixel(i, j + 1) * (1 - u) * v + pixel(i + 1, j + 1) * u * v;
}

const spacing = 30;
const w = Math.round(widthM / spacing) + 1, h = Math.round(heightM / spacing) + 1;
const grid = new Uint16Array(w * h);
let min = Infinity, max = -Infinity;
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const lon = bbox.west + i / (w - 1) * (bbox.east - bbox.west);
  const lat = bbox.north - j / (h - 1) * (bbox.north - bbox.south);
  const z = elevation(lon, lat);
  min = Math.min(min, z); max = Math.max(max, z);
  grid[j * w + i] = Math.round(z * 4);
}
const ride = cleanedCoords.map(p => {
  const [x, y] = toXY(p);
  return [Math.round(x), Math.round(y), Math.round(elevation(...p) * 10) / 10];
});
const map = {
  bbox,
  widthM: Math.round(widthM), heightM: Math.round(heightM),
  grid: { width: w, height: h, spacing, scale: 4 },
  elevation: { min: Math.round(min), max: Math.round(max) },
  basin: [[0, 0], [Math.round(widthM), 0], [Math.round(widthM), Math.round(heightM)], [0, Math.round(heightM)]],
  lakes: [], wilderness: [], roads: [], labels: [],
  attribution: ['Ride: Trailforks ridelog 124349783', 'Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM)'],
};
fs.writeFileSync(path.join(out, 'terrain.bin'), Buffer.from(grid.buffer));
fs.writeFileSync(path.join(out, 'map.json'), JSON.stringify(map));
fs.writeFileSync(path.join(out, 'ride.json'), JSON.stringify({ id: 124349783, date: '2026-09-25', points: ride }));
console.log(`${ride.length} cleaned ride points from ${coords.length} recorded points; ${w}x${h} terrain; ${min.toFixed(0)}–${max.toFixed(0)} m`);
