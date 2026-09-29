// Turn a geographic recording and a terrain cutout into the original viewer's
// local-meter format. This adapter is independent of the UI and renderer.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function sampleTerrain(meta,raw,lon,lat){
  const gx=clamp((lon-meta.bbox.west)/(meta.bbox.east-meta.bbox.west)*(meta.width-1),0,meta.width-1);
  const gy=clamp((meta.bbox.north-lat)/(meta.bbox.north-meta.bbox.south)*(meta.height-1),0,meta.height-1);
  const x=Math.min(Math.floor(gx),meta.width-2),y=Math.min(Math.floor(gy),meta.height-2),u=gx-x,v=gy-y;
  return (raw[y*meta.width+x]*(1-u)*(1-v)+raw[y*meta.width+x+1]*u*(1-v)+raw[(y+1)*meta.width+x]*(1-u)*v+raw[(y+1)*meta.width+x+1]*u*v)/meta.scale;
}
export function projectTrack(track,map,heights){
  const metersLon=111320*Math.cos((map.bbox.south+map.bbox.north)*Math.PI/360);
  const meta={bbox:map.bbox,width:map.grid.width,height:map.grid.height,scale:map.grid.scale};
  return {id:0,date:'',points:track.geometry.coordinates.map(([lon,lat,elevation])=>[
    (lon-map.bbox.west)*metersLon,(lat-map.bbox.south)*111320,
    elevation??sampleTerrain(meta,heights,lon,lat),
  ])};
}
export function regionalRideData(track,meta,raw,pointsOfInterest=[]){
  const coords=track.geometry.coordinates.concat(pointsOfInterest.map(p=>[p.longitude,p.latitude]));
  const lons=coords.map(p=>p[0]),lats=coords.map(p=>p[1]);
  const west=Math.min(...lons),east=Math.max(...lons),south=Math.min(...lats),north=Math.max(...lats);
  const padX=Math.max(.008,(east-west)*.16),padY=Math.max(.006,(north-south)*.16);
  const bbox={west:Math.max(meta.bbox.west,west-padX),east:Math.min(meta.bbox.east,east+padX),south:Math.max(meta.bbox.south,south-padY),north:Math.min(meta.bbox.north,north+padY)};
  const widthM=(bbox.east-bbox.west)*111320*Math.cos((bbox.south+bbox.north)*Math.PI/360),heightM=(bbox.north-bbox.south)*111320;
  const width=Math.max(32,Math.round((bbox.east-bbox.west)/(meta.bbox.east-meta.bbox.west)*(meta.width-1))+1);
  const height=Math.max(32,Math.round((bbox.north-bbox.south)/(meta.bbox.north-meta.bbox.south)*(meta.height-1))+1);
  const heights=new Uint16Array(width*height);let min=Infinity,max=-Infinity;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const h=sampleTerrain(meta,raw,bbox.west+x/(width-1)*(bbox.east-bbox.west),bbox.north-y/(height-1)*(bbox.north-bbox.south));
    heights[y*width+x]=Math.round(h*meta.scale);min=Math.min(min,h);max=Math.max(max,h);
  }
  const map={bbox,widthM,heightM,grid:{width,height,spacing:widthM/(width-1),scale:meta.scale},elevation:{min,max},basin:[[0,0],[widthM,0],[widthM,heightM],[0,heightM]],lakes:[],wilderness:[],roads:[],labels:[],attribution:[meta.source]};
  const metersLon=111320*Math.cos((bbox.south+bbox.north)*Math.PI/360);
  map.lakes=(meta.waterbodies||[]).map(lake=>({
    name:lake.name,level:lake.level,area:lake.area,
    outer:lake.rings[0].map(([lon,lat])=>[(lon-bbox.west)*metersLon,(lat-bbox.south)*111320]),
    inner:lake.rings.slice(1).map(ring=>ring.map(([lon,lat])=>[(lon-bbox.west)*metersLon,(lat-bbox.south)*111320])),
  }));
  if(meta.waterSource)map.attribution.push(meta.waterSource);
  const scale=Math.max(.25,Math.max(widthM,heightM)/7338),centerY=((min+max)/2-1898)/100*2.3;
  return {data:{map,ride:projectTrack(track,map,heights),heights:heights.buffer},scale,baseElevation:min-120,autoFrameHome:true,
    home:{position:[-73.69*scale,centerY+71.64*scale,-153.78*scale],target:[-7.22*scale,centerY,-7.33*scale],zoom:1.273332761095871},pointsOfInterest};
}
