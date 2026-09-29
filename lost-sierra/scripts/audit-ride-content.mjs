// Audit versioned seed files only. Live CMS edits are deliberately not read.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),at=args.indexOf('--root');
const root=at<0?path.resolve(import.meta.dirname,'..'):args[at+1];
if(!root||args.some(a=>a.startsWith('--')&&!['--root','--json','--fail-on-errors'].includes(a)))throw Error('Usage: audit-ride-content.mjs [--root PROJECT_ROOT] [--json] [--fail-on-errors]');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const exists=relative=>fs.existsSync(path.join(root,relative));
const catalog=read('data/curated-rides.json');
const planner=exists('data/planner-rides.json')?read('data/planner-rides.json'):[];
const plannerById=new Map(planner.map(entry=>[entry.id,entry]));
const scope=exists('data/guide-scope.json')?read('data/guide-scope.json'):{};
const surface=exists('public/terrain/route-surfaces.json')?read('public/terrain/route-surfaces.json'):null;
const findings=[];
const add=(severity,id,code,message)=>findings.push({severity,id,code,message});
const seen=new Set();
for(const ride of catalog){
  const id=ride.id,details={...(plannerById.get(id)||{}),...(ride.details||{})};
  const area=ride.entry?.area||plannerById.get(id)?.area;
  const archived=ride.entry?.status==='archived'||scope.excludedEntries?.includes(id)||scope.excludedAreas?.includes(area);
  if(seen.has(id))add('error',id,'duplicate-id','Duplicate curated ride ID.');
  seen.add(id);
  if(!/^[a-z0-9-]+$/.test(id))add('error',id,'invalid-id','Invalid ride ID.');
  if(!ride.track||!exists(`data/${ride.track}`)){add('error',id,'missing-track','Curated track file is missing.');continue;}
  let track;
  try{track=read(`data/${ride.track}`);}catch(error){add('error',id,'invalid-track-json',error.message);continue;}
  const coords=track?.geometry?.coordinates;
  if(track?.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length<2){add('error',id,'invalid-geometry','Track must be a LineString with at least two points.');continue;}
  const bad=coords.findIndex(p=>!Array.isArray(p)||p.length<2||p.length>3||p.some(n=>typeof n!=='number'||!Number.isFinite(n))||p[0]<-180||p[0]>180||p[1]<-90||p[1]>90||p.length===3&&(p[2]<-500||p[2]>9000));
  if(bad>=0){add('error',id,'invalid-coordinate',`Invalid track point ${bad}.`);continue;}
  const missing=coords.filter(p=>p.length===2).length,zeros=coords.filter(p=>p.length===3&&p[2]===0).length;
  if(missing)add('error',id,'missing-elevation',`${missing} track points need terrain elevation.`);
  if(zeros)add('error',id,'zero-elevation',`${zeros} zero elevation values may be GPX placeholders.`);
  if(!track.properties?.sourceUrl||!track.properties?.gpxSha256)add('warning',id,'source-provenance','Source URL or GPX hash is missing.');
  const listed=surface?.rides?.[id],sha=createHash('sha256').update(JSON.stringify(coords)).digest('hex');
  if(!listed)add('warning',id,'missing-surface','No surface classification for this ride.');
  else{
    if(listed.coordinatesSha256!==sha)add('error',id,'surface-sha-mismatch','Surface classification belongs to another track revision.');
    if(listed.pointCount!==coords.length)add('error',id,'surface-point-count','Surface point count does not match the track.');
    const types=new Set(['singletrack','asphalt','dirt','unknown']);
    let next=0;
    if(!Array.isArray(listed.ranges)||!listed.ranges.length)add('error',id,'surface-range-coverage','Surface ranges are missing.');
    else{
      for(const range of listed.ranges){
        if(!Number.isInteger(range.from)||!Number.isInteger(range.to)||range.from!==next||range.to<=range.from||range.to>coords.length-1||!types.has(range.type)){
          add('error',id,'surface-range-coverage','Surface ranges contain a gap, overlap, invalid class, or out-of-bounds index.');break;
        }
        next=range.to;
      }
      if(next!==coords.length-1)add('error',id,'surface-range-coverage',`Surface ranges end at ${next}; expected ${coords.length-1}.`);
    }
  }
  const terrain=typeof ride.terrain==='string'&&ride.terrain.startsWith('/terrain/')?ride.terrain.slice(1):`terrain/${id}`;
  if(!exists(`public/${terrain}/terrain.json`)||!exists(`public/${terrain}/terrain.bin`))add('error',id,'missing-terrain','Detailed terrain files are missing.');
  else{
    try{
      const meta=read(`public/${terrain}/terrain.json`),bbox=meta.bbox;
      if(!bbox||!['west','east','south','north'].every(key=>Number.isFinite(bbox[key]))||
        coords.some(([lon,lat])=>lon<bbox.west||lon>bbox.east||lat<bbox.south||lat>bbox.north))
        add('error',id,'terrain-bounds','Track extends outside the detailed terrain bounding box.');
      if(!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<2||meta.height<2||
        fs.statSync(path.join(root,`public/${terrain}/terrain.bin`)).size!==meta.width*meta.height*2)
        add('error',id,'terrain-data-size','Terrain binary size does not match its dimensions.');
    }catch(error){add('error',id,'invalid-terrain',error.message);}
  }
  if(!archived){
    if(!details.intensity)add('warning',id,'unrated-intensity','Intensity has not been reviewed.');
    if(!details.startMapsUrl)add('warning',id,'missing-start-parking','Start parking link has not been confirmed.');
    if(details.sameStartFinish===undefined)add('warning',id,'unknown-finish','Start/finish relation has not been confirmed.');
    else if(details.sameStartFinish===false&&!details.finishMapsUrl)add('warning',id,'missing-finish-parking','Finish parking link has not been confirmed.');
    if(!details.notes?.trim())add('warning',id,'missing-notes','Field notes are empty.');
    if(!details.summary?.trim())add('warning',id,'missing-summary','Summary is empty.');
    if(details.incomplete)add('warning',id,'incomplete','Ride is marked incomplete.');
  }
}
const report={scope:'versioned-seed-only; live CMS edits not inspected',rides:catalog.length,errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length,findings};
if(args.includes('--json'))console.log(JSON.stringify(report,null,2));
else{console.log(`Versioned seed audit (live CMS not inspected): ${report.rides} rides · ${report.errors} errors · ${report.warnings} review items`);for(const f of findings)console.log(`${f.severity.toUpperCase()} ${f.id} ${f.code}: ${f.message}`);}
if(args.includes('--fail-on-errors')&&report.errors)process.exitCode=1;
