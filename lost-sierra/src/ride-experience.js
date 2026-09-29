import { mountRideViewer } from '../../src/ride-viewer';
import { BECKWOURTH_VIEW } from '../../src/beckwourth-preset';
import curatedRides from '../data/curated-rides.json';
import beckMap from '../../public/beckwourth/map.json';
import beckHeightsUrl from '../../public/beckwourth/terrain.bin?url';
import { projectTrack, regionalRideData } from './ride-data.js';
import { rideContextForMap, roadEdgePoint } from '../../src/ride-context-data';
import { surfaceTypesForTrack } from '../../src/route-surfaces';
import { routeEndpointFlags } from './ride-access.js';

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
  const first=track.geometry.coordinates[0],last=track.geometry.coordinates.at(-1);
  // Honor the CMS loop setting; otherwise recognize recordings that close within 50 m.
  const isLoop=entry.sameStartFinish??(Math.hypot((last[0]-first[0])*111320*Math.cos(first[1]*Math.PI/180),(last[1]-first[1])*111320)<50);
  options.pointsOfInterest=routeEndpointFlags(options.pointsOfInterest,entry,track.geometry.coordinates,isLoop);
  const context=await contextRequest;signal.throwIfAborted();
  if(context)options.contextFeatures=rideContextForMap(context,options.data.map);
  const surfaces=await surfacesRequest;signal.throwIfAborted();
  options.surfaceTypes=await surfaceTypesForTrack(surfaces?.rides?.[entry.id],track.geometry.coordinates);
  signal.throwIfAborted();
  if(entry.id==='mt-elwell-hard-way'||entry.rideFamily?.id==='mt-elwell'){
    const names=new Set(['Gray Eagle Creek','Frazier Falls Road','Gold Lake Highway','Smith Creek']);
    for(const feature of options.contextFeatures||[])feature.showLabel=names.has(feature.name);
    const creek=options.contextFeatures?.find(feature=>feature.name==='Gray Eagle Creek');
    if(creek)creek.labelCoordinates=[-120.6551813,39.7361773];
    options.contextFeatures??=[];
    options.contextFeatures.unshift({name:'Mill Pond',kind:'waterway',importance:3,length:0,lines:[],labelCoordinates:[-120.61335,39.7671]});
  }
  if(entry.id==='buzzards-roost-ridge'){
    const namedWaterways=new Set(['Nelson Creek','Middle Fork Feather River']);
    for(const feature of options.contextFeatures||[])if(feature.kind==='waterway')feature.showLabel=namedWaterways.has(feature.name);
    const dixon=options.contextFeatures?.find(feature=>feature.name==='Dixon Creek');
    if(dixon)dixon.labelCoordinates=[-120.8773506,39.8116425];
    const road=options.contextFeatures?.find(feature=>feature.name==='La Porte Road');
    const map=options.data.map;
    if(road)for(const [name,direction] of [['To Laporte',-1],['To Quincy',1]]){
      const exit=roadEdgePoint(road.lines,{west:0,east:map.widthM,south:0,north:map.heightM},1,direction);
      if(exit)options.contextFeatures.push({name,kind:'road',importance:3,length:0,lines:[],labelCoordinates:[
        map.bbox.west+exit[0]/map.widthM*(map.bbox.east-map.bbox.west),
        map.bbox.south+exit[1]/map.heightM*(map.bbox.north-map.bbox.south),
      ]});
    }
  }
  return {...options,homeStorageKey:null,manageLoading:false};
}

export { mountRideViewer };
