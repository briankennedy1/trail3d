import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openStore,saveTrack,listEntries} from './store.mjs';
import {importCuratedRides} from './curated-rides.mjs';

const root=path.resolve(import.meta.dirname,'..');
const stageScript=path.join(root,'scripts/stage-ride-gpx.py');
const surfaceScript=path.join(root,'scripts/build-route-surfaces.mjs');
const auditScript=path.join(root,'scripts/audit-ride-content.mjs');
const run=(bin,args)=>spawnSync(bin,args,{encoding:'utf8'});
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ride-import-'));
const put=(root,file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value)+'\n');};

test('GPX staging strips all-zero placeholders, records source, and refuses overwrite',()=>{
  const temp=fixture();
  try{
    const input=path.join(temp,'ride.gpx'),out=path.join(temp,'staged');
    fs.writeFileSync(input,'<gpx><trk><trkseg><trkpt lat="39.7" lon="-120.7"><ele>0</ele></trkpt><trkpt lat="39.701" lon="-120.701"><ele>0</ele></trkpt></trkseg></trk></gpx>');
    const catalogBefore=fs.readFileSync(path.join(root,'data/curated-rides.json'));
    const args=['--input',input,'--id','new-test-ride','--name','Test Ride','--area','Lakes Basin','--source-url','https://example.org/ride','--source-label','Original export','--output-dir',out];
    const result=run('python3',[stageScript,...args]);assert.equal(result.status,0,result.stderr);
    const feature=JSON.parse(fs.readFileSync(path.join(out,'new-test-ride.geojson')));
    const draft=JSON.parse(fs.readFileSync(path.join(out,'curated-entry.json')));
    assert.deepEqual(feature.geometry.coordinates,[[-120.7,39.7],[-120.701,39.701]]);
    assert.equal(feature.properties.gpxSha256,createHash('sha256').update(fs.readFileSync(input)).digest('hex'));
    assert.equal(draft.details.incomplete,true);assert.equal(draft.entry.status,'draft');
    assert.equal(draft.details.intensity,undefined);
    assert.equal(run('python3',[stageScript,...args]).status,1);
    const collisionArgs=[...args];collisionArgs[collisionArgs.indexOf('--id')+1]='cal-ida-trail';collisionArgs[collisionArgs.indexOf('--output-dir')+1]=path.join(temp,'collision');
    const plannerCollision=run('python3',[stageScript,...collisionArgs]);
    assert.equal(plannerCollision.status,1);assert.match(plannerCollision.stderr,/already exists/);
    assert.deepEqual(fs.readFileSync(path.join(root,'data/curated-rides.json')),catalogBefore);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('GPX staging rejects mixed elevation and never creates output',()=>{
  const temp=fixture();
  try{
    const input=path.join(temp,'ride.gpx'),out=path.join(temp,'staged');
    fs.writeFileSync(input,'<gpx><rte><rtept lat="39.7" lon="-120.7"><ele>0</ele></rtept><rtept lat="39.701" lon="-120.701"><ele>1550</ele></rtept></rte></gpx>');
    const result=run('python3',[stageScript,'--input',input,'--id','new-test-ride','--name','Test Ride','--area','Lakes Basin','--source-url','https://example.org/ride','--source-label','Original export','--output-dir',out]);
    assert.equal(result.status,1);assert.match(result.stderr,/Mixed missing, zero/);assert.equal(fs.existsSync(out),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('recorded GPX elevations are preserved exactly through staging and distance calculation',()=>{
  const temp=fixture();
  try{
    const input=path.join(temp,'recorded.gpx'),out=path.join(temp,'staged');
    fs.writeFileSync(input,'<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Recorded ride</name><trkseg><trkpt lat="39.7" lon="-120.7"><ele>1499.125</ele><time>2026-09-28T12:00:00Z</time></trkpt><trkpt lat="39.701" lon="-120.701"><ele>1501.875</ele><extensions><device>test</device></extensions></trkpt></trkseg></trk></gpx>');
    const result=run('python3',[stageScript,'--input',input,'--id','recorded-test-ride','--name','Recorded Test Ride','--area','Lakes Basin','--source-url','https://example.org/ride','--source-label','Recorded export','--output-dir',out]);
    assert.equal(result.status,0,result.stderr);
    const feature=JSON.parse(fs.readFileSync(path.join(out,'recorded-test-ride.geojson')));
    const review=JSON.parse(fs.readFileSync(path.join(out,'review.json')));
    assert.deepEqual(feature.geometry.coordinates,[[-120.7,39.7,1499.125],[-120.701,39.701,1501.875]]);
    assert.equal(feature.properties.elevationSource,'GPX recording');
    assert.equal(review.elevation,'recorded');assert(review.stats.distanceMiles>0);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('GPX route without elevation stages XY points for later terrain sampling',()=>{
  const temp=fixture();
  try{
    const input=path.join(temp,'planned.gpx'),out=path.join(temp,'staged');
    fs.writeFileSync(input,'<gpx><rte><rtept lat="39.7" lon="-120.7"/><rtept lat="39.701" lon="-120.701"/></rte></gpx>');
    const result=run('python3',[stageScript,'--input',input,'--id','planned-test-ride','--name','Planned Test Ride','--area','Lakes Basin','--source-url','https://example.org/ride','--source-label','Route plan export','--output-dir',out]);
    assert.equal(result.status,0,result.stderr);
    const feature=JSON.parse(fs.readFileSync(path.join(out,'planned-test-ride.geojson')));
    const review=JSON.parse(fs.readFileSync(path.join(out,'review.json')));
    assert.deepEqual(feature.geometry.coordinates,[[-120.7,39.7],[-120.701,39.701]]);
    assert.equal(review.elevation,'missing');assert.match(feature.properties.elevationSource,/Pending AWS/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('GPX staging enforces the CMS point limit and 5 km gap guard',()=>{
  const temp=fixture();
  try{
    const input=path.join(temp,'ride.gpx'),out=path.join(temp,'staged');
    const args=['--input',input,'--id','new-test-ride','--name','Test Ride','--area','Lakes Basin','--source-url','https://example.org/ride','--source-label','Original export','--output-dir',out];
    fs.writeFileSync(input,'<gpx><rte><rtept lat="39.7" lon="-120.7"/><rtept lat="39.8" lon="-120.8"/></rte></gpx>');
    let result=run('python3',[stageScript,...args]);assert.equal(result.status,1);assert.match(result.stderr,/gap longer than 5 km/);
    assert.equal(fs.existsSync(out),false);
    fs.writeFileSync(input,'<gpx><rte>'+Array.from({length:30001},()=>'<rtept lat="39.7" lon="-120.7"/>').join('')+'</rte></gpx>');
    result=run('python3',[stageScript,...args]);assert.equal(result.status,1);assert.match(result.stderr,/30,000 points/);
    assert.equal(fs.existsSync(out),false);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('explicit draft seed stays hidden from public list; older seeds remain published',()=>{
  const temp=fixture(),dbdir=path.join(temp,'db'),seed=path.join(temp,'seed');
  const db=openStore(dbdir);
  try{
    const id='new-draft-test-ride';
    put(seed,'data/curated-rides.json',[{id,entry:{name:'Draft Ride',kind:'ride',area:'Lakes Basin',status:'draft'},track:`routes/${id}.geojson`,details:{coordinates:{lat:39.7,lng:-120.7},incomplete:true,viewer:{pointsOfInterest:[]}}}]);
    put(seed,`data/routes/${id}.geojson`,{type:'Feature',properties:{sourceLabel:'Test source',sourceUrl:'https://example.org/ride'},geometry:{type:'LineString',coordinates:[[-120.7,39.7,1500],[-120.701,39.701,1501]]}});
    importCuratedRides(db,seed,saveTrack);
    assert.equal(db.prepare('SELECT status FROM entries WHERE id=?').get(id).status,'draft');
    assert.equal(listEntries(db).some(entry=>entry.id===id),false);
    assert.equal(listEntries(db,true).find(entry=>entry.id===id).status,'draft');
    assert.equal(db.prepare('SELECT status FROM entries WHERE id=?').get('jamison-creek-big-way').status,'published');
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('single-ride surface update preserves every other ride and never replaces catalog on failure',()=>{
  const temp=fixture();
  try{
    const coords=[[-120.7,39.7,1500],[-120.701,39.701,1501]];
    put(temp,'data/curated-rides.json',[{id:'target',track:'routes/target.geojson',details:{}},{id:'other',track:'routes/other.geojson',details:{}}]);
    put(temp,'data/route-surface-overrides.json',{});
    put(temp,'data/routes/target.geojson',{geometry:{type:'LineString',coordinates:coords}});
    const original={source:'old',retrievedAt:'prior',rides:{other:{sentinel:'keep'}},ways:{123:{name:'old way'}}};
    put(temp,'public/terrain/route-surfaces.json',original);
    const ways=path.join(temp,'ways.json');fs.writeFileSync(ways,JSON.stringify({elements:[{id:456,tags:{highway:'path'},geometry:[{lon:-120.7,lat:39.7},{lon:-120.701,lat:39.701}]}]}));
    const result=run(process.execPath,[surfaceScript,ways,'--ride','target','--root',temp]);assert.equal(result.status,0,result.stderr);
    const after=JSON.parse(fs.readFileSync(path.join(temp,'public/terrain/route-surfaces.json')));
    assert.deepEqual(after.rides.other,original.rides.other);assert.deepEqual(after.ways[123],original.ways[123]);
    assert.equal(after.rides.target.pointCount,2);
    const bytes=fs.readFileSync(path.join(temp,'public/terrain/route-surfaces.json'));
    const failed=run(process.execPath,[surfaceScript,ways,'--ride','missing','--root',temp]);assert.notEqual(failed.status,0);
    assert.deepEqual(fs.readFileSync(path.join(temp,'public/terrain/route-surfaces.json')),bytes);
    const implicitAll=run(process.execPath,[surfaceScript,ways,'--root',temp]);assert.notEqual(implicitAll.status,0);
    assert.deepEqual(fs.readFileSync(path.join(temp,'public/terrain/route-surfaces.json')),bytes);
    fs.writeFileSync(ways,JSON.stringify({elements:[]}));
    const wrongRegion=run(process.execPath,[surfaceScript,ways,'--ride','target','--root',temp]);assert.notEqual(wrongRegion.status,0);
    assert.deepEqual(fs.readFileSync(path.join(temp,'public/terrain/route-surfaces.json')),bytes);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('content audit catches stale surface hash and unresolved editorial fields',()=>{
  const temp=fixture();
  try{
    put(temp,'data/curated-rides.json',[{id:'target',entry:{name:'Test'},track:'routes/target.geojson',details:{}}]);
    put(temp,'data/routes/target.geojson',{properties:{sourceUrl:'https://example.org',gpxSha256:'abc'},geometry:{type:'LineString',coordinates:[[-120.7,39.7,1500],[-120.701,39.701,1501]]}});
    put(temp,'public/terrain/route-surfaces.json',{rides:{target:{coordinatesSha256:'stale'}},ways:{}});
    const report=run(process.execPath,[auditScript,'--root',temp,'--json','--fail-on-errors']);
    assert.equal(report.status,1);const parsed=JSON.parse(report.stdout);
    assert(parsed.findings.some(f=>f.code==='surface-sha-mismatch'));
    assert(parsed.findings.some(f=>f.code==='missing-terrain'));
    assert(parsed.findings.some(f=>f.code==='unrated-intensity'));
    assert(parsed.findings.some(f=>f.code==='missing-start-parking'));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('seed audit detects terrain bounds and incomplete surface ranges',()=>{
  const temp=fixture();
  try{
    const coords=[[-120.7,39.7,1500],[-120.701,39.701,1501],[-120.702,39.702,1502]];
    put(temp,'data/curated-rides.json',[{id:'target',entry:{name:'Test'},terrain:'/terrain/target',track:'routes/target.geojson',details:{notes:'Reviewed',summary:'Reviewed',intensity:'Moderate',startMapsUrl:'https://maps.google.com',sameStartFinish:true}}]);
    put(temp,'data/routes/target.geojson',{properties:{sourceUrl:'https://example.org',gpxSha256:'abc'},geometry:{type:'LineString',coordinates:coords}});
    put(temp,'public/terrain/route-surfaces.json',{rides:{target:{coordinatesSha256:createHash('sha256').update(JSON.stringify(coords)).digest('hex'),pointCount:3,ranges:[{from:0,to:1,type:'dirt'}]}},ways:{}});
    put(temp,'public/terrain/target/terrain.json',{bbox:{west:-120.701,east:-120.699,south:39.699,north:39.701},width:2,height:2});
    fs.writeFileSync(path.join(temp,'public/terrain/target/terrain.bin'),Buffer.alloc(8));
    const report=run(process.execPath,[auditScript,'--root',temp,'--json','--fail-on-errors']);
    assert.equal(report.status,1);const parsed=JSON.parse(report.stdout);
    assert.match(parsed.scope,/seed-only/);
    assert(parsed.findings.some(f=>f.code==='terrain-bounds'));
    assert(parsed.findings.some(f=>f.code==='surface-range-coverage'));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('seed audit uses planner fields and skips editorial warnings for archived rides',()=>{
  const temp=fixture();
  try{
    const coords=[[-120.7,39.7,1500],[-120.701,39.701,1501]];
    put(temp,'data/planner-rides.json',[{id:'active',area:'Lakes Basin',intensity:'Moderate',notes:'Planner notes',summary:'Planner summary',startMapsUrl:'https://maps.google.com',sameStartFinish:true},{id:'archived',area:'Lakes Basin'}]);
    put(temp,'data/guide-scope.json',{excludedEntries:['archived'],excludedAreas:[]});
    put(temp,'data/curated-rides.json',[
      {id:'active',track:'routes/active.geojson',details:{}},
      {id:'archived',track:'routes/archived.geojson',details:{}},
    ]);
    for(const id of ['active','archived'])put(temp,`data/routes/${id}.geojson`,{properties:{sourceUrl:'https://example.org',gpxSha256:'abc'},geometry:{type:'LineString',coordinates:coords}});
    const result=run(process.execPath,[auditScript,'--root',temp,'--json']);assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.findings.some(f=>f.code==='unrated-intensity'),false);
    assert.equal(report.findings.some(f=>f.id==='archived'&&['missing-notes','missing-start-parking','unknown-finish'].includes(f.code)),false);
    assert(report.findings.some(f=>f.id==='archived'&&f.code==='missing-terrain'));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
