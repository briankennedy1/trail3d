// Replace the reviewed Jamison recording with Trailforks plan 785988.
// Back up the existing database first; fresh databases use the updated seed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {root,saveTrack} from '../server/store.mjs';

const id='jamison-creek-loop',sourceUrl='https://www.trailforks.com/routeplan/view/785988/';
const oldCoordinatesSha256='f82d8eb23a8359ec7f0662c66f6d3d2215418108e7ae2c171c2749c384d9f19c';
const sha=coordinates=>createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');

export function applyJamisonReplacement(db,{projectRoot=root,expectedOldSha=oldCoordinatesSha256}={}){
  const seed=JSON.parse(fs.readFileSync(path.join(projectRoot,'data/curated-rides.json'),'utf8')).find(ride=>ride.id===id);
  if(seed?.track!==`routes/${id}.geojson`)throw Error('Reviewed Jamison Creek seed is missing.');
  const details=seed.details,route=JSON.parse(fs.readFileSync(path.join(projectRoot,'data',seed.track),'utf8'));
  if(route?.geometry?.type!=='LineString'||!Array.isArray(route.geometry.coordinates)||route.geometry.coordinates.length<2||route.properties?.sourceUrl!==sourceUrl||details?.routeUrl!==sourceUrl)throw Error('Replacement must be the reviewed Trailforks plan 785988.');
  const fields=['coordinates','routeUrl','climbingFt','descendingFt','movingMinutes','movingTimeEstimated','sameStartFinish','startMapsUrl','finishMapsUrl'];
  if(fields.some(field=>details[field]===undefined))throw Error('Reviewed route details are incomplete.');
  const newSha=sha(route.geometry.coordinates);
  db.exec('BEGIN IMMEDIATE');
  try{
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),track=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    if(!row||!track)throw Error('Existing Jamison Creek ride and track required.');
    const currentSha=sha(JSON.parse(track.geojson).geometry.coordinates);
    if(currentSha===newSha){db.exec('COMMIT');return 'Replacement already applied.';}
    if(currentSha!==expectedOldSha)throw Error('Existing Jamison track differs from the reviewed recording. No changes made.');
    const before=JSON.parse(row.content_json),after=structuredClone(before);
    for(const field of fields)after[field]=details[field];
    if(after.viewer?.pointsOfInterest)after.viewer.pointsOfInterest=after.viewer.pointsOfInterest.filter(point=>!/^route start$/i.test(point.name||''));
    const now=new Date().toISOString();
    saveTrack(db,id,route,route.properties.sourceLabel,route.properties.sourceUrl);
    db.prepare('UPDATE entries SET content_json=?,latitude=?,longitude=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),details.coordinates.lat,details.coordinates.lng,now,id);
    db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('replace-jamison-creek-route',id,JSON.stringify({entry:before,track,coordinatesSha256:currentSha}),JSON.stringify({entry:after,track:db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id),coordinatesSha256:newSha}),now);
    db.exec('COMMIT');
    return 'Applied Jamison Creek replacement; previous entry and track retained in audit history.';
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite');
  if(!fs.existsSync(file))throw Error(`Existing guide database required: ${file}`);
  const db=new DatabaseSync(file,{timeout:5000});
  try{console.log(applyJamisonReplacement(db));}finally{db.close();}
}
