import {START_FLAG_COLOR,FINISH_FLAG_COLOR} from './ride-access.js';
// Match a shuttle drop-off to the full track. Keep terrain coordinates and home
// unchanged, and trim surface segments alongside their corresponding points.
export function shuttleStartIndex(entry, track) {
  const shuttle=entry.shuttle;
  if(!shuttle?.enabled||!shuttle.coordinates)return null;
  const {lat,lng}=shuttle.coordinates,scale=111320*Math.cos(lat*Math.PI/180);
  let index=0,distance=Infinity;
  track.geometry.coordinates.forEach((p,i)=>{
    const d=Math.hypot((p[0]-lng)*scale,(p[1]-lat)*111320);
    if(d<distance){distance=d;index=i;}
  });
  return distance<=200&&index>0&&index<track.geometry.coordinates.length-2?index:null;
}
export function rideVariant(entry,track,base,mode) {
  const start=mode==='shuttle'?shuttleStartIndex(entry,track):null;
  if(start==null)return {entry,options:{...base}};
  const shuttle=entry.shuttle,finish=track.geometry.coordinates.at(-1);
  const finishUrl=entry.sameStartFinish?entry.startMapsUrl:(entry.finishMapsUrl||entry.startMapsUrl);
  const points=(base.pointsOfInterest||[]).filter(p=>! /^(?:route start(?:\s*\/\s*finish)?|route finish|.*\btrailhead)$/i.test(p.name));
  points.push({name:'Route start',latitude:shuttle.coordinates.lat,longitude:shuttle.coordinates.lng,color:START_FLAG_COLOR,url:shuttle.startMapsUrl},
    {name:'Route finish',latitude:finish[1],longitude:finish[0],color:FINISH_FLAG_COLOR,url:finishUrl||`https://www.google.com/maps?q=${finish[1]},${finish[0]}`});
  return {
    entry:{...entry,startMapsUrl:shuttle.startMapsUrl,finishMapsUrl:finishUrl,sameStartFinish:false,climbingFt:shuttle.climbingFt??null,movingMinutes:shuttle.movingMinutes??null,movingTimeEstimated:shuttle.movingTimeEstimated!==false},
    options:{...base,data:{...base.data,ride:{...base.data.ride,points:base.data.ride.points.slice(start)}},surfaceTypes:base.surfaceTypes?.slice(start),pointsOfInterest:points}
  };
}
