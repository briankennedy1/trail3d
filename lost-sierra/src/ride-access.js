const isGoogleMaps=url=>{
  try{
    const {protocol,hostname,pathname}=new URL(url);
    return protocol==='https:'&&(hostname==='maps.app.goo.gl'||hostname==='maps.google.com'||
      ((hostname==='www.google.com'||hostname==='google.com'||hostname==='goo.gl')&&pathname.startsWith('/maps')));
  }catch{return false;}
};

// Resolve at display time so editing the parking field also updates the flag.
export function routeStartParkingLinks(points=[],parkingUrl,isLoop=false){
  return points.map(point=>{
    if(!/^(?:route start(?:\s*\/\s*finish)?|.*\btrailhead)$/i.test(point.name.trim()))return point;
    const url=isGoogleMaps(parkingUrl)?parkingUrl:isGoogleMaps(point.url)?point.url:
      `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
    return {...point,name:isLoop?'Route Start / Finish':point.name,url};
  });
}

export const START_FLAG_COLOR='#34877b';
export const FINISH_FLAG_COLOR='#bd493c';

// Every route gets its actual endpoints, even when only a start was imported.
export function routeEndpointFlags(points,entry,coordinates,isLoop){
  const first=coordinates[0],last=coordinates.at(-1);
  const startName=/^(?:route start(?:\s*\/\s*finish)?|.*\btrailhead)$/i;
  const finishName=/^route (?:finish|end)$/i;
  const resolved=routeStartParkingLinks(points,entry.startMapsUrl,isLoop)
    .filter(p=>!isLoop||!finishName.test(p.name.trim()))
    .map(p=>{
      if(startName.test(p.name.trim()))return {...p,color:START_FLAG_COLOR};
      if(finishName.test(p.name.trim()))return {...p,color:FINISH_FLAG_COLOR,url:isGoogleMaps(entry.finishMapsUrl)?entry.finishMapsUrl:isGoogleMaps(p.url)?p.url:`https://www.google.com/maps?q=${p.latitude},${p.longitude}`};
      return p;
    });
  if(!resolved.some(p=>startName.test(p.name.trim())))resolved.push({name:isLoop?'Route Start / Finish':'Route Start',latitude:first[1],longitude:first[0],color:START_FLAG_COLOR,url:isGoogleMaps(entry.startMapsUrl)?entry.startMapsUrl:`https://www.google.com/maps?q=${first[1]},${first[0]}`});
  if(!isLoop&&!resolved.some(p=>finishName.test(p.name.trim())))resolved.push({name:'Route Finish',latitude:last[1],longitude:last[0],color:FINISH_FLAG_COLOR,url:isGoogleMaps(entry.finishMapsUrl)?entry.finishMapsUrl:`https://www.google.com/maps?q=${last[1]},${last[0]}`});
  return resolved;
}
