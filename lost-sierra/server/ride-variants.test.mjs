import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rideVariant,shuttleStartIndex} from '../src/ride-variants.js';
import {validateEntry} from './store.mjs';
const ride=JSON.parse(fs.readFileSync(new URL('../data/curated-rides.json',import.meta.url))).find(r=>r.id==='buzzards-roost-ridge');
const track=JSON.parse(fs.readFileSync(new URL('../data/routes/buzzards-roost-ridge.geojson',import.meta.url)));
const entry={...ride.details,id:ride.id,kind:'ride',name:'Buzzard’s',area:'Quincy',status:'published',coordinates:{lat:39.8,lng:-120.88}};
test('Buzzard shuttle trims points and surfaces together, preserving terrain and home',()=>{
 const map={},home={},base={home,data:{map,ride:{points:track.geometry.coordinates}},surfaceTypes:track.geometry.coordinates.slice(1).map((_,i)=>i),pointsOfInterest:[{name:'Route start'},{name:'Buzzard Roost Ridge'}]};
 const index=shuttleStartIndex(entry,track);assert.equal(index,2035);
 const result=rideVariant(entry,track,base,'shuttle');
 assert.equal(result.options.data.map,map);assert.equal(result.options.home,home);
 assert.deepEqual(result.options.data.ride.points[0],track.geometry.coordinates[index]);
 assert.deepEqual(result.options.data.ride.points.at(-1),track.geometry.coordinates.at(-1));
 assert.equal(result.options.surfaceTypes[0],index);
 assert.equal(result.options.surfaceTypes.length,result.options.data.ride.points.length-1);
 assert.equal(result.entry.startMapsUrl,entry.shuttle.startMapsUrl);
 assert.equal(result.entry.finishMapsUrl,entry.startMapsUrl);
 assert.equal(result.entry.sameStartFinish,false);
 assert.equal(result.options.pointsOfInterest.find(p=>p.name==='Route start').url,entry.shuttle.startMapsUrl);
 assert.equal(result.options.pointsOfInterest.find(p=>p.name==='Route finish').url,entry.startMapsUrl);
 assert.equal(rideVariant(entry,track,base,'loop').options.data,base.data);
 assert.equal(base.data.ride.points.length,6142);
});
test('missing and off-route shuttle starts are unavailable',()=>{
 assert.equal(shuttleStartIndex({},track),null);
 assert.equal(shuttleStartIndex({...entry,shuttle:{enabled:true,coordinates:{lat:40,lng:-121}}},track),null);
});
test('CMS accepts shuttle fields and rejects invalid starts or metrics',()=>{
 assert.deepEqual(validateEntry(entry).shuttle,entry.shuttle);
 for(const update of [{coordinates:null},{startMapsUrl:'javascript:alert(1)'},{climbingFt:-1},{movingMinutes:'45'}])assert.throws(()=>validateEntry({...entry,shuttle:{...entry.shuttle,...update}}));
 assert.equal(validateEntry({...entry,shuttle:{enabled:false}}).shuttle.enabled,false);
});
