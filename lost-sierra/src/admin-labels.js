// Preview the context names likely to be available on a ride's terrain crop.
// The crop uses the same padding as regionalRideData; detailed terrain can vary.
const roadNumber=/^(?:Forest (?:Road|Route) )?\d+[A-Z]\d+[A-Z\d.]*$/i;

function clippedLength(points,box){
  let length=0;
  const metersLon=111320*Math.cos((box.south+box.north)*Math.PI/360);
  for(let i=1;i<points.length;i++){
    const [ax,ay]=points[i-1],[bx,by]=points[i];
    const dx=bx-ax,dy=by-ay;
    let low=0,high=1;
    for(const [p,q] of [[-dx,ax-box.west],[dx,box.east-ax],[-dy,ay-box.south],[dy,box.north-ay]]){
      if(p===0){if(q<0){low=1;high=0;break;}}
      else if(p<0)low=Math.max(low,q/p);
      else high=Math.min(high,q/p);
      if(low>high)break;
    }
    if(low<=high)length+=(high-low)*Math.hypot(dx*metersLon,dy*111320);
  }
  return length;
}

export function availableContextLabels(source,track,entry){
  const coords=track?.geometry?.coordinates;
  if(!Array.isArray(coords)||coords.length<2||!Array.isArray(source?.features))return [];
  const lons=coords.map(point=>point[0]),lats=coords.map(point=>point[1]);
  if(lons.some(n=>!Number.isFinite(n))||lats.some(n=>!Number.isFinite(n)))return [];
  const west=Math.min(...lons),east=Math.max(...lons),south=Math.min(...lats),north=Math.max(...lats);
  const padX=Math.max(.008,(east-west)*.16),padY=Math.max(.006,(north-south)*.16);
  const box={west:west-padX,east:east+padX,south:south-padY,north:north+padY};
  const groups=new Map();
  for(const feature of source.features){
    const p=feature.properties,points=feature.geometry?.coordinates;
    if(feature.geometry?.type!=='LineString'||!Array.isArray(points)||!p?.name||!['road','waterway'].includes(p.kind)||(p.kind==='road'&&roadNumber.test(p.name)))continue;
    const length=clippedLength(points,box);
    if(!length)continue;
    const importance=p.kind==='waterway'?(p.class==='river'?3:1):['motorway','trunk','primary','secondary','tertiary'].includes(p.class)?3:p.class==='track'?0:1;
    const key=`${p.kind}:${p.name}`,existing=groups.get(key);
    groups.set(key,{name:p.name,kind:p.kind,importance:Math.max(existing?.importance??0,importance),length:(existing?.length??0)+length});
  }
  const ranked=[...groups.values()].filter(f=>f.length>=(f.importance===3?250:f.importance===0?1800:900)).sort((a,b)=>b.importance-a.importance||b.length-a.length);
  const counts={road:0,waterway:0},names=[];
  for(const feature of ranked)if(counts[feature.kind]++<12)names.push(feature.name);
  if(entry?.rideFamily?.id==='mt-elwell'||entry?.id==='mt-elwell-hard-way')names.push('Mill Pond');
  if(entry?.id==='buzzards-roost-ridge')names.push('To Laporte','To Quincy');
  return [...new Set(names)].sort((a,b)=>a.localeCompare(b));
}

export function coordinatesMapsUrl(raw){
  const match=String(raw).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if(!match)return null;
  const lat=Number(match[1]),lon=Number(match[2]);
  if(lat< -90||lat>90||lon< -180||lon>180)return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}
