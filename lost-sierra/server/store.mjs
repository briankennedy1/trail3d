import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '..');
const scope=JSON.parse(fs.readFileSync(path.join(root,'data/guide-scope.json'),'utf8'));
const bounds=scope.bbox;
export function openStore(dir) {
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const db = new DatabaseSync(path.join(dir,'guide.sqlite'), {timeout:5000});
  db.exec(fs.readFileSync(path.join(import.meta.dirname,'schema.sql'),'utf8'));
  if (!db.prepare('SELECT id FROM sources WHERE id=?').get('everstoke-planner')) {
    const source=JSON.parse(fs.readFileSync(path.join(root,'data/planner-source.json'),'utf8'));
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run('everstoke-planner',source.source,source.importedAt,source.sha256,JSON.stringify(source));
      const insert=db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,content_json,source_id,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for(const [file,kind] of [['rides','ride'],['adventures','adventure']]) {
        const rows=JSON.parse(fs.readFileSync(path.join(root,`data/planner-${file}.json`),'utf8'));
        for(const r of rows) insert.run(r.id,kind,r.name,r.area,r.coordinates.lat,r.coordinates.lng,JSON.stringify(r),'everstoke-planner',JSON.stringify(r),new Date().toISOString());
      }
      const trackFile=path.join(root,'data/beckwourth-track.geojson');
      if (fs.existsSync(trackFile)) {
        const feature=JSON.parse(fs.readFileSync(trackFile,'utf8'));
        saveTrack(db,'beckwourth-peak',feature,feature.properties.name,feature.properties.sourceUrl);
      }
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  const settings=JSON.parse(fs.readFileSync(path.join(root,'data/planner-settings.json'),'utf8'));
  for(const [key,value] of Object.entries(settings)) db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?,?)').run(key,JSON.stringify(value),'everstoke-planner');
  if(!db.prepare('SELECT key FROM settings WHERE key=?').get(scope.id)) {
    db.exec('BEGIN');
    try {
      for(const area of scope.excludedAreas) {
        db.prepare("UPDATE entries SET status='archived',version=version+1,updated_at=? WHERE area=? AND status!='archived'").run(new Date().toISOString(),area);
      }
      db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(JSON.stringify(settings.towns.filter(t=>!scope.excludedAreas.includes(t.name))),'towns');
      db.prepare('INSERT INTO settings VALUES(?,?,NULL)').run(scope.id,JSON.stringify(scope));
      db.prepare('INSERT INTO audit_log(action,after_json,created_at) VALUES(?,?,?)').run('guide-scope-update',JSON.stringify(scope),new Date().toISOString());
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
  }
  return db;
}
export function rowEntry(row) {
  if(!row) return null;
  return {...JSON.parse(row.content_json),id:row.id,kind:row.kind,name:row.name,area:row.area,coordinates:{lat:row.latitude,lng:row.longitude},status:row.status,version:row.version,updatedAt:row.updated_at,hasTrack:!!row.has_track};
}
export function listEntries(db,admin=false) {
  return db.prepare(`SELECT e.*, EXISTS(SELECT 1 FROM tracks t WHERE t.entry_id=e.id) AS has_track FROM entries e ${admin?'':"WHERE e.status='published'"} ORDER BY area,name`).all().map(rowEntry);
}
const fields=['driveMinutes','bkxcVideoUrl','routeUrl','shuttleRouteUrl','climbingFt','descendingFt','intensity','season','seasonMonths','shuttleOption','ebikeRecommended','notes','incomplete','type','summary'];
export function validateEntry(input) {
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if (!input || typeof input!=='object') fail('Entry is required.');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id||'') || input.id.length>100) fail('Use a short lowercase ID with hyphens.');
  if(!['ride','adventure'].includes(input.kind)) fail('Choose a ride or adventure.');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>200) fail('A name of 1–200 characters is required.');
  if(typeof input.area!=='string'||!input.area.trim()||input.area.length>100) fail('An area is required.');
  if(!['draft','published','archived'].includes(input.status)) fail('Choose draft, published, or archived.');
  const {lat,lng}=input.coordinates||{};
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||(input.status==='published'&&(lat<bounds.south||lat>bounds.north||lng<bounds.west||lng>bounds.east))||lat< -90||lat>90||lng< -180||lng>180) fail(`The location must be within this Lost Sierra map (${bounds.south}–${bounds.north}° N, ${-bounds.west}–${-bounds.east}° W).`);
  const result={id:input.id,kind:input.kind,name:input.name.trim(),area:input.area.trim(),status:input.status,coordinates:{lat,lng}};
  for(const f of fields) if(input[f]!==undefined) result[f]=input[f];
  for(const f of ['driveMinutes','climbingFt','descendingFt']) if(result[f]!=null && (!Number.isFinite(result[f])||result[f]<0||result[f]>100000)) fail(`Invalid ${f}.`);
  for(const f of ['bkxcVideoUrl','routeUrl','shuttleRouteUrl']) if(result[f]) {
    try { if(!['https:','http:'].includes(new URL(result[f]).protocol)) throw 0; } catch { fail(`Use a full http or https URL for ${f}.`); }
  }
  for(const f of ['notes','summary','season','intensity','type']) if(result[f]!=null && (typeof result[f]!=='string'||result[f].length>10000)) fail(`Invalid ${f}.`);
  if(result.seasonMonths && (!Array.isArray(result.seasonMonths)||result.seasonMonths.some(n=>!Number.isInteger(n)||n<1||n>12))) fail('Season months must be 1–12.');
  for(const f of ['incomplete','ebikeRecommended']) if(result[f]!=null && typeof result[f]!=='boolean') fail(`Invalid ${f}.`);
  if(result.shuttleOption!=null&&!['no','yes','partial'].includes(result.shuttleOption)) fail('Invalid shuttle option.');
  return result;
}
export function trackStats(feature) {
  const geometry=feature?.type==='Feature'?feature.geometry:feature;
  if(geometry?.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||geometry.coordinates.length>30000) throw Object.assign(new Error('Upload one continuous LineString with 2–30,000 points.'),{status:400});
  const coords=geometry.coordinates;
  for(const p of coords) if(!Array.isArray(p)||p.length<2||p.length>3||p.some(n=>!Number.isFinite(n))||p[0]<bounds.west||p[0]>bounds.east||p[1]<bounds.south||p[1]>bounds.north||(p.length===3&&(p[2]<-500||p[2]>9000))) throw Object.assign(new Error('Track has invalid coordinates or extends beyond the Lost Sierra map.'),{status:400});
  let distance=0,ascent=0,descent=0;
  const rad=Math.PI/180;
  for(let i=1;i<coords.length;i++) {
    const a=coords[i-1],b=coords[i],dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad;
    const h=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2;
    const step=6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    if(step>5000) throw Object.assign(new Error('Track has a gap longer than 5 km. Split or repair the track first.'),{status:400});
    distance+=step;
    if(a.length===3&&b.length===3) {const dz=b[2]-a[2];ascent+=Math.max(0,dz);descent+=Math.max(0,-dz);}
  }
  const elevated=coords.every(p=>p.length===3);
  return {feature:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}},distance,ascent:elevated?ascent:null,descent:elevated?descent:null};
}
export function saveTrack(db,id,feature,label,url) {
  const t=trackStats(feature);
  db.prepare(`INSERT INTO tracks VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET geojson=excluded.geojson,source_label=excluded.source_label,source_url=excluded.source_url,distance_m=excluded.distance_m,ascent_m=excluded.ascent_m,descent_m=excluded.descent_m,updated_at=excluded.updated_at`).run(id,JSON.stringify(t.feature),label,url||null,t.distance,t.ascent,t.descent,new Date().toISOString());
  return t;
}
