import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {migrateRideSlugs} from './ride-slugs.mjs';
import {importCuratedRides} from './curated-rides.mjs';
import {correctBeckwourthLoop} from './beckwourth-loop.mjs';
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
  migrateRideSlugs(db);
  importCuratedRides(db,root,saveTrack);
  correctBeckwourthLoop(db);
  return db;
}
export function rowEntry(row) {
  if(!row) return null;
  return {...JSON.parse(row.content_json),id:row.id,kind:row.kind,name:row.name,area:row.area,coordinates:{lat:row.latitude,lng:row.longitude},status:row.status,version:row.version,updatedAt:row.updated_at,hasTrack:!!row.has_track};
}
export function listEntries(db,admin=false) {
  return db.prepare(`SELECT e.*, EXISTS(SELECT 1 FROM tracks t WHERE t.entry_id=e.id) AS has_track FROM entries e ${admin?'':"WHERE e.status='published'"} ORDER BY area,name`).all().map(rowEntry);
}
const fields=['driveMinutes','bkxcVideoUrl','routeUrl','shuttleRouteUrl','startMapsUrl','finishMapsUrl','sameStartFinish','climbingFt','descendingFt','movingMinutes','movingTimeEstimated','intensity','season','seasonMonths','shuttleOption','ebikeRecommended','notes','incomplete','type','summary','viewer','shuttle','rideFamily','mustRide'];
export function validateHome(home) {
  const vector=a=>Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<100000);
  if(!home||!vector(home.position)||!vector(home.target)||!Number.isFinite(home.zoom)||home.zoom<.65||home.zoom>22)
    throw Object.assign(new Error('Invalid home view.'),{status:400});
  return {position:home.position,target:home.target,zoom:home.zoom};
}
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
  for(const f of ['driveMinutes','climbingFt','descendingFt','movingMinutes']) if(result[f]!=null && (!Number.isFinite(result[f])||result[f]<0||result[f]>100000)) fail(`Invalid ${f}.`);
  for(const f of ['bkxcVideoUrl','routeUrl','shuttleRouteUrl','startMapsUrl','finishMapsUrl']) if(result[f]) {
    try { if(!['https:','http:'].includes(new URL(result[f]).protocol)) throw 0; } catch { fail(`Use a full http or https URL for ${f}.`); }
  }
  for(const f of ['notes','summary','season','intensity','type']) if(result[f]!=null && (typeof result[f]!=='string'||result[f].length>10000)) fail(`Invalid ${f}.`);
  if(result.seasonMonths && (!Array.isArray(result.seasonMonths)||result.seasonMonths.some(n=>!Number.isInteger(n)||n<1||n>12))) fail('Season months must be 1–12.');
  for(const f of ['incomplete','ebikeRecommended','sameStartFinish','movingTimeEstimated','mustRide']) if(result[f]!=null && typeof result[f]!=='boolean') fail(`Invalid ${f}.`);
  if(result.shuttleOption!=null&&!['no','yes','partial'].includes(result.shuttleOption)) fail('Invalid shuttle option.');
  if(result.rideFamily!=null){
    const f=result.rideFamily;
    if(result.kind!=='ride'||typeof f!=='object'||Array.isArray(f)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.id||'')||f.id.length>100)fail('Use a lowercase ride family ID with hyphens.');
    for(const key of ['name','option'])if(typeof f[key]!=='string'||!f[key].trim()||f[key].length>200)fail('Add a family name and route option name.');
    if(f.order!=null&&(!Number.isInteger(f.order)||f.order<0||f.order>1000))fail('Route option order must be 0–1000.');
    result.rideFamily={id:f.id,name:f.name.trim(),option:f.option.trim(),order:f.order??0};
  }
  if(result.shuttle!=null){
    const s=result.shuttle;
    if(typeof s!=='object'||Array.isArray(s)||typeof s.enabled!=='boolean')fail('Invalid shuttle settings.');
    if(s.enabled){
      const {lat,lng}=s.coordinates||{};
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<bounds.south||lat>bounds.north||lng<bounds.west||lng>bounds.east)fail('Set shuttle start coordinates inside the Lost Sierra map.');
      try {const u=new URL(s.startMapsUrl);if(u.protocol!=='https:'||!['maps.app.goo.gl','maps.google.com','google.com','www.google.com','goo.gl'].includes(u.hostname))throw 0;}catch{fail('Add a Google Maps link for the shuttle start.');}
    }
    for(const key of ['climbingFt','movingMinutes'])if(s[key]!=null&&(!Number.isFinite(s[key])||s[key]<0||s[key]>100000))fail(`Invalid shuttle ${key}.`);
    if(s.movingTimeEstimated!=null&&typeof s.movingTimeEstimated!=='boolean')fail('Invalid shuttle moving time estimate.');
    result.shuttle={enabled:s.enabled,coordinates:s.coordinates,startMapsUrl:s.startMapsUrl||'',climbingFt:s.climbingFt??null,movingMinutes:s.movingMinutes??null,movingTimeEstimated:s.movingTimeEstimated!==false};
  }
  if(result.viewer!=null){
    const v=result.viewer;
    if(typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['home','pointsOfInterest','baseElevation','scale','angleBeats'].includes(k)))fail('Invalid ride viewer settings.');
    if(v.home){
      validateHome(v.home);
    }
    if(v.scale!=null&&(!Number.isFinite(v.scale)||v.scale<.1||v.scale>25))fail('Invalid viewer scale.');
    if(v.baseElevation!=null&&(!Number.isFinite(v.baseElevation)||v.baseElevation< -1000||v.baseElevation>9000))fail('Invalid terrain base.');
    if(v.angleBeats!=null){
      const beats=v.angleBeats;
      if(!Array.isArray(beats)||beats.length<2||beats.length>32||beats.some((b,i)=>!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)||b[0]<0||b[0]>1||Math.abs(b[1])>1440||(i>0&&b[0]<=beats[i-1][0]))||beats[0][0]!==0||beats.at(-1)[0]!==1)fail('Camera beats must progress from 0 to 1.');
    }
    if(v.pointsOfInterest!=null){
      if(!Array.isArray(v.pointsOfInterest)||v.pointsOfInterest.length>50)fail('Use up to 50 ride flags.');
      for(const point of v.pointsOfInterest){
        if(!point||typeof point.name!=='string'||!point.name.trim()||point.name.length>120||!/^#[0-9a-f]{6}$/i.test(point.color)||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||point.latitude<bounds.south||point.latitude>bounds.north||point.longitude<bounds.west||point.longitude>bounds.east)fail('Flags need a name, hex color, and location within the map.');
        if(point.elevationFt!=null&&(!Number.isFinite(point.elevationFt)||point.elevationFt<0||point.elevationFt>30000))fail('Invalid flag elevation.');
        if(point.url){try{if(!['https:','http:'].includes(new URL(point.url).protocol))throw 0;}catch{fail('Use a full http or https flag URL.');}}
      }
    }
  }
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
