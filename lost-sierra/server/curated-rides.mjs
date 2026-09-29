import fs from 'node:fs';
import path from 'node:path';

// Apply each curated import once. Only replace original planner placeholders;
// retain subsequent CMS edits, saved home views, status and area assignments.
export function importCuratedRides(db,root,saveTrack){
  const rides=JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json'),'utf8'));
  for(const ride of rides){
    const key=`curated-route-v1:${ride.id}`;
    if(db.prepare('SELECT key FROM settings WHERE key=?').get(key))continue;
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(ride.id);if(!row&&!ride.entry)continue;
    const before=row?JSON.parse(row.content_json):{},original=JSON.parse(row?.original_json||'{}'),after={...before};
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const [field,value] of Object.entries(ride.details)){
      if(field==='viewer'){
        after.viewer={...value,...before.viewer};
      }else if(before[field]==null||before[field]===''||equal(before[field],original[field]))after[field]=value;
    }
    const feature=JSON.parse(fs.readFileSync(path.join(root,'data',ride.track),'utf8'));
    const now=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!row){
        const seed={...ride.entry,...after,id:ride.id};
        db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,status,content_json,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(ride.id,seed.kind,seed.name,seed.area,seed.coordinates.lat,seed.coordinates.lng,seed.status||'published',JSON.stringify(seed),JSON.stringify(seed),now);
        Object.assign(after,seed);
      }
      if(!db.prepare('SELECT entry_id FROM tracks WHERE entry_id=?').get(ride.id))saveTrack(db,ride.id,feature,feature.properties.sourceLabel,feature.properties.sourceUrl);
      const location=after.coordinates||{lat:row.latitude,lng:row.longitude};
      db.prepare('UPDATE entries SET content_json=?,latitude=?,longitude=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),location.lat,location.lng,now,ride.id);
      db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('curated-route-import',ride.id,JSON.stringify(before),JSON.stringify({entry:after,trackSource:feature.properties}),now);
      db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key,JSON.stringify({importedAt:now,source:feature.properties.sourceUrl}));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  // Add newly supplied access links to older imports once, without replaying
  // their track import or replacing any subsequent CMS edits.
  for(const ride of rides){
    const fields=['startMapsUrl','finishMapsUrl','sameStartFinish'];
    if(!fields.some(f=>ride.details[f]!=null))continue;
    const key=`curated-access-v1:${ride.id}`;
    if(db.prepare('SELECT key FROM settings WHERE key=?').get(key))continue;
    const row=db.prepare('SELECT content_json FROM entries WHERE id=?').get(ride.id);if(!row)continue;
    const before=JSON.parse(row.content_json),after={...before};
    for(const f of fields)if(before[f]===undefined&&ride.details[f]!==undefined)after[f]=ride.details[f];
    const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{
      if(JSON.stringify(before)!==JSON.stringify(after)){
        db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),now,ride.id);
        db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('ride-access-links',ride.id,JSON.stringify(before),JSON.stringify(after),now);
      }
      db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key,JSON.stringify({importedAt:now}));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
}
