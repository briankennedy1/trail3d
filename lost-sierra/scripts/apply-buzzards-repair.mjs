// Apply the reviewed repair to an existing database, preserving CMS edits.
// Make a database backup first. Fresh databases already seed the corrected track.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {root,saveTrack} from '../server/store.mjs';
const id='buzzards-roost-ridge',db=new DatabaseSync(path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite'),{timeout:5000});
try{
 const route=JSON.parse(fs.readFileSync(path.join(root,`data/routes/${id}.geojson`)));
 const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),track=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
 if(!row||!track)throw Error('Existing Buzzards Roost ride and track required.');
 const previousGeometry=JSON.parse(track.geojson).geometry;
 if(JSON.stringify(previousGeometry)===JSON.stringify(route.geometry)){console.log('Repair already applied.');process.exitCode=0;}
 else{
  const hash=createHash('sha256').update(JSON.stringify(previousGeometry)).digest('hex');
  if(hash!==route.properties.repair.recordedGeometrySha256)throw Error('Track changed since import. Review it before applying this repair.');
  const before=JSON.parse(row.content_json),after=structuredClone(before),details=JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json'))).find(r=>r.id===id).details;
  const imported=db.prepare("SELECT after_json FROM audit_log WHERE entry_id=? AND action='curated-route-import' ORDER BY id DESC LIMIT 1").get(id);
  const originalDefaults=imported?JSON.parse(imported.after_json).entry:null;
  after.coordinates=details.coordinates;
  if(before.climbingFt===2894)after.climbingFt=details.climbingFt;
  if(before.descendingFt===4034)after.descendingFt=details.descendingFt;
  for(const poi of after.viewer?.pointsOfInterest||[]){
   if(poi.name==='Route start'&&Math.abs(poi.longitude-previousGeometry.coordinates[0][0])<.00001&&Math.abs(poi.latitude-previousGeometry.coordinates[0][1])<.00001){poi.longitude=details.coordinates.lng;poi.latitude=details.coordinates.lat;}
  }
  if(originalDefaults&&JSON.stringify(before.viewer?.home)===JSON.stringify(originalDefaults.viewer?.home))after.viewer.home=details.viewer.home;
  const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{
   // Guard against edits between the read and write.
   if(db.prepare('SELECT version FROM entries WHERE id=?').get(id).version!==row.version||db.prepare('SELECT geojson FROM tracks WHERE entry_id=?').get(id).geojson!==track.geojson)throw Error('Ride changed during repair. Retry after reviewing it.');
   saveTrack(db,id,route,route.properties.sourceLabel,route.properties.sourceUrl);
   db.prepare('UPDATE entries SET content_json=?,latitude=?,longitude=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),details.coordinates.lat,details.coordinates.lng,now,id);
   db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('repair-missing-ride-start',id,JSON.stringify({entry:before,track}),JSON.stringify({entry:after,repair:route.properties.repair}),now);
   db.exec('COMMIT');console.log('Applied Buzzards Roost repair; original track retained in audit history.');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
}finally{db.close();}
