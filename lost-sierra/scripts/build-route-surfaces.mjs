// Classify imported rides against a cached Overpass `way[highway];out geom`
// response. Run: node scripts/build-route-surfaces.mjs /path/to/ways.json --ride ride-id
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),sourceFile=args[0];
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const rideId=option('--ride'),all=args.includes('--all');
if(!sourceFile||Boolean(rideId)===all||args.some(arg=>arg.startsWith('--')&&!['--ride','--all','--root','--confirm-replace-catalog','--allow-all-unknown'].includes(arg)))throw Error('Usage: build-route-surfaces.mjs ways.json (--ride ID | --all --confirm-replace-catalog) [--root PROJECT_ROOT]');
if(all&&!args.includes('--confirm-replace-catalog'))throw Error('Full catalog replacement requires --confirm-replace-catalog.');
if(rideId&&!/^[a-z0-9-]+$/.test(rideId))throw Error('Invalid ride ID.');
const root=option('--root')||path.resolve(import.meta.dirname,'..');
const source=JSON.parse(fs.readFileSync(sourceFile));
if(source.remark)throw Error(source.remark);
if(!Array.isArray(source.elements))throw Error('Expected Overpass elements array.');
const scaleX=85500,scaleY=111320,cell=80,grid=new Map(),sources={};
const project=p=>[p[0]*scaleX,p[1]*scaleY];
function surface(t){
  if(['asphalt','paved','concrete','concrete:plates','chipseal'].includes(t.surface))return 'asphalt';
  if(t.highway==='track'||['grade2','grade3','grade4','grade5'].includes(t.tracktype))return 'dirt';
  if(['path','footway','bridleway'].includes(t.highway)||(t.highway==='cycleway'&&(Number.parseFloat(t.width)<2||t['mtb:scale']||t['mtb:scale:imba'])))return Number.parseFloat(t.width)>=2?'dirt':'singletrack';
  if(['gravel','fine_gravel','dirt','earth','ground','unpaved','compacted','sand','rock'].includes(t.surface))return 'dirt';
  if(['motorway','trunk','primary','secondary','tertiary'].includes(t.highway))return 'asphalt';
  return 'unknown';
}
for(const way of source.elements){
  if(!way.geometry||!way.tags?.highway)continue;
  const type=surface(way.tags);
  sources[way.id]={...Object.fromEntries(['name','highway','surface','tracktype','width','mtb:scale','mtb:scale:imba'].filter(k=>way.tags[k]).map(k=>[k,way.tags[k]])),classification:type};
  const points=way.geometry.map(p=>project([p.lon,p.lat]));
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.1)continue;
    const segment={a,b,dx,dy,length,type,id:way.id};
    for(let x=Math.floor((Math.min(a[0],b[0])-30)/cell);x<=Math.floor((Math.max(a[0],b[0])+30)/cell);x++)for(let y=Math.floor((Math.min(a[1],b[1])-30)/cell);y<=Math.floor((Math.max(a[1],b[1])+30)/cell);y++){
      const key=`${x}:${y}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(segment);
    }
  }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/curated-rides.json')));
const overrides=JSON.parse(fs.readFileSync(path.join(root,'data/route-surface-overrides.json')));
const catalog=[{id:'beckwourth-peak',track:'beckwourth-track.geojson'},...manifest];
const rides=rideId?catalog.filter(r=>r.id===rideId):catalog;
if(!rides.length)throw Error(`Ride ${rideId} is missing from curated-rides.json.`);
const outputFile=path.join(root,'public/terrain/route-surfaces.json');
const existing=rideId?JSON.parse(fs.readFileSync(outputFile,'utf8')):null;
if(rideId&&(!existing?.rides||!existing?.ways||Object.keys(existing.rides).length===0))throw Error('A populated route-surfaces.json is required for a single-ride update.');
const output=existing?structuredClone(existing):{source:'OpenStreetMap contributors',sourceUrl:'https://www.openstreetmap.org/copyright',retrievedAt:new Date().toISOString(),method:'Nearest mapped way within 25 m, heading-compatible; runs shorter than 30 m bridged only between matching classes. Asphalt includes mapped paved surfaces; motorway through tertiary road classes infer pavement. Tracks infer dirt roads; paths/footways/bridleways and narrow or MTB-tagged cycleways infer singletrack unless width is at least 2 m. Other explicitly unpaved roads infer dirt roads. Unmatched or insufficiently tagged segments remain unknown.',rides:{},ways:{}};
for(const ride of rides){
 const track=JSON.parse(fs.readFileSync(path.join(root,'data',ride.track))),coords=track.geometry.coordinates,points=coords.map(project),types=[],ids=[],dist=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);dist.push(length);
  let best=null,score=Infinity;
  for(const s of grid.get(`${Math.floor(x/cell)}:${Math.floor(y/cell)}`)||[]){
   const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/(s.length*s.length)));
   const distance=Math.hypot(x-s.a[0]-t*s.dx,y-s.a[1]-t*s.dy);if(distance>25)continue;
   const alignment=length>1?Math.abs((dx*s.dx+dy*s.dy)/(length*s.length)):1;
   if(alignment<.45&&distance>6)continue;
   const cost=distance+(1-alignment)*12;if(cost<score){score=cost;best=s;}
  }
  types.push(best?.type||'unknown');ids.push(best?.id||null);
 }
 // Bridge short gaps, not extended unmapped stretches or legitimate transitions.
 for(let start=0;start<types.length;){let end=start+1;while(end<types.length&&types[end]===types[start])end++;
  const length=dist.slice(start,end).reduce((a,b)=>a+b,0);
  if(length<30&&start>0&&end<types.length&&types[start-1]===types[end])for(let i=start;i<end;i++)types[i]=types[start-1];
  start=end;
 }
 const coordinatesSha256=createHash('sha256').update(JSON.stringify(coords)).digest('hex');
 const confirmed=overrides[ride.id];
 if(confirmed){
  if(confirmed.coordinatesSha256!==coordinatesSha256)throw Error(`${ride.id}: review surface corrections after changing the GPS track.`);
  for(const r of confirmed.ranges)types.fill(r.type,r.from,r.to);
 }
 const ranges=[],totals={singletrack:0,asphalt:0,dirt:0,unknown:0},used=new Set();
 for(let i=0;i<types.length;i++){totals[types[i]]+=dist[i];if(ids[i])used.add(ids[i]);const last=ranges.at(-1);if(last?.type===types[i])last.to=i+1;else ranges.push({from:i,to:i+1,type:types[i]});}
 if(!used.size&&!args.includes('--allow-all-unknown'))throw Error(`${ride.id}: no mapped ways matched the track; check the Overpass export or pass --allow-all-unknown after review.`);
 for(const id of used)output.ways[id]=sources[id];
 output.rides[ride.id]={coordinatesSha256,pointCount:coords.length,ranges,meters:totals,...(confirmed?{overrides:confirmed.ranges}:{}),...(rideId?{retrievedAt:new Date().toISOString()}:{})};
 console.log(ride.id,Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,`${(v/1609.344).toFixed(2)} mi`])),ranges.length+' sections');
}
const temporary=`${outputFile}.${process.pid}.tmp`;
try{fs.writeFileSync(temporary,JSON.stringify(output)+'\n',{flag:'wx'});fs.renameSync(temporary,outputFile);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
