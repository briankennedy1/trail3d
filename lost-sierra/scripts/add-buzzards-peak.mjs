// Add the requested high-point flag to an existing CMS without replacing its
// home view or other edits. Fresh databases receive this flag from the seed.
// GNIS 257786 (Buzzard Roost Ridge) is mapped about 21 m south of the user's
// chosen summit point: https://geo.mytopo.com/feature/california/plumas/ridge/257786/buzzard-roost-ridge/
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {root,rowEntry,validateEntry} from '../server/store.mjs';
const id='buzzards-roost-ridge';
const seed=JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json'))).find(r=>r.id===id);
const point=seed.details.viewer.pointsOfInterest.find(p=>p.name==='Buzzard Roost Ridge');
const db=new DatabaseSync(path.join(process.env.DATA_DIR||path.join(root,'.data'),'guide.sqlite'),{timeout:5000});
try{
  db.exec('BEGIN IMMEDIATE');
  const row=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  if(!row)throw Error('Buzzards Roost ride must already exist.');
  const before=JSON.parse(row.content_json),after=structuredClone(before);
  const points=after.viewer?.pointsOfInterest||[];
  if(!points.some(p=>p.name===point.name||Math.hypot(p.latitude-point.latitude,p.longitude-point.longitude)<.0001)){
    after.viewer={...after.viewer,pointsOfInterest:[...points,point]};
    validateEntry({...rowEntry(row),viewer:after.viewer});
    const now=new Date().toISOString();
    db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),now,id);
    db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('add-buzzards-peak',id,JSON.stringify(before),JSON.stringify(after),now);
    console.log('Added Buzzard Roost Ridge flag; existing CMS fields preserved.');
  }else console.log('High-point flag already present.');
  db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
