import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openStore, listEntries, validateEntry, validateHome, saveTrack, root, assertEntrySlugAvailable, reserveEntrySlug, publicSlugAliases } from './store.mjs';
const derive=promisify(scrypt), sha=s=>createHash('sha256').update(s).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
async function passwordHash(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password,salt,64)).toString('hex')}`;
}
async function passwordMatches(password,hash) {
  const [salt,digest]=hash.split(':');
  const actual=await derive(password,salt,64);
  return timingSafeEqual(actual,Buffer.from(digest,'hex'));
}
function checkPassword(password) {
  if(typeof password!=='string'||password.length<12||password.length>256) throw error(400,'Choose a password with 12–256 characters.');
}
async function readBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw error(415,'Send JSON.');
  let size=0,chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>4_000_000) throw error(413,'Upload is too large (4 MB maximum).');chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString());} catch {throw error(400,'Invalid JSON.');}
}
export async function createGuideServer({dataDir=process.env.DATA_DIR||path.join(root,'.data'),origin=process.env.APP_ORIGIN||'http://127.0.0.1:5318',development=false}={}) {
  const db=openStore(dataDir),originUrl=new URL(origin),secure=originUrl.protocol==='https:';
  const tokenFile=path.join(dataDir,'setup-token');
  if(!db.prepare('SELECT id FROM users LIMIT 1').get()&&!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile,randomBytes(32).toString('hex'),{mode:0o600});
  const setupToken=fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():null;
  const vite=development?await (await import('vite')).createServer({configFile:path.join(root,'vite.config.js'),server:{middlewareMode:true, hmr:false, ws:false, fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.data/**','**/backups/**',path.resolve(dataDir)+'/**']}},appType:'spa'}):null;
  const attempts=new Map();
  const dummyHash=await passwordHash(randomBytes(24).toString('hex'));
  function limited(req) {
    const key=req.socket.remoteAddress, now=Date.now();
    for(const [k,v] of attempts) if(v.until<now) attempts.delete(k);
    const entry=attempts.get(key)||{count:0,until:now+15*60*1000};
    if(++entry.count>10) throw error(429,'Too many attempts. Try again in 15 minutes.');
    attempts.set(key,entry);
  }
  function currentUser(req) {
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sierra_session='))?.slice(15);
    if(!token||!/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare('SELECT u.id,u.username,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(sha(token),Date.now());
  }
  function session(res,userId) {
    const token=randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha(token),userId,Date.now()+12*60*60*1000);
    res.setHeader('Set-Cookie',`sierra_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`);
  }
  function audit(user,action,id,before,after) {db.prepare('INSERT INTO audit_log(user_id,action,entry_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)').run(user?.id??null,action,id||null,before?JSON.stringify(before):null,after?JSON.stringify(after):null,new Date().toISOString());}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(!development)res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; object-src 'none'; base-uri 'self'");
    const json=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
    try {
      // Reject arbitrary Host headers, including DNS rebinding against a local admin.
      const localAlias=!secure&&['127.0.0.1','localhost','[::1]'].includes(originUrl.hostname);
      const allowedHosts=new Set([originUrl.host,...(localAlias?[`localhost:${originUrl.port}`,`127.0.0.1:${originUrl.port}`]:[])]);
      if(!allowedHosts.has(req.headers.host)) throw error(403,'Unrecognized host.');
      const url=new URL(req.url,origin),p=url.pathname,method=req.method;
      if(p.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(method)) {
          const allowedOrigins=new Set([...allowedHosts].map(h=>`${originUrl.protocol}//${h}`));
          if(!allowedOrigins.has(req.headers.origin)) throw error(403,'Request must come from this site.');
        }
        const user=currentUser(req);
        const canSetHome=!!user;
        if(p==='/api/session'&&method==='GET') return json(200,{user:user?{username:user.username}:null,needsSetup:!db.prepare('SELECT id FROM users LIMIT 1').get(),canSetHome});
        if(p==='/api/overview-home'&&method==='PUT'){
          if(!canSetHome)throw error(401,'Sign in as an admin to set the map home view.');
          const body=await readBody(req);
          const row=db.prepare('SELECT value_json FROM settings WHERE key=?').get('overviewHome');
          const before=row?JSON.parse(row.value_json):{version:0};
          if(body.version!==before.version)throw error(409,'The home view changed. Reload before saving.');
          const next={version:before.version+1,home:validateHome(body.home)};
          db.exec('BEGIN');try{
            db.prepare('INSERT INTO settings VALUES(?,?,NULL) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run('overviewHome',JSON.stringify(next));
            audit(user,'overview-home-update',null,before,next);db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
          return json(200,next);
        }
        if(p==='/api/region-home'&&method==='PUT'){
          if(!canSetHome)throw error(401,'Sign in as an admin to set a region home view.');
          const body=await readBody(req),area=body.area;
          if(typeof area!=='string'||!listEntries(db).some(entry=>entry.area===area))throw error(404,'Region not found.');
          const row=db.prepare('SELECT value_json FROM settings WHERE key=?').get('regionHomes');
          const homes=row?JSON.parse(row.value_json):{};
          const before=Object.hasOwn(homes,area)?homes[area]:{version:0};
          if(body.version!==before.version)throw error(409,'This region home view changed. Reload before saving.');
          const next={version:before.version+1,home:validateHome(body.home)};
          db.exec('BEGIN');try{
            db.prepare('INSERT INTO settings VALUES(?,?,NULL) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run('regionHomes',JSON.stringify({...homes,[area]:next}));
            audit(user,'region-home-update',null,{area,...before},{area,...next});db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
          return json(200,{area,...next});
        }
        const homeRoute=p.match(/^\/api\/ride-home\/([a-z0-9-]+)$/);
        if(homeRoute&&method==='PUT'){
          if(!canSetHome)throw error(401,'Sign in as an admin to set the ride home view.');
          const body=await readBody(req),id=homeRoute[1];
          const before=listEntries(db,true).find(e=>e.id===id);
          if(!before||before.kind!=='ride'||!before.hasTrack)throw error(404,'Ride not found.');
          if(body.version!==before.version)throw error(409,'This ride changed. Reload before setting its home view.');
          if(!body.home||typeof body.home!=='object')throw error(400,'A home view is required.');
          const entry=validateEntry({...before,viewer:{...before.viewer,home:body.home}});
          db.exec('BEGIN');try{
            db.prepare('UPDATE entries SET content_json=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(entry),new Date().toISOString(),id);
            audit(user,'ride-home-update',id,before.viewer?.home,entry.viewer.home);db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
          return json(200,{entry:listEntries(db,true).find(e=>e.id===id)});
        }
        if(p==='/api/setup'&&method==='POST') {
          limited(req);const body=await readBody(req);
          if(db.prepare('SELECT id FROM users LIMIT 1').get()) throw error(409,'Admin is already set up.');
          if(!setupToken||typeof body.token!=='string'||sha(body.token)!==sha(setupToken)) throw error(403,'Open the one-time setup link from the server terminal.');
          if(!/^[a-zA-Z0-9_-]{3,40}$/.test(body.username||'')) throw error(400,'Username must have 3–40 letters, numbers, underscores, or hyphens.');
          checkPassword(body.password);const hash=await passwordHash(body.password);
          // Recheck after password hashing so two simultaneous setup requests cannot create two admins.
          if(db.prepare('SELECT id FROM users LIMIT 1').get()) throw error(409,'Admin is already set up.');
          const result=db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(body.username,hash,new Date().toISOString());
          fs.rmSync(tokenFile,{force:true});session(res,Number(result.lastInsertRowid));return json(201,{ok:true});
        }
        if(p==='/api/login'&&method==='POST') {
          limited(req);const body=await readBody(req);
          if(typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>256) throw error(400,'Enter your username and password.');
          const account=db.prepare('SELECT * FROM users WHERE username=?').get(body.username);
          const match=await passwordMatches(body.password,account?.password_hash||dummyHash);
          if(!account||!match) throw error(401,'Username or password is incorrect.');
          attempts.delete(req.socket.remoteAddress);session(res,account.id);return json(200,{ok:true});
        }
        if(p==='/api/logout'&&method==='POST') {
          if(user) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
          res.setHeader('Set-Cookie',`sierra_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`);return json(200,{ok:true});
        }
        if(p==='/api/catalog'&&method==='GET') return json(200,{entries:listEntries(db),slugAliases:publicSlugAliases(db),settings:Object.fromEntries(db.prepare('SELECT key,value_json FROM settings').all().map(r=>[r.key,JSON.parse(r.value_json)])),sources:db.prepare('SELECT id,url,imported_at FROM sources').all()});
        const publicTrack=p.match(/^\/api\/tracks\/([a-z0-9-]+)$/);
        if(publicTrack&&method==='GET') {
          const row=db.prepare(`SELECT t.* FROM tracks t JOIN entries e ON e.id=t.entry_id WHERE e.id=? ${user?'':"AND e.status='published'"}`).get(publicTrack[1]);
          if(!row) throw error(404,'Track is not available.');
          return json(200,{...JSON.parse(row.geojson),properties:{sourceLabel:row.source_label,sourceUrl:row.source_url,distanceM:row.distance_m,ascentM:row.ascent_m,descentM:row.descent_m}});
        }
        if(p.startsWith('/api/admin/')) {
          if(!user) throw error(401,'Sign in to manage the guide.');
          if(p==='/api/admin/entries'&&method==='GET') return json(200,{entries:listEntries(db,true)});
          const detailId=p.match(/^\/api\/admin\/entries\/([a-z0-9-]+)$/)?.[1];
          if(detailId&&method==='GET') {
            const row=db.prepare('SELECT * FROM entries WHERE id=?').get(detailId);
            if(!row)throw error(404,'Entry not found.');
            const track=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(detailId);
            return json(200,{
              entry:listEntries(db,true).find(e=>e.id===detailId),
              original:row.original_json?JSON.parse(row.original_json):null,
              source:row.source_id?db.prepare('SELECT id,url,imported_at,sha256 FROM sources WHERE id=?').get(row.source_id):null,
              track:track?{sourceLabel:track.source_label,sourceUrl:track.source_url,distanceM:track.distance_m,ascentM:track.ascent_m,descentM:track.descent_m,updatedAt:track.updated_at,pointCount:JSON.parse(track.geojson).geometry.coordinates.length}:null,
              history:db.prepare('SELECT id,action,created_at,before_json,after_json FROM audit_log WHERE entry_id=? ORDER BY id DESC LIMIT 50').all(detailId).map(r=>({id:r.id,action:r.action,createdAt:r.created_at,before:r.before_json?JSON.parse(r.before_json):null,after:r.after_json?JSON.parse(r.after_json):null})),
            });
          }
          if(p==='/api/admin/export'&&method==='GET') {
            res.setHeader('Content-Disposition','attachment; filename="lost-sierra-content.json"');
            return json(200,{schemaVersion:1,exportedAt:new Date().toISOString(),entries:listEntries(db,true),settings:Object.fromEntries(db.prepare('SELECT key,value_json FROM settings').all().map(r=>[r.key,JSON.parse(r.value_json)])),tracks:db.prepare('SELECT * FROM tracks').all().map(t=>({...t,geojson:JSON.parse(t.geojson)})),sources:db.prepare('SELECT * FROM sources').all()});
          }
          if(p==='/api/admin/password'&&method==='POST') {
            limited(req);const body=await readBody(req);checkPassword(body.password);
            const row=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
            if(typeof body.currentPassword!=='string'||body.currentPassword.length>256||!await passwordMatches(body.currentPassword,row.password_hash)) throw error(401,'Current password is incorrect.');
            const hash=await passwordHash(body.password);db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);session(res,user.id);audit(user,'password-change',null,null,null);return json(200,{ok:true});
          }
          const match=p.match(/^\/api\/admin\/entries\/([a-z0-9-]+)(\/track)?$/);
          if(match&&method==='PUT') {
            const id=match[1],body=await readBody(req),before=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
            if(match[2]) {
              if(!before) throw error(404,'Save the ride before adding its track.');
              if(before.kind!=='ride') throw error(400,'Tracks belong to rides.');
              if(body.version!==before.version) throw error(409,'This ride changed. Reload it before uploading the track.');
              if(typeof body.sourceLabel!=='string'||!body.sourceLabel.trim()||body.sourceLabel.length>300) throw error(400,'Give the track a source label.');
              if(body.sourceUrl) {try{if(!['http:','https:'].includes(new URL(body.sourceUrl).protocol)) throw 0;}catch{throw error(400,'Use a valid track source URL.');}}
              db.exec('BEGIN');try {
                const oldTrack=db.prepare('SELECT * FROM tracks WHERE entry_id=?').get(id);
                saveTrack(db,id,body.feature,body.sourceLabel,body.sourceUrl);
                db.prepare('UPDATE entries SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
                audit(user,'track-update',id,oldTrack,{sourceLabel:body.sourceLabel,feature:body.feature});db.exec('COMMIT');
              }catch(e){db.exec('ROLLBACK');throw e;}
              return json(200,{ok:true});
            }
            if(id!==body.id) throw error(400,'The ID cannot change.');
            const entry=validateEntry(body);
            if(before&&body.version!==before.version) throw error(409,'Someone saved a newer version. Reload before saving.');
            if(!before&&body.version) throw error(409,'This entry no longer exists.');
            if(before&&before.kind!==entry.kind) throw error(400,'Entry type cannot change. Create a new entry instead.');
            const oldSlug=before?(JSON.parse(before.content_json).slug||id):id,newSlug=entry.slug||id;
            db.exec('BEGIN IMMEDIATE');try {
              assertEntrySlugAvailable(db,id,id);
              assertEntrySlugAvailable(db,newSlug,id);
              if(before){
                reserveEntrySlug(db,id,id);
                reserveEntrySlug(db,oldSlug,id);
                reserveEntrySlug(db,newSlug,id);
                db.prepare('UPDATE entries SET name=?,area=?,latitude=?,longitude=?,status=?,content_json=?,version=version+1,updated_at=? WHERE id=?').run(entry.name,entry.area,entry.coordinates.lat,entry.coordinates.lng,entry.status,JSON.stringify(entry),new Date().toISOString(),id);
              }else{
                db.prepare('INSERT INTO entries(id,kind,name,area,latitude,longitude,status,content_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,entry.kind,entry.name,entry.area,entry.coordinates.lat,entry.coordinates.lng,entry.status,JSON.stringify(entry),new Date().toISOString());
                reserveEntrySlug(db,id,id);
                reserveEntrySlug(db,newSlug,id);
              }
              audit(user,before?'entry-update':'entry-create',id,before?JSON.parse(before.content_json):null,entry);db.exec('COMMIT');
            }catch(e){db.exec('ROLLBACK');throw e;}
            return json(before?200:201,{entry:listEntries(db,true).find(e=>e.id===id)});
          }
        }
        throw error(404,'API endpoint not found.');
      }
      if(/(?:^|\/)(?:\.data|backups|\.git|\.env[^/]*)(?:\/|$)/.test(decodeURIComponent(p)))throw error(404,'File not found.');
      if(vite) return vite.middlewares(req,res,()=>{res.writeHead(404);res.end('Not found');});
      const dir=path.join(root,'dist');
      let file=path.resolve(dir,'.'+decodeURIComponent(p));
      if(!file.startsWith(dir+path.sep)) file=path.join(dir,'index.html');
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()) {
        if(p==='/admin'||p==='/admin/') file=path.join(dir,'admin.html');
        else if(!path.extname(p)) file=path.join(dir,'index.html');
        else throw error(404,'File not found.');
      }
      if(!fs.existsSync(file)) throw error(503,'Build the frontend first with npm run build.');
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.bin':'application/octet-stream','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':p.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});fs.createReadStream(file).pipe(res);
    }catch(e){if(!res.headersSent) json(e.status||500,{error:e.status?e.message:'Something went wrong. Check the server log.'});if(!e.status) console.error(e);}
  });
  return {server,db,setupToken,close:async()=>{await new Promise(resolve=>server.close(resolve));await vite?.close();db.close();}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const port=Number(process.env.PORT||5318),host=process.env.HOST||'127.0.0.1';
  const origin=process.env.APP_ORIGIN||`http://127.0.0.1:${port}`;
  const app=await createGuideServer({origin,development:!process.argv.includes('--production')});
  app.server.listen(port,host,()=>{
    console.log(`Ride The Lost Sierra: ${origin}`);
    if(app.setupToken) console.log(`One-time admin setup: ${origin}/admin.html#setup=${app.setupToken}`);
  });
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
}
