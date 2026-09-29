import fs from 'node:fs';
import path from 'node:path';

// Apply each curated import once. Only replace original planner placeholders;
// retain subsequent CMS edits, saved home views, status and area assignments.
export function importCuratedRides(db,root,saveTrack){
  const rides=JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json'),'utf8'));
  for(const ride of rides){
    const key=`curated-route-v1:${ride.id}`;
    if(db.prepare('SELECT key FROM settings WHERE key=?').get(key))continue;
    const row=db.prepare('SELECT * FROM entries WHERE id=?').get(ride.id);if(!row)continue;
    const before=JSON.parse(row.content_json),original=JSON.parse(row.original_json||'{}'),after={...before};
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
      if(!db.prepare('SELECT entry_id FROM tracks WHERE entry_id=?').get(ride.id))saveTrack(db,ride.id,feature,feature.properties.sourceLabel,feature.properties.sourceUrl);
      const location=after.coordinates||{lat:row.latitude,lng:row.longitude};
      db.prepare('UPDATE entries SET content_json=?,latitude=?,longitude=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),location.lat,location.lng,now,ride.id);
      db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('curated-route-import',ride.id,JSON.stringify(before),JSON.stringify({entry:after,trackSource:feature.properties}),now);
      db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key,JSON.stringify({importedAt:now,source:feature.properties.sourceUrl}));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
}
