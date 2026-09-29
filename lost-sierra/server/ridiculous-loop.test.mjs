import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {saveTrack,openStore,root} from './store.mjs';
import {applyRidiculousLoop} from '../scripts/apply-ridiculous-loop.mjs';
import {surfaceTypesForTrack} from '../../src/route-surfaces.ts';
import {regionalRideData} from '../src/ride-data.js';

test('Ridiculous Route closes its short endpoint gap, preserves CMS edits, and audits the original track',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ridiculous-loop-')),db=new DatabaseSync(path.join(temp,'guide.sqlite'));
  try{
    db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    const id='lakes-basin-intense-explore',route=JSON.parse(fs.readFileSync(path.join(root,`data/routes/${id}.geojson`)));
    const original={...route,geometry:{...route.geometry,coordinates:route.geometry.coordinates.slice(0,-1)}};
    const entry={id,name:'Lakes Basin Ridiculous Route',kind:'ride',area:'Lakes Basin',slug:'lakes-basin-ridiculous',sameStartFinish:false,notes:'Keep these edited notes',startMapsUrl:'https://maps.google.com/custom-parking',viewer:{home:{position:[-10,20,-30],target:[0,2,0],zoom:1.5},contextLabels:{mode:'none',names:[]}}};
    db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,content_json,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,entry.kind,entry.name,entry.area,39.69861,-120.66706,JSON.stringify(entry),JSON.stringify(entry),'before');
    saveTrack(db,id,original,'Original recording','https://example.org/recording');
    const old=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    assert.match(applyRidiculousLoop(db),/loop closed/);
    const updated=JSON.parse(db.prepare('SELECT content_json FROM entries WHERE id=?').get(id).content_json);
    assert.deepEqual(updated,{...entry,sameStartFinish:true});
    const closed=JSON.parse(db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson).geometry.coordinates;
    assert.deepEqual(closed.slice(0,-1),original.geometry.coordinates);assert.deepEqual(closed[0],closed.at(-1));
    const audit=db.prepare("SELECT before_json FROM audit_log WHERE action='close-ridiculous-loop'").get();
    assert.deepEqual(JSON.parse(audit.before_json).track,{...old});
    assert.match(applyRidiculousLoop(db),/already applied/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='close-ridiculous-loop'").get().n,1);
    const changed=structuredClone(original);changed.geometry.coordinates[1][0]+=.00001;
    saveTrack(db,id,changed,'Newer recording','https://example.org/new');
    assert.throws(()=>applyRidiculousLoop(db),/Live track changed/);
    assert.deepEqual(JSON.parse(db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson).geometry.coordinates,changed.geometry.coordinates);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('Ridiculous Route seeds as a loop with singletrack from displayed mile 14.4 through closure',async()=>{
  const id='lakes-basin-intense-explore',temp=fs.mkdtempSync(path.join(os.tmpdir(),'ridiculous-seed-'));
  const db=openStore(temp);
  try{
    assert.equal(JSON.parse(db.prepare('SELECT content_json FROM entries WHERE id=?').get(id).content_json).sameStartFinish,true);
    const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),track=read(`data/routes/${id}.geojson`),c=track.geometry.coordinates;
    const types=await surfaceTypesForTrack(read('public/terrain/route-surfaces.json').rides[id],c);
    const correction=read('data/route-surface-overrides.json')[id].ranges[0];
    assert.ok(types.slice(correction.from).every(type=>type==='singletrack'));
    assert.equal(types[0],'unknown');assert.equal(types[1264],'dirt');
    const meta=read(`public/terrain/${id}/terrain.json`),bytes=fs.readFileSync(path.join(root,`public/terrain/${id}/terrain.bin`));
    const points=regionalRideData(track,meta,new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.length/2)).data.ride.points;
    let meters=0;for(let i=1;i<=correction.from;i++)meters+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    assert.ok(Math.abs(meters-14.4*1609.344)<2,'Correction starts within 2 m of displayed mile 14.4');
    assert.deepEqual(c[0],c.at(-1));assert.equal(c.length,1943);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
