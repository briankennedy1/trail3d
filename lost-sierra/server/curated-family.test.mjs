import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore,saveTrack} from './store.mjs';
import {importCuratedRides} from './curated-rides.mjs';

test('v2 family pass fills an absent Mills Peak Shuttle family despite obsolete v1 marker',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'curated-family-v2-'));
  const db=openStore(path.join(temp,'db'));
  try{
    const id='mills-peak-shuttle',family={id:'mills-peak',name:'Mills Peak',option:'Shuttle',order:1};
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
    assert(row,'Mills Peak Shuttle must exist in the seed catalog');
    const before=JSON.parse(row.content_json);
    delete before.rideFamily;
    before.notes='Rider CMS notes';
    before.viewer={...before.viewer,home:{position:[10,30,60],target:[0,0,0],zoom:1}};
    db.prepare("UPDATE entries SET content_json=?,status='draft' WHERE id=?").run(JSON.stringify(before),id);
    db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?,NULL)').run(`curated-family-v1:${id}`,'{}');
    db.prepare('DELETE FROM settings WHERE key=?').run(`curated-family-v2:${id}`);
    const originalTrack=db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson;
    const seed=path.join(temp,'seed');fs.mkdirSync(path.join(seed,'data'),{recursive:true});
    fs.writeFileSync(path.join(seed,'data/curated-rides.json'),JSON.stringify([{id,details:{rideFamily:family}}]));

    importCuratedRides(db,seed,saveTrack);
    let updated=db.prepare('SELECT * FROM entries WHERE id=?').get(id),content=JSON.parse(updated.content_json);
    assert.deepEqual(content.rideFamily,family);
    assert.equal(content.notes,before.notes);assert.deepEqual(content.viewer.home,before.viewer.home);
    assert.equal(updated.status,'draft');assert.equal(db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson,originalTrack);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='ride-family-assignment' AND entry_id=?").get(id).n,1);
    assert(db.prepare('SELECT key FROM settings WHERE key=?').get(`curated-family-v2:${id}`));

    content.rideFamily={...family,option:'Rider choice'};
    db.prepare('UPDATE entries SET content_json=? WHERE id=?').run(JSON.stringify(content),id);
    importCuratedRides(db,seed,saveTrack);
    updated=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
    assert.equal(JSON.parse(updated.content_json).rideFamily.option,'Rider choice');
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='ride-family-assignment' AND entry_id=?").get(id).n,1);

    content.rideFamily=null;
    db.prepare('UPDATE entries SET content_json=? WHERE id=?').run(JSON.stringify(content),id);
    db.prepare('DELETE FROM settings WHERE key=?').run(`curated-family-v2:${id}`);
    importCuratedRides(db,seed,saveTrack);
    assert.equal(JSON.parse(db.prepare('SELECT content_json FROM entries WHERE id=?').get(id).content_json).rideFamily,null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='ride-family-assignment' AND entry_id=?").get(id).n,1);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
