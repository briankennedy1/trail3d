import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {applySurfaceEstimates} from '../scripts/surface-estimates.mjs';

const range=(from,to,type='singletrack')=>({from,to,type,sourceUrl:'https://www.trailforks.com/trails/example/',rationale:'Reviewed Trailforks trail alignment.'});
const review=ranges=>({coordinatesSha256:'hash',source:'Trailforks-based estimate',reviewedAt:'2026-09-29',ranges});

test('estimates fill only unknown segments and retain their separate provenance',()=>{
  const types=['unknown','asphalt','unknown','dirt','singletrack','unknown'];
  const result=applySurfaceEstimates(types,'hash',review([range(0,6)]),'test');
  assert.deepEqual(types,['singletrack','asphalt','singletrack','dirt','singletrack','singletrack']);
  assert.deepEqual(result.ranges.map(({from,to})=>[from,to]),[[0,1],[2,3],[5,6]]);
  assert.ok(result.ranges.every(r=>r.sourceUrl.includes('trailforks.com')&&r.rationale));
});

test('stale GPS hashes and invalid estimates fail before changing classifications',()=>{
  for(const invalid of [
    {...review([range(0,1)]),coordinatesSha256:'stale'},
    review([range(0,1),range(1,3)]),
    review([range(0,2),range(1,2)]),
    review([range(0,2,'unknown')]),
    review([{...range(0,2),sourceUrl:'https://example.org/'}]),
  ]){
    const types=['unknown','unknown'];
    assert.throws(()=>applySurfaceEstimates(types,'hash',invalid,'test'),/surface estimate/);
    assert.deepEqual(types,['unknown','unknown']);
  }
});

test('surface rebuild retains estimates and prioritizes rider-confirmed corrections',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'surface-estimates-'));
  const put=(file,data)=>{const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data));};
  try{
    const coords=[[-120.7,39.7,1500],[-120.7,39.701,1501],[-120.7,39.702,1502],[-120.7,39.703,1503]];
    const hash=createHash('sha256').update(JSON.stringify(coords)).digest('hex');
    const confirmed={coordinatesSha256:hash,ranges:[{from:1,to:2,type:'asphalt',source:'Confirmed by rider'}]};
    const estimated={...review([range(0,3)]),coordinatesSha256:hash};
    put('data/curated-rides.json',[{id:'test',track:'routes/test.geojson'}]);
    put('data/routes/test.geojson',{geometry:{coordinates:coords}});
    put('data/route-surface-overrides.json',{test:confirmed});
    put('data/route-surface-estimates.json',{test:estimated});
    // Service way without a surface matches the route but remains unclassified.
    put('ways.json',{elements:[{id:123,tags:{highway:'service'},geometry:coords.map(([lon,lat])=>({lon,lat}))}]});
    put('public/terrain/route-surfaces.json',{rides:{other:{sentinel:'keep'}},ways:{}});
    const script=new URL('../scripts/build-route-surfaces.mjs',import.meta.url).pathname;
    const build=()=>spawnSync(process.execPath,[script,path.join(temp,'ways.json'),'--ride','test','--root',temp],{encoding:'utf8'});
    const result=build();assert.equal(result.status,0,result.stderr);
    const file=path.join(temp,'public/terrain/route-surfaces.json');
    const generated=JSON.parse(fs.readFileSync(file));
    assert.deepEqual(generated.rides.test.ranges,[{from:0,to:1,type:'singletrack'},{from:1,to:2,type:'asphalt'},{from:2,to:3,type:'singletrack'}]);
    assert.deepEqual(generated.rides.test.overrides,confirmed.ranges);
    assert.deepEqual(generated.rides.test.estimates.ranges.map(({from,to})=>[from,to]),[[0,1],[2,3]]);
    assert.deepEqual(generated.rides.other,{sentinel:'keep'});
    const prior=fs.readFileSync(file);
    put('data/route-surface-estimates.json',{test:{...estimated,coordinatesSha256:'stale'}});
    assert.notEqual(build().status,0);
    assert.deepEqual(fs.readFileSync(file),prior);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('all reviewed Trailforks gaps are classified with the current GPS hash',()=>{
  const read=file=>JSON.parse(fs.readFileSync(new URL(file,import.meta.url)));
  const estimates=read('../data/route-surface-estimates.json');
  const surfaces=read('../public/terrain/route-surfaces.json');
  const confirmed=read('../data/route-surface-overrides.json');
  for(const [id,estimate] of Object.entries(estimates)){
    const ride=surfaces.rides[id];
    assert.equal(ride.coordinatesSha256,estimate.coordinatesSha256,id);
    assert.equal(ride.meters.unknown,0,id);
    assert.deepEqual(ride.estimates,estimate,id);
    if(confirmed[id])assert.deepEqual(ride.overrides,confirmed[id].ranges,id);
  }
});
