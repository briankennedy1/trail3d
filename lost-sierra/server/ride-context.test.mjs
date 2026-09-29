import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clipContextSegment,rideContextForMap,roadEdgePoint} from '../../src/ride-context-data.ts';

test('town labels choose road boundary crossings instead of interior bends',()=>{
  const lines=[[[4,0],[5,9],[0,8]]],bounds={west:0,east:10,south:0,north:10};
  assert.deepEqual(roadEdgePoint(lines,bounds,1,1),[0,8]);
  assert.deepEqual(roadEdgePoint(lines,bounds,1,-1),[4,0]);
  assert.equal(roadEdgePoint([[[2,2],[5,9]]],bounds,1,1),undefined);
});

test('context clips crossings even when both endpoints lie outside the ride map',()=>{
  assert.deepEqual(clipContextSegment([-5,5],[15,5],10,10),[[0,5],[10,5]]);
  assert.equal(clipContextSegment([-5,-2],[15,-2],10,10),null);
  assert.deepEqual(clipContextSegment([5,-5],[5,15],10,10),[[5,0],[5,10]]);
});

test('Buzzards context includes named road and river, bounded to the terrain',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/terrain/ride-context.geojson',import.meta.url)));
  const meta=JSON.parse(fs.readFileSync(new URL('../public/terrain/buzzards-roost-ridge/terrain.json',import.meta.url)));
  const map={bbox:meta.bbox,widthM:4800,heightM:7700};
  const features=rideContextForMap(source,map);
  for(const name of ['La Porte Road','Nelson Creek','Middle Fork Feather River'])assert.ok(features.some(f=>f.name===name),name);
  assert.equal(new Set(features.map(f=>`${f.kind}:${f.name}`)).size,features.length);
  for(const f of features)for(const line of f.lines)for(const [x,y] of line){
    assert.ok(x>=-1e-8&&x<=map.widthM+1e-8&&y>=-1e-8&&y<=map.heightM+1e-8);
  }
});
