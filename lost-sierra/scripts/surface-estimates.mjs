// Reviewed estimates fill gaps only; mapped and rider-confirmed types take priority.
export function applySurfaceEstimates(types,coordinatesSha256,review,rideId){
  if(!review)return null;
  if(review.coordinatesSha256!==coordinatesSha256)throw Error(`${rideId}: review surface estimates after changing the GPS track.`);
  if(!Array.isArray(review.ranges))throw Error(`${rideId}: missing surface estimate ranges.`);
  let previousEnd=0;
  for(const range of review.ranges){
    const {from,to,type,sourceUrl,rationale}=range;
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<previousEnd||to<=from||to>types.length||!['singletrack','asphalt','dirt'].includes(type)||!/^https:\/\/www\.trailforks\.com\//.test(sourceUrl)||typeof rationale!=='string'||!rationale.trim())throw Error(`${rideId}: invalid surface estimate range.`);
    previousEnd=to;
  }
  const applied=[];
  for(const range of review.ranges){
    let run=null;
    for(let i=range.from;i<range.to;i++){
      if(types[i]!=='unknown'){run=null;continue;}
      types[i]=range.type;
      if(run)run.to=i+1;
      else{run={...range,from:i,to:i+1};applied.push(run);}
    }
  }
  return {...review,ranges:applied};
}
