import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {simplifyRideSignage} from './ride-signage.mjs';

test('signage cleanup preserves edited rides, flags, homes, and later CMS choices', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO users VALUES(1,?,?,?)').run('admin', 'test-only', 'now');
    const home = {position: [1,2,3], target: [0,0,0], zoom: 1};
    const pointsOfInterest = [{name: 'Peak', latitude: 39.7, longitude: -120.6}];
    for (const id of ['lower-lakes-basin-loop', 'hough-tollgate', 'south-park']) {
      const entry = {id, notes: 'Keep my notes', viewer: {home, pointsOfInterest}};
      db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,content_json,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, 'ride', id, 'Lakes Basin', 39.7, -120.6, JSON.stringify(entry), 'now');
    }
    db.prepare('INSERT INTO audit_log(user_id,action,entry_id,created_at) VALUES(1,?,?,?)').run('entry-update', 'south-park', 'now');
    const read = id => JSON.parse(db.prepare('SELECT content_json FROM entries WHERE id=?').get(id).content_json);
    const editedBefore = read('south-park');
    simplifyRideSignage(db);
    for (const id of ['lower-lakes-basin-loop', 'hough-tollgate']) {
      assert.deepEqual(read(id), {id, notes: 'Keep my notes', viewer: {home, pointsOfInterest, contextLabels: {mode: 'none', names: []}}});
    }
    assert.deepEqual(read('south-park'), editedBefore);
    const customized = {...read('lower-lakes-basin-loop'), viewer: {home, pointsOfInterest, contextLabels: {mode: 'only', names: ['Smith Creek']}}};
    db.prepare('UPDATE entries SET content_json=? WHERE id=?').run(JSON.stringify(customized), 'lower-lakes-basin-loop');
    simplifyRideSignage(db);
    assert.deepEqual(read('lower-lakes-basin-loop'), customized);
  } finally { db.close(); }
});
