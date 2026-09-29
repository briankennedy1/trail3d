// Apply the confirmed loop setting once, preserving all other CMS fields.
export function correctBeckwourthLoop(db){
  const key='beckwourth-loop-v1',id='beckwourth-peak';
  if(db.prepare('SELECT key FROM settings WHERE key=?').get(key))return;
  db.exec('BEGIN IMMEDIATE');
  try{
    const row=db.prepare('SELECT content_json FROM entries WHERE id=?').get(id);
    if(!row){db.exec('ROLLBACK');return;}
    const before=JSON.parse(row.content_json),after={...before,sameStartFinish:true};
    const now=new Date().toISOString();
    db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after),now,id);
    db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)').run('correct-loop-endpoints',id,JSON.stringify(before),JSON.stringify(after),now);
    db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key,JSON.stringify({appliedAt:now}));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
