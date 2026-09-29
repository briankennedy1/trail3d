// Editorial cleanup of the unedited rides as of 2026-09-29, plus Lakes Basin Blue.
// Keep this list fixed so a later restart cannot change newly edited rides.
const targets = [
  'lower-lakes-basin-loop', 'graeagle-smith-creek-loop', 'hough-taylor-creek',
  'hough-lower-loops', 'hough-tollgate', 'indian-falls-acorn-grotto',
  'jamison-creek-big-way', 'lakes-basin-intense-explore', 'lost-found-half-calf', 'south-park',
];

export function simplifyRideSignage(db) {
  const key = 'ride-signage-cleanup-2026-09-29';
  if (db.prepare('SELECT key FROM settings WHERE key=?').get(key)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const changed = [], now = new Date().toISOString();
    for (const id of targets) {
      const row = db.prepare("SELECT content_json FROM entries WHERE id=? AND kind='ride' AND status!='archived'").get(id);
      if (!row) continue;
      const before = JSON.parse(row.content_json);
      if (id !== 'lower-lakes-basin-loop' && (
        before.viewer?.contextLabels ||
        db.prepare('SELECT id FROM audit_log WHERE entry_id=? AND user_id IS NOT NULL LIMIT 1').get(id)
      )) continue;
      const contextLabels = id === 'lower-lakes-basin-loop'
        ? {mode: 'only', names: ['Frazier Falls Road']}
        : {mode: 'none', names: []};
      const after = {...before, viewer: {...before.viewer, contextLabels}};
      db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(after), now, id);
      db.prepare('INSERT INTO audit_log(action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?)')
        .run('ride-signage-cleanup', id, row.content_json, JSON.stringify(after), now);
      changed.push(id);
    }
    db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(key, JSON.stringify({appliedAt: now, entries: changed}));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
