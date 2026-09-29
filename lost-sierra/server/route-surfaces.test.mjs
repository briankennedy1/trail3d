import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {surfaceTypesForTrack} from '../../src/route-surfaces.ts';

test('surface ranges follow exact GPS points and reject stale or invalid data',async()=>{
  const points=[[1,2,3],[2,3,4],[3,4,5],[4,5,6]];
  const record={pointCount:4,coordinatesSha256:createHash('sha256').update(JSON.stringify(points)).digest('hex'),ranges:[{from:0,to:1,type:'asphalt'},{from:1,to:2,type:'singletrack'},{from:2,to:3,type:'dirt'}]};
  assert.deepEqual(await surfaceTypesForTrack(record,points),['asphalt','singletrack','dirt']);
  const unknown=['unknown','unknown','unknown'];
  assert.deepEqual(await surfaceTypesForTrack(record,points.map(p=>[...p.slice(0,2),0])),unknown);
  assert.deepEqual(await surfaceTypesForTrack({...record,ranges:[{from:1,to:3,type:'dirt'}]},points),unknown);
  assert.deepEqual(await surfaceTypesForTrack({...record,ranges:[{from:0,to:3,type:'toString'}]},points),unknown);
  assert.deepEqual(await surfaceTypesForTrack({...record,ranges:null},points),unknown);
});

test('every imported ride has complete non-overlapping surface coverage tied to its GPS',async()=>{
  const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
  const data=read('../public/terrain/route-surfaces.json');
  const rides=[{id:'beckwourth-peak',track:'beckwourth-track.geojson'},...read('../data/curated-rides.json')];
  assert.equal(Object.keys(data.rides).length,rides.length);
  for(const ride of rides){
    const coordinates=read('../data/'+ride.track).geometry.coordinates;
    const types=await surfaceTypesForTrack(data.rides[ride.id],coordinates);
    assert.equal(types.length,coordinates.length-1,ride.id);
    assert.ok(types.some(t=>t!=='unknown'),ride.id);
    const counts=Object.groupBy(types,t=>t);
    for(const type of Object.keys(counts))assert.ok(data.rides[ride.id].meters[type]>0,`${ride.id}: ${type}`);
  }
});
