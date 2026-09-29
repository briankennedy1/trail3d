// Apply the reviewed loop closure without replacing the ride's CMS edits.
// Back up the database before running this script. Fresh databases use the seed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {root,saveTrack} from '../server/store.mjs';

const id='lakes-basin-intense-explore';
const originalSha='b857e4d75db116cbde42282423f35037a9ad016b11eebefefb0dd123308363c7';
const sha=coordinates=>createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');

export function applyRidiculousLoop(db,{projectRoot=root}={}){
  const route=JSON.parse(fs.readFileSync(path.join(projectRoot,`data/routes/${id}.geojson`),'utf8'));
  const coordinates=route.geometry.coordinates;
  if(sha(coordinates.slice(0,-1))!==originalSha||JSON.stringify(coordinates[0])!==JSON.stringify(coordinates.at(-1)))throw Error('Reviewed closure must retain all original points and append the exact start.');
  const correctedSha=sha(coordinates);
  db.exec('BEGIN IMMEDIATE');
  try{
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id),track=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    if(!row||!track)throw Error('Existing Ridiculous Route and track required.');
    const currentSha=sha(JSON.parse(track.geojson).geometry.coordinates),before=JSON.parse(row.content_json);
    if(currentSha===correctedSha&&before.sameStartFinish===true){db.exec('COMMIT');return 'Loop closure already applied.';}
    if(![originalSha,correctedSha].includes(currentSha))throw Error('Live track changed; review before applying the loop closure.');
    const after={...before,sameStartFinish:true},now=new Date().toISOString();
    if(currentSha!==correctedSha)saveTrack(db,id,route,`${track.source_label} — loop closed`,track.source_url);
    db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),now,id);
    const updatedTrack=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
    db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('close-ridiculous-loop',id,JSON.stringify({entry:before,track,version:row.version}),JSON.stringify({entry:after,track:updatedTrack,repair:route.properties.repair}),now);
    db.exec('COMMIT');return 'Ridiculous Route loop closed; CMS notes, slug, home view and other fields preserved.';
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite');
  if(!fs.existsSync(file))throw Error('Existing guide database required.');
  const db=new DatabaseSync(file,{timeout:5000});
  try{console.log(applyRidiculousLoop(db));}finally{db.close();}
}
