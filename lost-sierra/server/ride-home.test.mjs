import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGuideServer} from './index.mjs';

test('home authoring is local-only without login and persists as the public ride default',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ride-home-test-'));
  const origin='http://127.0.0.1:19532';let app;
  const start=async localEditing=>{
    app=await createGuideServer({dataDir:dir,origin,localEditing});
    await new Promise(resolve=>app.server.listen(19532,'127.0.0.1',resolve));
  };
  t.after(async()=>{await app?.close();fs.rmSync(dir,{recursive:true,force:true});});
  const read=async route=>(await fetch(origin+'/api/'+route)).json();
  const save=(body,requestOrigin=origin)=>fetch(origin+'/api/ride-home/beckwourth-peak',{method:'PUT',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await start(false);
  assert.equal((await read('session')).canSetHome,false);
  assert.equal((await save({})).status,401);
  await app.close();await start(true);
  assert.equal((await read('session')).canSetHome,true);
  assert.equal((await fetch(origin+'/api/admin/entries')).status,401);
  const before=(await read('catalog')).entries.find(e=>e.id==='beckwourth-peak');
  const home={position:[-80,75,-140],target:[-5,0,-8],zoom:1.4};
  assert.equal((await save({version:before.version,home},'https://elsewhere.example')).status,403);
  assert.equal((await save({version:before.version,home:{...home,zoom:0}})).status,400);
  assert.equal((await save({version:before.version,home})).status,200);
  assert.equal((await save({version:before.version,home})).status,409);
  await app.close();await start(false);
  const after=(await read('catalog')).entries.find(e=>e.id==='beckwourth-peak');
  assert.deepEqual(after.viewer.home,home);
  assert.equal(after.version,before.version+1);
  assert.equal(after.notes,before.notes);
  assert.equal(after.status,before.status);
  assert.equal((await read('session')).canSetHome,false);
});
