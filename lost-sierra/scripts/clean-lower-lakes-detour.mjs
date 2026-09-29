// Reconstruct the short mapped junction connection, preserving the surrounding GPS.
// Run normally to rebuild the GeoJSON; add --apply after backing up the live DB.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {root,saveTrack,trackStats} from '../server/store.mjs';
import {sampleTerrain} from '../src/ride-data.js';
const id='lower-lakes-basin-loop',dir=path.join(root,'data/routes');
const original=JSON.parse(fs.readFileSync(path.join(dir,`${id}-before-detour-cleanup.geojson`)));
const ways=JSON.parse(fs.readFileSync(path.join(dir,`${id}-junction-ways.json`))).ways;
const coords=original.geometry.coordinates,start=1124,end=1165;
const xy=p=>[p[0]*85500,p[1]*111320],distance=(a,b)=>Math.hypot(...xy(a).map((v,i)=>v-xy(b)[i]));
const approach=ways.find(w=>w.id===310893493).geometry.map(p=>[p.lon,p.lat]);
let best={distance:Infinity};
for(let i=0;i<approach.length-1;i++){
 const a=xy(approach[i]),b=xy(approach[i+1]),p=xy(coords[start]),dx=b[0]-a[0],dy=b[1]-a[1];
 const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
 const point=approach[i].map((v,k)=>v+(approach[i+1][k]-v)*t),gap=distance(point,coords[start]);
 if(gap<best.distance)best={distance:gap,i,point};
}
if(best.distance>20)throw Error('Approach no longer matches the reviewed junction.');
const road=ways.find(w=>w.id===310893494).geometry.map(p=>[p.lon,p.lat]);
if(distance(road.at(-1),coords[end])>20)throw Error('Exit no longer matches the reviewed junction.');
const pathPoints=[coords[start].slice(0,2),best.point,...approach.slice(best.i+1),...road.slice(1),coords[end].slice(0,2)];
const connector=[pathPoints[0]];
for(let i=1;i<pathPoints.length;i++){
 const a=pathPoints[i-1],b=pathPoints[i],steps=Math.max(1,Math.ceil(distance(a,b)/10));
 for(let j=1;j<=steps;j++)connector.push(a.map((v,k)=>v+(b[k]-v)*j/steps));
}
const meta=JSON.parse(fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.json`)));
const bytes=fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.bin`)),heights=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);
const along=[0];for(let i=1;i<connector.length;i++)along.push(along.at(-1)+distance(connector[i-1],connector[i]));
const elevations=connector.map(p=>sampleTerrain(meta,heights,...p));
const beginOffset=coords[start][2]-elevations[0],endOffset=coords[end][2]-elevations.at(-1);
const inserted=connector.slice(1,-1).map((p,j)=>[...p,Math.round((elevations[j+1]+beginOffset+(endOffset-beginOffset)*along[j+1]/along.at(-1))*100)/100]);
const route=structuredClone(original);route.geometry.coordinates=[...coords.slice(0,start+1),...inserted,...coords.slice(end)];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
route.properties.repair={type:'remove-junction-detour',date:'2026-09-29',originalGeometrySha256:sha(original.geometry),originalFromIndex:start,originalToIndex:end,requestedMiles:[12.51,12.91],originalSpliceMiles:[12.4907,12.9589],removedPointCount:end-start-1,insertedPointCount:inserted.length,removedDistanceM:trackStats(original).distance-trackStats(route).distance,osmWayIds:[310893493,310893494],geometrySource:'OpenStreetMap contributors',geometrySourceUrl:'https://www.openstreetmap.org/copyright',method:'Follow mapped approach to junction and short southbound connector to the continuing trail. Sample existing terrain, blend endpoint elevations, and retain all points outside the splice exactly. Source climbing and estimated moving time remain the original Trailforks plan totals.'};
fs.writeFileSync(path.join(dir,`${id}.geojson`),JSON.stringify(route)+'\n');
console.log(JSON.stringify({distanceMiles:trackStats(route).distance/1609.344,removedMiles:route.properties.repair.removedDistanceM/1609.344,insertedPoints:inserted.length}));
if(process.argv.includes('--apply')){
 const db=new DatabaseSync(path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite'),{timeout:5000});
 db.exec('BEGIN IMMEDIATE');
 try{
  const old=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id),current=JSON.parse(old.geojson);
  if(sha(current.geometry)!==sha(route.geometry)){
   if(sha(current.geometry)!==sha(original.geometry))throw Error('Live track changed; review before applying.');
   saveTrack(db,id,route,`${route.properties.sourceLabel} — junction detour removed`,route.properties.sourceUrl);
   const now=new Date().toISOString();
   db.prepare('UPDATE entries SET version=version+1,updated_at=? WHERE id=?').run(now,id);
   db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('clean-lower-lakes-detour',id,JSON.stringify({track:old}),JSON.stringify({track:route,repair:route.properties.repair}),now);
  }
  db.exec('COMMIT');console.log('Live track updated; CMS fields and home view preserved.');
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
}
