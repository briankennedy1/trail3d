import fs from 'node:fs';
import path from 'node:path';

// Replace imported location placeholders once, retaining independent CMS edits.
export function importAdventureLocations(db, root) {
  const places = JSON.parse(fs.readFileSync(path.join(root, 'data/adventure-locations.json'), 'utf8'));
  const samePoint = (a, b) => a && b && Math.abs(a.lat-b.lat)<1e-7 && Math.abs(a.lng-b.lng)<1e-7;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const place of places) {
      const key = `adventure-location-v1:${place.id}`;
      if (db.prepare('SELECT key FROM settings WHERE key=?').get(key)) continue;
      const row = db.prepare("SELECT * FROM entries WHERE id=? AND kind='adventure'").get(place.id);
      if (!row) continue;
      const before = JSON.parse(row.content_json), original = JSON.parse(row.original_json || '{}');
      const current = {lat:row.latitude,lng:row.longitude};
      const imported = original.coordinates;
      const apply = samePoint(current, imported) || samePoint(current, place.coordinates);
      const now = new Date().toISOString();
      if (apply && !samePoint(current, place.coordinates)) {
        const after = {...before, coordinates:place.coordinates};
        db.prepare('UPDATE entries SET latitude=?,longitude=?,content_json=?,version=version+1,updated_at=? WHERE id=?')
          .run(place.coordinates.lat,place.coordinates.lng,JSON.stringify(after),now,place.id);
        db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)')
          .run('adventure-location-correction',place.id,row.content_json,JSON.stringify({entry:after,sources:place.sources,anchor:place.anchor}),now);
      }
      db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key,JSON.stringify({checkedAt:now,applied:apply,coordinates:place.coordinates,sources:place.sources}));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
