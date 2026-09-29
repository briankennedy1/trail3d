// Apply the reviewed Trailforks 785884 replacement to an existing database.
// Run the backup command first. Fresh databases already seed the new route.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {root,saveTrack} from '../server/store.mjs';

const id='lower-lakes-basin-loop';
const sourceUrl='https://www.trailforks.com/routeplan/view/785884/';
// Coordinates SHA-256 from git HEAD before the source route was replaced.
const oldCoordinatesSha256='cdfbd46ce0069a4498e328f3ae3624266d1b10fe035b6e96aa9a66e9f95cd41e';
const oldSeed={
  summary:'A recorded Lakes Basin loop linking Grassy, Long and Smith Lake trails with Graeagle Creek.',
  notes:'Frazier Falls road - Grassy Lake - Long Lake (blue) - Smith Lake- Graeagle Creek',
  home:{position:[-121.09257225208883,115.17052617459919,-252.70207302111848],target:[-16.43270080772002,-2.5533424119070367,-12.045169692058774],zoom:0.85},
};
const sha=coordinates=>createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function applyLowerLakesReplacement(db,{projectRoot=root,expectedOldSha=oldCoordinatesSha256,previousSeed=oldSeed}={}){
  const manifest=JSON.parse(fs.readFileSync(path.join(projectRoot,'data/curated-rides.json'),'utf8'));
  const seed=manifest.find(ride=>ride.id===id);
  if(!seed||seed.track!==`routes/${id}.geojson`)throw Error('Reviewed Lower Lakes Basin seed is missing or points to another track.');
  const details=seed.details,route=JSON.parse(fs.readFileSync(path.join(projectRoot,'data',seed.track),'utf8'));
  if(route?.geometry?.type!=='LineString'||!Array.isArray(route.geometry.coordinates)||route.geometry.coordinates.length<2)throw Error('Replacement track must be a LineString.');
  if(route.properties?.sourceUrl!==sourceUrl||details?.routeUrl!==sourceUrl)throw Error('Replacement must use reviewed Trailforks route 785884.');
  if(!details.coordinates||!Number.isFinite(details.coordinates.lat)||!Number.isFinite(details.coordinates.lng)||
    !['climbingFt','descendingFt','movingMinutes'].every(key=>Number.isFinite(details[key]))||
    typeof details.movingTimeEstimated!=='boolean'||typeof details.sameStartFinish!=='boolean'||
    typeof details.startMapsUrl!=='string'||typeof details.finishMapsUrl!=='string')throw Error('Replacement seed is missing reviewed route stats or parking fields.');
  const newSha=sha(route.geometry.coordinates);
  db.exec('BEGIN IMMEDIATE');
  try{
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),track=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    if(!row||!track)throw Error('Existing Lower Lakes Basin ride and track required.');
    const previous=JSON.parse(track.geojson),currentSha=sha(previous.geometry?.coordinates);
    if(currentSha===newSha){db.exec('COMMIT');return 'Replacement already applied.';}
    if(currentSha!==expectedOldSha)throw Error('Existing track differs from the reviewed old route. No changes made.');
    const before=JSON.parse(row.content_json),after=structuredClone(before);
    for(const field of ['coordinates','routeUrl','climbingFt','descendingFt','movingMinutes','movingTimeEstimated','sameStartFinish','startMapsUrl','finishMapsUrl'])after[field]=details[field];
    for(const field of ['summary','notes'])if(before[field]===previousSeed[field])after[field]=details[field];
    if(after.viewer){
      after.viewer={...after.viewer};
      if(Array.isArray(after.viewer.pointsOfInterest))after.viewer.pointsOfInterest=after.viewer.pointsOfInterest.filter(point=>!/route start/i.test(point.name||''));
      if(equal(before.viewer?.home,previousSeed.home))delete after.viewer.home;
    }
    const now=new Date().toISOString();
    saveTrack(db,id,route,route.properties.sourceLabel,route.properties.sourceUrl);
    db.prepare('UPDATE entries SET content_json=?,latitude=?,longitude=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),details.coordinates.lat,details.coordinates.lng,now,id);
    const updatedTrack=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('replace-lower-lakes-basin-route',id,JSON.stringify({entry:before,track,coordinatesSha256:currentSha}),JSON.stringify({entry:after,track:updatedTrack,coordinatesSha256:newSha}),now);
    db.exec('COMMIT');
    return 'Applied Lower Lakes Basin replacement; prior track and entry are in the audit log.';
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite');
  if(!fs.existsSync(file))throw Error(`Existing guide database required: ${file}`);
  const db=new DatabaseSync(file,{timeout:5000});
  try{console.log(applyLowerLakesReplacement(db));}finally{db.close();}
}
