import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {saveTrack} from './store.mjs';
import {applyLowerLakesReplacement} from '../scripts/apply-lower-lakes-replacement.mjs';

test('Lower Lakes replacement preserves CMS fields, audits old track, and runs once',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lower-lakes-replacement-'));
  const db=new DatabaseSync(path.join(temp,'guide.sqlite'));
  try{
    db.exec(fs.readFileSync(path.join(import.meta.dirname,'schema.sql'),'utf8'));
    const id='lower-lakes-basin-loop';
    const oldCoords=[[-120.61,39.76,1300],[-120.611,39.761,1301]];
    const newCoords=[[-120.61788,39.76599,1332],[-120.618,39.766,1333]];
    const oldHome={position:[-1,2,3],target:[0,0,0],zoom:.85};
    const oldDefaults={summary:'Old summary',notes:'Old notes',home:oldHome};
    const oldEntry={id,name:'Lower Lakes Basin Loop',kind:'ride',area:'Lakes Basin',status:'draft',coordinates:{lat:39.76,lng:-120.61},routeUrl:'https://example.org/old',climbingFt:3000,descendingFt:2990,movingMinutes:200,movingTimeEstimated:false,sameStartFinish:false,startMapsUrl:'https://maps.google.com/old-start',finishMapsUrl:'https://maps.google.com/old-finish',summary:'Old summary',notes:'Rider-written notes',mustRide:true,viewer:{home:oldHome,contextLabels:{mode:'none',names:[]},pointsOfInterest:[{name:'Route start',latitude:39.76,longitude:-120.61},{name:'Lake overlook',latitude:39.761,longitude:-120.611}]}};
    db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,status,content_json,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'ride',oldEntry.name,oldEntry.area,39.76,-120.61,'draft',JSON.stringify(oldEntry),JSON.stringify(oldEntry),'prior');
    saveTrack(db,id,{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:oldCoords}},'Old recording','https://example.org/old');
    const oldTrack=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    const details={coordinates:{lat:39.76599,lng:-120.61788},routeUrl:'https://www.trailforks.com/routeplan/view/785884/',climbingFt:2864,descendingFt:2863,movingMinutes:163,movingTimeEstimated:true,sameStartFinish:true,startMapsUrl:'https://www.google.com/maps?q=39.76599,-120.61788',finishMapsUrl:'',summary:'New summary',notes:'New notes'};
    const data=path.join(temp,'project');fs.mkdirSync(path.join(data,'data/routes'),{recursive:true});
    fs.writeFileSync(path.join(data,'data/curated-rides.json'),JSON.stringify([{id,track:`routes/${id}.geojson`,details}]));
    fs.writeFileSync(path.join(data,`data/routes/${id}.geojson`),JSON.stringify({type:'Feature',properties:{sourceLabel:'Route plan',sourceUrl:details.routeUrl},geometry:{type:'LineString',coordinates:newCoords}}));
    const oldHash=createHash('sha256').update(JSON.stringify(oldCoords)).digest('hex');
    assert.match(applyLowerLakesReplacement(db,{projectRoot:data,expectedOldSha:oldHash,previousSeed:oldDefaults}),/Applied/);
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),entry=JSON.parse(row.content_json);
    assert.equal(row.name,'Lower Lakes Basin Loop');assert.equal(row.status,'draft');assert.equal(row.latitude,details.coordinates.lat);
    assert.equal(entry.notes,'Rider-written notes');assert.equal(entry.summary,'New summary');assert.equal(entry.mustRide,true);
    for(const key of ['routeUrl','climbingFt','descendingFt','movingMinutes','movingTimeEstimated','sameStartFinish','startMapsUrl','finishMapsUrl'])assert.deepEqual(entry[key],details[key],key);
    assert.equal(entry.viewer.home,undefined);assert.deepEqual(entry.viewer.contextLabels,oldEntry.viewer.contextLabels);
    assert.deepEqual(entry.viewer.pointsOfInterest,[oldEntry.viewer.pointsOfInterest[1]]);
    const audit=db.prepare("SELECT * FROM audit_log WHERE action='replace-lower-lakes-basin-route'").get();
    assert.deepEqual(JSON.parse(audit.before_json).track,{...oldTrack});
    assert.deepEqual(JSON.parse(db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson).geometry.coordinates,newCoords);
    assert.match(applyLowerLakesReplacement(db,{projectRoot:data,expectedOldSha:oldHash,previousSeed:oldDefaults}),/already applied/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='replace-lower-lakes-basin-route'").get().n,1);
    assert.equal(db.prepare('SELECT version FROM entries WHERE id=?').get(id).version,row.version);
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
