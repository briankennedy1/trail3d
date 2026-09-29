import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, '.cache', 'terrain');
const out = path.join(root, 'public', 'terrain');
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(out, { recursive: true });
// Includes every published planner location, with space around the edges.
const bbox = { west: -121.12, east: -120.08, south: 39.18, north: 40.49 };
const zoom = 10, n = 2 ** zoom;
const tx = lon => (lon + 180) / 360 * n;
const ty = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
const tiles = new Map(), jobs = [];
for (let x = Math.floor(tx(bbox.west)); x <= Math.floor(tx(bbox.east)); x++) {
  for (let y = Math.floor(ty(bbox.north)); y <= Math.floor(ty(bbox.south)); y++) jobs.push([x, y]);
}
let done = 0;
async function worker() {
  while (jobs.length) {
    const [x,y] = jobs.shift(), file = path.join(cache, `${zoom}-${x}-${y}.png`);
    let buffer;
    try { buffer = await fs.readFile(file); } catch {
      const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Tile ${x}/${y}: ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(file, buffer);
    }
    tiles.set(`${x},${y}`, PNG.sync.read(buffer));
    console.log(`Elevation tile ${++done}: ${x}/${y}`);
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
function pixel(x,y) {
  const tile = tiles.get(`${Math.floor(x/256)},${Math.floor(y/256)}`);
  if (!tile) throw new Error(`Missing elevation ${x},${y}`);
  const i = ((y%256)*256+x%256)*4;
  return tile.data[i]*256+tile.data[i+1]+tile.data[i+2]/256-32768;
}
function height(lon, lat) {
  const x=tx(lon)*256-.5,y=ty(lat)*256-.5,i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j;
  return pixel(i,j)*(1-u)*(1-v)+pixel(i+1,j)*u*(1-v)+pixel(i,j+1)*(1-u)*v+pixel(i+1,j+1)*u*v;
}
const width=257,heightCount=417, data=new Uint16Array(width*heightCount);
let min=Infinity,max=-Infinity;
for(let j=0;j<heightCount;j++) for(let i=0;i<width;i++) {
  const e=height(bbox.west+i/(width-1)*(bbox.east-bbox.west),bbox.north-j/(heightCount-1)*(bbox.north-bbox.south));
  min=Math.min(min,e);max=Math.max(max,e);data[j*width+i]=Math.round(e*4);
}
const meta={bbox,width,height:heightCount,scale:4,min,max,source:'AWS Terrain Tiles (USGS 3DEP and SRTM)',sourceUrl:'https://registry.opendata.aws/terrain-tiles/',zoom};
await fs.writeFile(path.join(out,'region.json'),JSON.stringify(meta));
await fs.writeFile(path.join(out,'region.bin'),Buffer.from(data.buffer));
// Preserve the curated ride as a distinct track with its own source.
const original=path.resolve(root,'..','public','beckwourth');
const map=JSON.parse(await fs.readFile(path.join(original,'map.json'),'utf8'));
const ride=JSON.parse(await fs.readFile(path.join(original,'ride.json'),'utf8'));
const metersLon=111320*Math.cos((map.bbox.south+map.bbox.north)*Math.PI/360);
const geo={type:'Feature',properties:{name:'Beckwourth Peak — BKXC September 25 ride',sourceUrl:'https://www.trailforks.com/ridelog/view/124349783/',note:'Cleaned phone recording with healed shared stem. This is a different recording from the planner’s original route link.'},geometry:{type:'LineString',coordinates:ride.points.map(([x,y,z])=>[map.bbox.west+x/metersLon,map.bbox.south+y/111320,z])}};
await fs.writeFile(path.join(root,'data','beckwourth-track.geojson'),JSON.stringify(geo));
await fs.copyFile(path.join(original,'terrain.bin'),path.join(out,'beckwourth.bin'));
await fs.writeFile(path.join(out,'beckwourth.json'),JSON.stringify({bbox:map.bbox,width:map.grid.width,height:map.grid.height,scale:map.grid.scale,min:map.elevation.min,max:map.elevation.max}));
console.log(`Regional grid: ${width}×${heightCount}; ${min.toFixed(0)}–${max.toFixed(0)} m. Copied curated Beckwourth terrain and track.`);
