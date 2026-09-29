import { mountRideViewer } from '../../src/ride-viewer';
import { BECKWOURTH_VIEW } from '../../src/beckwourth-preset';
import curatedRides from '../data/curated-rides.json';
import beckMap from '../../public/beckwourth/map.json';
import beckHeightsUrl from '../../public/beckwourth/terrain.bin?url';
import { projectTrack, regionalRideData } from './ride-data.js';
import { rideContextForMap } from '../../src/ride-context-data';
import { surfaceTypesForTrack } from '../../src/route-surfaces';

export async function prepareRide(entry,track,signal){
  const contextRequest=fetch('/terrain/ride-context.geojson',{signal}).then(r=>r.ok?r.json():null).catch(()=>null);
  const surfacesRequest=fetch('/terrain/route-surfaces.json',{signal}).then(r=>r.ok?r.json():null).catch(()=>null);
  const config=entry.viewer||{};
  const insideBeck=track.geometry.coordinates.every(([lon,lat])=>lon>=beckMap.bbox.west&&lon<=beckMap.bbox.east&&lat>=beckMap.bbox.south&&lat<=beckMap.bbox.north);
  let options;
  if(entry.id==='beckwourth-peak'&&insideBeck){
    const response=await fetch(beckHeightsUrl,{signal});if(!response.ok)throw Error('Terrain could not load.');
    const heights=await response.arrayBuffer();
    options={...BECKWOURTH_VIEW,data:{map:beckMap,ride:projectTrack(track,beckMap,new Uint16Array(heights)),heights}};
  }else{
    const detail=curatedRides.find(ride=>ride.id===entry.id)?.terrain;
    const responses=await Promise.all([fetch(detail?`${detail}/terrain.json`:'/terrain/region.json',{signal}),fetch(detail?`${detail}/terrain.bin`:'/terrain/region.bin',{signal})]);
    if(responses.some(r=>!r.ok))throw Error('Terrain could not load.');
    const [meta,buffer]=await Promise.all([responses[0].json(),responses[1].arrayBuffer()]);
    options=regionalRideData(track,meta,new Uint16Array(buffer),config.pointsOfInterest||[]);
  }
  signal.throwIfAborted();
  for(const [key,value] of Object.entries(config))if(value!=null)options[key]=value;
  const context=await contextRequest;signal.throwIfAborted();
  if(context)options.contextFeatures=rideContextForMap(context,options.data.map);
  const surfaces=await surfacesRequest;signal.throwIfAborted();
  options.surfaceTypes=await surfaceTypesForTrack(surfaces?.rides?.[entry.id],track.geometry.coordinates);
  signal.throwIfAborted();
  if(entry.id==='buzzards-roost-ridge'){
    const namedWaterways=new Set(['Dixon Creek','Nelson Creek','Middle Fork Feather River']);
    for(const feature of options.contextFeatures||[])if(feature.kind==='waterway')feature.showLabel=namedWaterways.has(feature.name);
    const dixon=options.contextFeatures?.find(feature=>feature.name==='Dixon Creek');
    if(dixon)dixon.labelCoordinates=[-120.8773506,39.8116425];
    // Anchor directions on the road toward each exit, visible from the saved home view.
    if(options.contextFeatures)options.contextFeatures.push(
      {name:'To Laporte',kind:'road',importance:3,length:0,lines:[],labelCoordinates:[-120.8835023,39.7939973]},
      {name:'To Quincy',kind:'road',importance:3,length:0,lines:[],labelCoordinates:[-120.8681629,39.8504472]},
    );
  }
  return {...options,homeStorageKey:null,manageLoading:false};
}

export { mountRideViewer };
