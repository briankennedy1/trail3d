// Build detailed, cached terrain for imported rides. GPX elevations remain intact.
// Usage: node scripts/build-ride-terrain.mjs lake-davis-loop haskell-peak
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
const root=path.resolve(import.meta.dirname,'..'),cache=path.join(root,'.cache/terrain');
await fs.mkdir(cache,{recursive:true});
for(const id of process.argv.slice(2)){
  if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid ride ID');
  const track=JSON.parse(await fs.readFile(path.join(root,`data/routes/${id}.geojson`),'utf8'));
  const coords=track.geometry.coordinates,lons=coords.map(p=>p[0]),lats=coords.map(p=>p[1]);
  const west=Math.min(...lons),east=Math.max(...lons),south=Math.min(...lats),north=Math.max(...lats);
  const px=Math.max(.008,(east-west)*.16),py=Math.max(.006,(north-south)*.16);
  const bbox={west:west-px,east:east+px,south:south-py,north:north+py};
  const zoom=12,n=2**zoom,tx=lon=>(lon+180)/360*n,ty=lat=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
  const tiles=new Map(),jobs=[];
  // Include edge pixels needed for bilinear interpolation.
  for(let x=Math.floor(tx(bbox.west)-1/256);x<=Math.floor(tx(bbox.east)+1/256);x++)for(let y=Math.floor(ty(bbox.north)-1/256);y<=Math.floor(ty(bbox.south)+1/256);y++)jobs.push([x,y]);
  async function worker(){while(jobs.length){const [x,y]=jobs.shift(),file=path.join(cache,`${zoom}-${x}-${y}.png`);let buffer;
    try{buffer=await fs.readFile(file);}catch{const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`DEM ${r.status}`);buffer=Buffer.from(await r.arrayBuffer());await fs.writeFile(file,buffer);}
    tiles.set(`${x},${y}`,PNG.sync.read(buffer));
  }}
  await Promise.all(Array.from({length:4},worker));
  function pixel(x,y){const p=tiles.get(`${Math.floor(x/256)},${Math.floor(y/256)}`),i=((y%256)*256+x%256)*4;return p.data[i]*256+p.data[i+1]+p.data[i+2]/256-32768;}
  function elevation(lon,lat){const x=tx(lon)*256-.5,y=ty(lat)*256-.5,i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j;return pixel(i,j)*(1-u)*(1-v)+pixel(i+1,j)*u*(1-v)+pixel(i,j+1)*(1-u)*v+pixel(i+1,j+1)*u*v;}
  const width=Math.ceil((bbox.east-bbox.west)*111320*Math.cos((south+north)*Math.PI/360)/30)+1,height=Math.ceil((bbox.north-bbox.south)*111320/30)+1;
  const data=new Uint16Array(width*height);let min=Infinity,max=-Infinity;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const e=elevation(bbox.west+x/(width-1)*(bbox.east-bbox.west),bbox.north-y/(height-1)*(bbox.north-bbox.south));data[y*width+x]=Math.round(e*4);min=Math.min(min,e);max=Math.max(max,e);}
  const meta={bbox,width,height,scale:4,min,max,source:'AWS Terrain Tiles (USGS 3DEP and SRTM)',sourceUrl:'https://registry.opendata.aws/terrain-tiles/',zoom};
  if(id==='lake-davis-loop'){
    const water=JSON.parse(await fs.readFile(path.join(root,'data/routes/lake-davis-water.geojson'),'utf8')).features[0];
    meta.waterbodies=[{name:'Lake Davis',level:water.properties.ELEVATION*.3048,area:water.properties.AREASQKM*1e6,rings:water.geometry.coordinates}];
    meta.waterSource='USGS National Hydrography Dataset';meta.waterSourceUrl='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12';
  }
  const out=path.join(root,'public/terrain',id);await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'terrain.json'),JSON.stringify(meta));await fs.writeFile(path.join(out,'terrain.bin'),Buffer.from(data.buffer));
  // Some route-plan exports have no usable elevation. Sample the viewer's DEM
  // for XY coordinates, preserving every elevation from an actual recording.
  if(coords.some(p=>p.length===2)){
    track.geometry.coordinates=coords.map(p=>p.length===2?[...p,Math.round(elevation(...p)*100)/100]:p);
    await fs.writeFile(path.join(root,`data/routes/${id}.geojson`),JSON.stringify(track)+'\n');
  }
  console.log(`${id}: ${width} × ${height} terrain, ${Math.round(min)}–${Math.round(max)} m`);
}
