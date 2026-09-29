// Applies only to context text; line geometry and POI flags stay intact.
export function applyContextLabels(features=[],setting){
  if(!setting)return features;
  const names=new Set(setting.names);
  for(const feature of features){
    if(setting.mode==='all')feature.showLabel=true;
    else if(setting.mode==='none')feature.showLabel=false;
    else if(setting.mode==='only')feature.showLabel=names.has(feature.name);
    else if(setting.mode==='hide'&&names.has(feature.name))feature.showLabel=false;
  }
  return features;
}

// GPS and mapped roads can differ slightly. This is a contact tolerance, not
// the much wider padded terrain bounds used to draw geographic context.
export const ROUTE_LABEL_TOLERANCE_M=10;
const cellSize=100;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const subtract=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function pointSegmentDistanceSquared(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
  return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
}
function segmentsTouch(a,b,c,d){
  const ab=subtract(b,a),cd=subtract(d,c),ac=subtract(c,a),denominator=cross(ab,cd);
  if(denominator){
    const t=cross(ac,cd)/denominator,u=cross(ac,ab)/denominator;
    if(t>=0&&t<=1&&u>=0&&u<=1)return true;
  }
  return Math.min(pointSegmentDistanceSquared(a,c,d),pointSegmentDistanceSquared(b,c,d),
    pointSegmentDistanceSquared(c,a,b),pointSegmentDistanceSquared(d,a,b))<=ROUTE_LABEL_TOLERANCE_M**2;
}
function cellsForSegment(a,b,pad,visit){
  for(let x=Math.floor((Math.min(a[0],b[0])-pad)/cellSize);x<=Math.floor((Math.max(a[0],b[0])+pad)/cellSize);x++)
    for(let y=Math.floor((Math.min(a[1],b[1])-pad)/cellSize);y<=Math.floor((Math.max(a[1],b[1])+pad)/cellSize);y++)
      if(visit(`${x},${y}`))return true;
  return false;
}

// Apply last so a saved "show all" setting cannot restore unrelated labels.
// Keep geographic linework and explicit POI/endpoint flags separate from text.
export function restrictContextLabelsToRoute(features=[],routePoints=[],map){
  const index=new Map();
  for(let i=1;i<routePoints.length;i++){
    const segment=[routePoints[i-1],routePoints[i]];
    cellsForSegment(...segment,ROUTE_LABEL_TOLERANCE_M,key=>{
      if(!index.has(key))index.set(key,[]);
      index.get(key).push(segment);
    });
  }
  const project=([lon,lat])=>[(lon-map.bbox.west)/(map.bbox.east-map.bbox.west)*map.widthM,
    (lat-map.bbox.south)/(map.bbox.north-map.bbox.south)*map.heightM];
  const touches=(a,b)=>cellsForSegment(a,b,0,key=>index.get(key)?.some(([c,d])=>segmentsTouch(a,b,c,d)));
  for(const feature of features){
    if(feature.showLabel===false)continue;
    let lines=feature.lines;
    if(!lines.length){
      const lake=map.lakes?.find(lake=>lake.name===feature.name);
      if(lake)lines=[[...lake.outer,lake.outer[0]]];
      else if(feature.labelCoordinates){const point=project(feature.labelCoordinates);lines=[[point,point]];}
    }
    feature.showLabel=lines.some(line=>line.some((point,i)=>i>0&&touches(line[i-1],point)));
  }
  return features;
}
