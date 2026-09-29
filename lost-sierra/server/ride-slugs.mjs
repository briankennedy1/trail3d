// Preserve the complete CMS record when a public ride ID is renamed.
export function migrateRideSlugs(db){
 const from='mt-elwell',to='mt-elwell-hard-way';
 const row=db.prepare('SELECT * FROM entries WHERE id=?').get(from);
 if(!row||db.prepare('SELECT id FROM entries WHERE id=?').get(to))return;
 db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
 try{
  const content=JSON.parse(row.content_json);content.id=to;
  db.prepare('UPDATE entries SET id=?,content_json=?,version=version+1,updated_at=? WHERE id=?').run(to,JSON.stringify(content),new Date().toISOString(),from);
  db.prepare('UPDATE tracks SET entry_id=? WHERE entry_id=?').run(to,from);
  db.prepare('UPDATE audit_log SET entry_id=? WHERE entry_id=?').run(to,from);
  for(const prefix of ['curated-route-v1:','curated-access-v1:'])db.prepare('UPDATE settings SET key=? WHERE key=?').run(prefix+to,prefix+from);
  db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('ride-slug-change',to,JSON.stringify({id:from}),JSON.stringify({id:to}),new Date().toISOString());
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
