import { mountRideViewer } from '../../src/ride-viewer';
import { BECKWOURTH_VIEW } from '../../src/beckwourth-preset';
import curatedRides from '../data/curated-rides.json';
import beckMap from '../../public/beckwourth/map.json';
import beckHeightsUrl from '../../public/beckwourth/terrain.bin?url';
import { projectTrack, regionalRideData } from './ride-data.js';

export async function prepareRide(entry,track,signal){
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
  return {...options,homeStorageKey:null,manageLoading:false};
}

export { mountRideViewer };
