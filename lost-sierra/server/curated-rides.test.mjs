import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore,root,saveTrack,listEntries,trackStats} from './store.mjs';
import {importCuratedRides} from './curated-rides.mjs';
import {regionalRideData} from '../src/ride-data.js';

test('new curated family options seed once and retain subsequent CMS edits',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'curated-option-')),db=openStore(dir);
 try{
  const id='mt-elwell-not-so-easy',entry=listEntries(db).find(e=>e.id===id);
  assert.equal(entry.rideFamily.id,'mt-elwell');assert.equal(entry.hasTrack,true);
  assert.equal(entry.sameStartFinish,false);assert.notEqual(entry.startMapsUrl,entry.finishMapsUrl);
  entry.notes='Updated in CMS';
  db.prepare('UPDATE entries SET content_json=? WHERE id=?').run(JSON.stringify(entry),id);
  importCuratedRides(db,root,saveTrack);
  assert.equal(listEntries(db).find(e=>e.id===id).notes,'Updated in CMS');
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

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
test('all imported tracks fit detailed terrain and have usable profiles',()=>{
 const expectedMiles={'jamison-creek-big-way':24.28,'downieville-adventure-mode':22.28,'downieville-original':16.18,'lake-davis-loop':19.2,'haskell-peak':8.7,'mills-peak':24.9,'mills-peak-shuttle':12.44,'mills-peak-shuttle-from-the-top':9.24,'gold-valley-rim-pauley-creek-dh':20.6,'jamison-creek-loop':13.7,'lower-lakes-basin-loop':15.82,'mt-elwell-hard-way':23.64,'mt-elwell-not-so-easy':12.70,'buzzards-roost-ridge':12.3,'hough-tollgate':31.1,'hough-classic':26.8,'indian-falls-acorn-grotto':28.3,'graeagle-smith-creek-loop':14.8,'lakes-basin-intense-explore':14.9};
 for(const {id,terrain,track} of JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json')))){
  const route=JSON.parse(fs.readFileSync(path.join(root,`data/${track}`)));
  assert.ok(Math.abs(trackStats(route).distance/1609.344-expectedMiles[id])<.1,id);
  assert.ok(route.geometry.coordinates.every(p=>p.length===3&&p[2]>500),`${id} needs usable elevation values`);
  assert.match(route.properties.sourceUrl,/^https:\/\/www\.trailforks\.com\//);
  assert.match(route.properties.gpxSha256,/^[a-f0-9]{64}$/);
  const meta=JSON.parse(fs.readFileSync(path.join(root,`public${terrain}/terrain.json`)));
  const b=fs.readFileSync(path.join(root,`public${terrain}/terrain.bin`));
  const view=regionalRideData(route,meta,new Uint16Array(b.buffer,b.byteOffset,b.length/2));
  assert.ok(view.data.map.grid.spacing<=31);assert.equal(view.data.ride.points.length,route.geometry.coordinates.length);
  for(const [x,y] of view.data.ride.points){assert.ok(x>=0&&x<=view.data.map.widthM);assert.ok(y>=0&&y<=view.data.map.heightM);}
  if(id==='lake-davis-loop'){assert.equal(view.data.map.lakes[0].name,'Lake Davis');assert.equal(view.data.map.lakes[0].inner.length,10);assert.ok(view.data.map.lakes[0].level>1750&&view.data.map.lakes[0].level<1770);}
 }
});

test('Buzzards Roost repair closes the loop and preserves every recorded point',()=>{
 const route=JSON.parse(fs.readFileSync(path.join(root,'data/routes/buzzards-roost-ridge.geojson')));
 const original=JSON.parse(fs.readFileSync(path.join(root,'data/routes/buzzards-roost-ridge-recorded.geojson')));
 const points=route.geometry.coordinates,n=route.properties.repair.addedPointCount;
 assert.deepEqual(points[0],points.at(-1));
 assert.deepEqual(points.slice(n),original.geometry.coordinates);
 const added=trackStats({type:'LineString',coordinates:points.slice(0,n+1)});
 assert.ok(added.distance>3000&&added.distance<3300);
 assert.ok(added.ascent>340&&added.ascent<420);
 for(let i=1;i<=n;i++){
  const a=points[i-1],b=points[i];
  assert.ok(Math.hypot((a[0]-b[0])*85500,(a[1]-b[1])*111320)<=15.1,'No shortcut or jump on the reconstructed road');
  assert.ok(Math.abs(a[2]-b[2])<8,'Elevation joins smoothly');
 }
});

test('Lower Lakes junction cleanup preserves surrounding GPS and follows a short continuous connector',()=>{
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,`data/routes/${name}.geojson`)));
 const before=read('lower-lakes-basin-loop-before-detour-cleanup'),after=read('lower-lakes-basin-loop');
 const {originalFromIndex:start,originalToIndex:end,insertedPointCount:n}=after.properties.repair;
 const old=before.geometry.coordinates,points=after.geometry.coordinates;
 assert.deepEqual(points.slice(0,start+1),old.slice(0,start+1));
 assert.deepEqual(points.slice(start+1+n),old.slice(end));
 const removed=(trackStats(before).distance-trackStats(after).distance)/1609.344;
 assert.ok(removed>.38&&removed<.41);
 for(let i=start+1;i<=start+1+n;i++){
  const a=points[i-1],b=points[i];
  assert.ok(Math.hypot((a[0]-b[0])*85500,(a[1]-b[1])*111320)<10.1);
  assert.ok(Math.abs(a[2]-b[2])<4);
 }
});
