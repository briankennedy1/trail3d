import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuideServer } from './index.mjs';
import { validateEntry, trackStats } from './store.mjs';
const origin='http://127.0.0.1:19531';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lost-sierra-test-'));
let app,cookie='';
async function start(){app=await createGuideServer({dataDir:dir,origin});await new Promise(resolve=>app.server.listen(19531,'127.0.0.1',resolve));}
async function call(endpoint,method='GET',body,headers={}){const response=await fetch(origin+'/api/'+endpoint,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};}
test('persistent guide and authenticated publishing',async t=>{
 await start();t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
 const publicData=await call('catalog');assert.equal(publicData.body.entries.filter(e=>e.kind==='ride').length,19);assert.equal(publicData.body.entries.filter(e=>e.kind==='adventure').length,10);assert.equal(publicData.body.entries.filter(e=>e.hasTrack).length,3);assert.ok(publicData.body.entries.every(e=>!['Nevada City','Truckee','Susanville'].includes(e.area)));
 await t.test('public cannot edit or export',async()=>{assert.equal((await call('admin/entries')).status,401);assert.equal((await call('admin/entries/beckwourth-peak')).status,401);assert.equal((await call('admin/export')).status,401);assert.equal((await call('admin/entries/beckwourth-peak','PUT',{})).status,401);});
 await t.test('one-time setup requires secret and same origin',async()=>{assert.equal((await call('setup','POST',{username:'admin',password:'test-only-password',token:'wrong'})).status,403);assert.equal((await call('setup','POST',{username:'admin',password:'test-only-password',token:app.setupToken},{Origin:'https://other.example'})).status,403);const r=await call('setup','POST',{username:'admin',password:'test-only-password',token:app.setupToken});assert.equal(r.status,201);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);cookie=r.cookie.split(';')[0];assert.equal((await call('setup','POST',{})).status,409);assert.equal(fs.existsSync(path.join(dir,'setup-token')),false);});
 let ride=(await call('admin/entries')).body.entries.find(e=>e.id==='beckwourth-peak');
 await t.test('CMS exposes original source, track metadata and saved viewer settings',async()=>{
   let detail=await call('admin/entries/'+ride.id);
   assert.equal(detail.status,200);assert.equal(detail.body.original.id,ride.id);
   assert.equal(detail.body.source.id,'everstoke-planner');assert.ok(detail.body.track.pointCount>2);
   const viewer={home:{position:[-80,75,-140],target:[-5,0,-8],zoom:1.4},pointsOfInterest:[{name:'Park',latitude:39.80559,longitude:-120.46534,color:'#34877b',url:'https://example.com/park'}],angleBeats:[[0,-155],[1,170]],baseElevation:1350,scale:1};
   const saved=await call('admin/entries/'+ride.id,'PUT',{...ride,viewer});assert.equal(saved.status,200);ride=saved.body.entry;
   detail=await call('admin/entries/'+ride.id);assert.deepEqual(detail.body.entry.viewer,viewer);
   assert.equal(detail.body.history[0].action,'entry-update');assert.deepEqual(detail.body.history[0].after.viewer,viewer);
   assert.equal((await call('admin/entries/not-a-ride')).status,404);
 });
 await t.test('drafts and tracks stay private; conflicts preserve newer edits',async()=>{const updated=await call('admin/entries/'+ride.id,'PUT',{...ride,status:'draft',notes:'Test draft'});assert.equal(updated.status,200);assert.equal((await call('admin/entries/'+ride.id,'PUT',ride)).status,409);ride=updated.body.entry;const saved=cookie;cookie='';assert.ok(!(await call('catalog')).body.entries.some(e=>e.id===ride.id));assert.equal((await call('tracks/'+ride.id)).status,404);cookie=saved;assert.equal((await call('tracks/'+ride.id)).status,200);});
 await t.test('database survives restart without reseeding changes',async()=>{await app.close();await start();const entries=(await call('admin/entries')).body.entries;const saved=entries.find(e=>e.id===ride.id);assert.equal(saved.notes,'Test draft');assert.equal(saved.status,'draft');assert.equal((await call('session')).body.user.username,'admin');});
 await t.test('publish and track upload persist with provenance',async()=>{let r=await call('admin/entries/'+ride.id,'PUT',{...ride,status:'published'});ride=r.body.entry;assert.equal(r.status,200);r=await call('admin/entries/'+ride.id+'/track','PUT',{version:ride.version,feature:{type:'LineString',coordinates:[[-120.45,39.78,1500],[-120.449,39.781,1510]]},sourceLabel:'Test track',sourceUrl:'https://example.com/track'});assert.equal(r.status,200);assert.equal((await call('tracks/'+ride.id)).body.properties.sourceLabel,'Test track');assert.ok((await call('catalog')).body.entries.some(e=>e.id===ride.id));});
 await t.test('new entries, archive, and export omit credentials',async()=>{const r=await call('admin/entries/test-adventure','PUT',{id:'test-adventure',kind:'adventure',name:'Test','area':'Portola',coordinates:{lat:39.8,lng:-120.45},status:'draft'});assert.equal(r.status,201);assert.equal((await call('admin/entries/test-adventure','PUT',{...r.body.entry,status:'archived'})).status,200);const exported=await call('admin/export');assert.equal(exported.status,200);assert.equal(exported.body.entries.length,33);assert.ok(!JSON.stringify(exported.body).includes('password_hash'));});
 await t.test('cross-origin writes rejected even with a session',async()=>{assert.equal((await call('admin/entries/'+ride.id,'PUT',ride,{Origin:'https://other.example'})).status,403);});
 await t.test('logout revokes the session and login requires the password',async()=>{assert.equal((await call('logout','POST',{})).status,200);assert.equal((await call('admin/entries')).status,401);assert.equal((await call('login','POST',{username:'admin',password:'wrong'})).status,401);const r=await call('login','POST',{username:'admin',password:'test-only-password'});assert.equal(r.status,200);cookie=r.cookie.split(';')[0];assert.equal((await call('admin/entries')).status,200);});
});
test('data validation rejects unsafe URLs and malformed or out-of-region tracks',()=>{
 const entry={id:'test',kind:'ride',name:'Test',area:'Portola',status:'draft',coordinates:{lat:39.8,lng:-120.45}};
 assert.throws(()=>validateEntry({...entry,routeUrl:'javascript:alert(1)'}));
 assert.throws(()=>validateEntry({...entry,coordinates:{lat:null,lng:-120.45}}));
 assert.throws(()=>trackStats({type:'LineString',coordinates:[[-120,38],[-120,39]]}));
 assert.throws(()=>trackStats({type:'LineString',coordinates:[[-120.4,39.8],[-120.5,40.1]]}));
 assert.throws(()=>trackStats({type:'LineString',coordinates:[[-120.4,39.8,NaN],[-120.401,39.801]]}));
 const stats=trackStats({type:'LineString',coordinates:[[-120.45,39.8],[-120.449,39.801]]});assert.ok(stats.distance>100);assert.equal(stats.ascent,null);
});
