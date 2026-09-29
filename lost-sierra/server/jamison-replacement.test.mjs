import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {saveTrack,openStore} from './store.mjs';
import {applyJamisonReplacement} from '../scripts/apply-jamison-replacement.mjs';

test('Jamison replacement checks the prior track, preserves CMS edits, audits recovery data and runs once',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jamison-replacement-')),db=new DatabaseSync(path.join(temp,'guide.sqlite'));
  try{
    db.exec(fs.readFileSync(path.join(import.meta.dirname,'schema.sql'),'utf8'));
    const id='jamison-creek-loop',coords=[[-120.71,39.74,1700],[-120.711,39.741,1701]];
    const home={position:[1,2,3],target:[0,0,0],zoom:.85};
    const before={id,name:'My Jamison Loop',slug:'my-jamison',notes:'Rider notes',intensity:'Intense',mustRide:true,viewer:{home,contextLabels:{mode:'none',names:[]},pointsOfInterest:[{name:'Route start',latitude:39.74,longitude:-120.71},{name:'Overlook',latitude:39.741,longitude:-120.711}]}};
    db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,status,content_json,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'ride',before.name,'Lakes Basin',39.74,-120.71,'draft',JSON.stringify(before),JSON.stringify(before),'prior');
    saveTrack(db,id,{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}},'Old recording','https://example.org/old');
    const oldTrack={...db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id)},oldRow={...db.prepare('SELECT * FROM entries WHERE id=?').get(id)};
    assert.throws(()=>applyJamisonReplacement(db),/differs/);
    assert.deepEqual({...db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id)},oldTrack,'a changed track is never overwritten');
    assert.deepEqual({...db.prepare('SELECT * FROM entries WHERE id=?').get(id)},oldRow);
    const expectedOldSha=createHash('sha256').update(JSON.stringify(coords)).digest('hex');
    assert.match(applyJamisonReplacement(db,{expectedOldSha}),/Applied/);
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),after=JSON.parse(row.content_json);
    assert.equal(row.name,before.name);assert.equal(row.status,'draft');
    for(const field of ['name','slug','notes','intensity','mustRide'])assert.deepEqual(after[field],before[field]);
    assert.deepEqual(after.viewer.home,home);assert.deepEqual(after.viewer.contextLabels,before.viewer.contextLabels);
    assert.deepEqual(after.viewer.pointsOfInterest,[before.viewer.pointsOfInterest[1]]);
    assert.equal(after.routeUrl,'https://www.trailforks.com/routeplan/view/785988/');
    assert.equal(after.climbingFt,2897);assert.equal(after.descendingFt,2898);assert.equal(after.movingMinutes,180);assert.equal(after.movingTimeEstimated,true);assert.equal(after.sameStartFinish,true);
    const audit=db.prepare("SELECT * FROM audit_log WHERE action='replace-jamison-creek-route'").get();
    assert.deepEqual(JSON.parse(audit.before_json).entry,before);assert.deepEqual(JSON.parse(audit.before_json).track,oldTrack);
    assert.match(applyJamisonReplacement(db,{expectedOldSha}),/already applied/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='replace-jamison-creek-route'").get().n,1);
    assert.equal(db.prepare('SELECT version FROM entries WHERE id=?').get(id).version,row.version);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('fresh guides seed the new Jamison plan, loop access and source totals',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jamison-seed-')),db=openStore(temp);
  try{
    const entry=JSON.parse(db.prepare('SELECT content_json FROM entries WHERE id=?').get('jamison-creek-loop').content_json);
    const row=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get('jamison-creek-loop'),track=JSON.parse(row.geojson);
    assert.equal(track.geometry.coordinates.length,1542);assert.ok(track.geometry.coordinates.every(point=>point.length===3&&point[2]>0));
    assert.equal(row.source_url,'https://www.trailforks.com/routeplan/view/785988/');
    assert.equal(entry.routeUrl,row.source_url);assert.equal(entry.sameStartFinish,true);
    assert.equal(entry.climbingFt,2897);assert.equal(entry.descendingFt,2898);assert.equal(entry.movingMinutes,180);
    assert.deepEqual(track.geometry.coordinates[0].slice(0,2),[-120.70742,39.74231]);
    assert.match(entry.startMapsUrl,/39.74231,-120.70742/);assert.equal(entry.finishMapsUrl,'');
    assert.deepEqual(entry.viewer.pointsOfInterest,[]);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
