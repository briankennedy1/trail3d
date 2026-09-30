import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {importAdventureLocations} from './adventure-locations.mjs';

test('location corrections retain notes and user-chosen coordinates and never replay',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'adventure-locations-'));
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    fs.mkdirSync(path.join(dir,'data'));
    fs.writeFileSync(path.join(dir,'data/adventure-locations.json'),JSON.stringify(['placeholder','customized'].map(id=>({id,coordinates:{lat:39.8,lng:-120.6},sources:['https://example.org/place'],anchor:'Destination'}))));
    const original={coordinates:{lat:39.7,lng:-120.7}};
    for(const id of ['placeholder','customized']){
      const coordinates=id==='placeholder'?original.coordinates:{lat:39.9,lng:-120.5};
      const entry={id,name:'My name',notes:'My notes',coordinates};
      db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,status,content_json,original_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id,'adventure',entry.name,'Lakes Basin',coordinates.lat,coordinates.lng,'draft',JSON.stringify(entry),JSON.stringify(original),'before');
    }
    const read=id=>db.prepare('SELECT * FROM entries WHERE id=?').get(id);
    const customBefore=read('customized');
    importAdventureLocations(db,dir);
    const corrected=read('placeholder');
    assert.deepEqual(JSON.parse(corrected.content_json),{id:'placeholder',name:'My name',notes:'My notes',coordinates:{lat:39.8,lng:-120.6}});
    assert.equal(corrected.status,'draft');assert.equal(corrected.latitude,39.8);assert.equal(corrected.longitude,-120.6);
    assert.deepEqual(read('customized'),customBefore);
    assert.equal(db.prepare('SELECT count(*) AS n FROM audit_log').get().n,1);
    importAdventureLocations(db,dir);
    assert.deepEqual(read('placeholder'),corrected);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('off-bike places have distinct sourced locations and pending access stays explicit',()=>{
  const places=JSON.parse(fs.readFileSync(new URL('../data/adventure-locations.json',import.meta.url),'utf8'));
  const imported=JSON.parse(fs.readFileSync(new URL('../data/planner-adventures.json',import.meta.url),'utf8'));
  const {bbox}=JSON.parse(fs.readFileSync(new URL('../data/guide-scope.json',import.meta.url),'utf8'));
  assert.deepEqual(places.map(p=>p.id).sort(),imported.map(p=>p.id).sort());
  assert.equal(new Set(places.map(p=>JSON.stringify(p.coordinates))).size,places.length);
  for(const p of places){
    assert.ok(p.sources.length>0);assert.ok(p.sources.every(url=>new URL(url).protocol==='https:'));
    assert.ok(p.coordinates.lat>=bbox.south&&p.coordinates.lat<=bbox.north);
    assert.ok(p.coordinates.lng>=bbox.west&&p.coordinates.lng<=bbox.east);
  }
  assert.equal(places.find(p=>p.id==='cuccias-river-access').verified,false);
  assert.equal(places.find(p=>p.id==='johnsville-swimming-hole').accessPoint,true);
});

test('lake destination pins land inside mapped water, with closed shorelines and island holes',()=>{
  const waters=JSON.parse(fs.readFileSync(new URL('../public/terrain/adventure-water.json',import.meta.url),'utf8'));
  const places=JSON.parse(fs.readFileSync(new URL('../data/adventure-locations.json',import.meta.url),'utf8'));
  const contains=({lng:x,lat:y},ring)=>{
    let inside=false;
    for(let i=1;i<ring.length;i++){
      const [ax,ay]=ring[i-1],[bx,by]=ring[i];
      if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
    }
    return inside;
  };
  for(const water of waters)for(const ring of water.rings){assert.ok(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));}
  for(const [id,name] of [['smith-lake','Smith Lake'],['salmon-lake','Upper Salmon Lake'],['lower-sardine-sand-lake','Lower Sardine Lake']]){
    const point=places.find(p=>p.id===id).coordinates,water=waters.find(w=>w.name===name);
    assert.ok(contains(point,water.rings[0]),`${id} is outside its lake`);
    assert.ok(!water.rings.slice(1).some(ring=>contains(point,ring)),`${id} sits on an island`);
  }
  assert.equal(waters.find(w=>w.name==='Upper Salmon Lake').rings.length,3);
});
