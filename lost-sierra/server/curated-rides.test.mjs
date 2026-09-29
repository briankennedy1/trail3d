import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore,root,saveTrack,listEntries,trackStats} from './store.mjs';
import {importCuratedRides} from './curated-rides.mjs';
import {regionalRideData} from '../src/ride-data.js';

test('curated imports preserve CMS edits, existing tracks and saved home on repeat',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'curated-rides-')),db=openStore(dir);
 try{
  const id='haskell-peak',row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),entry=JSON.parse(row.content_json);
  entry.notes='My local notes';entry.viewer.home={position:[10,30,60],target:[0,0,0],zoom:1};
  db.prepare('UPDATE entries SET content_json=?,area=? WHERE id=?').run(JSON.stringify(entry),'Haskell',id);
  db.prepare('DELETE FROM settings WHERE key=?').run(`curated-route-v1:${id}`);
  const track=db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson;
  importCuratedRides(db,root,saveTrack);
  const saved=listEntries(db).find(e=>e.id===id);assert.equal(saved.notes,entry.notes);assert.equal(saved.area,'Haskell');assert.deepEqual(saved.viewer.home,entry.viewer.home);
  assert.equal(db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson,track);
  importCuratedRides(db,root,saveTrack);assert.equal(listEntries(db).find(e=>e.id===id).version,saved.version);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('both source tracks fit detailed terrain, with Lake Davis shoreline and islands',()=>{
 for(const [id,miles] of [['lake-davis-loop',19.2],['haskell-peak',8.7]]){
  const route=JSON.parse(fs.readFileSync(path.join(root,`data/routes/${id}.geojson`)));
  assert.ok(Math.abs(trackStats(route).distance/1609.344-miles)<.1);
  const meta=JSON.parse(fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.json`)));
  const b=fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.bin`));
  const view=regionalRideData(route,meta,new Uint16Array(b.buffer,b.byteOffset,b.length/2));
  assert.ok(view.data.map.grid.spacing<=31);assert.equal(view.data.ride.points.length,route.geometry.coordinates.length);
  for(const [x,y] of view.data.ride.points){assert.ok(x>=0&&x<=view.data.map.widthM);assert.ok(y>=0&&y<=view.data.map.heightM);}
  if(id==='lake-davis-loop'){assert.equal(view.data.map.lakes[0].name,'Lake Davis');assert.equal(view.data.map.lakes[0].inner.length,10);assert.ok(view.data.map.lakes[0].level>1750&&view.data.map.lakes[0].level<1770);}
 }
});
