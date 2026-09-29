// Rebuild the missing road climb; never change the recorded portion.
// Run from anywhere: node lost-sierra/scripts/repair-buzzards-start.mjs
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sampleTerrain} from '../src/ride-data.js';
import {trackStats} from '../server/store.mjs';
const root=path.resolve(import.meta.dirname,'..'),id='buzzards-roost-ridge';
const file=path.join(root,`data/routes/${id}.geojson`);
const original=JSON.parse(fs.readFileSync(path.join(root,`data/routes/${id}-recorded.geojson`)));
const road=JSON.parse(fs.readFileSync(path.join(root,`data/routes/${id}-start-road.geojson`)));
const recorded=original.geometry.coordinates,points=[];
const distance=(a,b)=>Math.hypot((a[0]-b[0])*85500,(a[1]-b[1])*111320);
const roadCoords=road.geometry.coordinates;
for(let i=1;i<roadCoords.length;i++){
 const a=roadCoords[i-1],b=roadCoords[i],steps=Math.max(1,Math.ceil(distance(a,b)/15));
 for(let j=0;j<steps;j++)points.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);
}
const route=structuredClone(original);
route.geometry.coordinates=[...points,...recorded];
fs.writeFileSync(file,JSON.stringify(route)+'\n');
execFileSync(process.execPath,[path.join(root,'scripts/build-ride-terrain.mjs'),id],{stdio:'inherit'});
const meta=JSON.parse(fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.json`)));
const buffer=fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.bin`));
const heights=new Uint16Array(buffer.buffer,buffer.byteOffset,buffer.length/2);
const join=[...points,recorded[0]],along=[0];
for(let i=1;i<join.length;i++)along.push(along.at(-1)+distance(join[i-1],join[i]));
const elevation=join.map(([lon,lat])=>sampleTerrain(meta,heights,lon,lat));
// Blend the small DEM/GPS datum offsets across the climb, joining both ends
// continuously. The finish/start and original recording remain exact XYZ.
const startOffset=recorded.at(-1)[2]-elevation[0],endOffset=recorded[0][2]-elevation.at(-1);
const prefix=points.map((p,i)=>[...p,Math.round((elevation[i]+startOffset+(endOffset-startOffset)*along[i]/along.at(-1))*100)/100]);
prefix[0]=[...recorded.at(-1)];
route.geometry.coordinates=[...prefix,...recorded];
const added=trackStats({type:'LineString',coordinates:[...prefix,recorded[0]]});
route.properties.sourceLabel='Trailforks ride log + reconstructed La Porte Road climb';
route.properties.elevationSource='Original GPS recording; missing climb estimated from AWS/USGS terrain';
route.properties.repair={
 type:'prepend-missing-road-climb',date:'2026-09-28',
 recordedGeometrySha256:createHash('sha256').update(JSON.stringify(original.geometry)).digest('hex'),
 originalPointCount:recorded.length,addedPointCount:prefix.length,
 addedDistanceM:added.distance,estimatedAddedAscentM:added.ascent,estimatedAddedDescentM:added.descent,
 referenceUrl:road.properties.roadVerifiedOn,geometrySource:'OpenStreetMap contributors',
 geometrySourceUrl:road.properties.sourceUrl,osmWayIds:road.properties.osmWayIds,
 method:'Follow mapped La Porte Road from the recording finish to its start. Sample DEM every 15 m or less; blend endpoint altitude offsets. Retain all recorded points unchanged.'
};
fs.writeFileSync(file,JSON.stringify(route)+'\n');
const manifestFile=path.join(root,'data/curated-rides.json'),manifest=JSON.parse(fs.readFileSync(manifestFile)),ride=manifest.find(r=>r.id===id);
ride.details.coordinates={lat:recorded.at(-1)[1],lng:recorded.at(-1)[0]};
ride.details.climbingFt=2894+Math.round(added.ascent/.3048);
ride.details.descendingFt=4034+Math.round(added.descent/.3048);
// Repair provenance belongs in route.properties, not the public ride notes.
const flag=ride.details.viewer.pointsOfInterest.find(p=>p.name==='Route start');flag.latitude=recorded.at(-1)[1];flag.longitude=recorded.at(-1)[0];
const b=meta.bbox,scale=Math.max(.25,Math.max((b.east-b.west)*111320*Math.cos((b.north+b.south)*Math.PI/360),(b.north-b.south)*111320)/7338),cy=((meta.min+meta.max)/2-1898)/100*2.3;
ride.details.viewer.home={position:[-73.69*scale,cy+71.64*scale,-153.78*scale],target:[-10*scale,cy,-7.33*scale],zoom:.85};
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({addedMiles:added.distance/1609.344,climbingFt:ride.details.climbingFt,descendingFt:ride.details.descendingFt,totalMiles:trackStats(route).distance/1609.344}));
