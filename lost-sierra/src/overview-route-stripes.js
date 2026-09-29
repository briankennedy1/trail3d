import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { overviewRouteColor } from './overview-route-colors.js';
import { buildOverviewRouteNetwork, canonicalRoutePositions } from './overview-route-network.js';
import { overviewLineDepth } from './overview-line-depth.js';

export const OVERVIEW_STRIPE_PX=9;

function routeMaterial(ids,outline=false){
  const material=new LineMaterial({color:outline?0xfff9df:overviewRouteColor(ids[0]),linewidth:outline?5.25:3.375,transparent:true,opacity:.99,depthTest:true,depthWrite:false,alphaToCoverage:true});
  const striped=!outline&&ids.length>1;
  material.onBeforeCompile=shader=>{
    // Adjacent segments meet at one miter instead of overlapping round caps.
    // This also joins membership changes without drawing a stray stripe over
    // the next run. Genuine route ends and gaps keep their round caps.
    shader.vertexShader=`attribute vec3 instancePrevious;
      attribute vec3 instanceNext;
      attribute vec2 instanceJoins;\n${shader.vertexShader}`.replace('offset *= linewidth;',`
      bool atStart = position.y < 0.5;
      bool joined = (atStart ? instanceJoins.x : instanceJoins.y) > 0.5;
      if (joined) {
        vec4 neighborClip = projectionMatrix * modelViewMatrix * vec4(atStart ? instancePrevious : instanceNext, 1.0);
        vec2 neighborNdc = neighborClip.xy / neighborClip.w;
        vec2 neighborDir = atStart ? ndcStart.xy - neighborNdc : neighborNdc - ndcEnd.xy;
        neighborDir.x *= aspect;
        if (length(neighborDir) > 0.000001) {
          neighborDir = normalize(neighborDir);
          vec2 currentDir = normalize(vec2(dir.x * aspect, dir.y));
          vec2 normal = vec2(currentDir.y, -currentDir.x);
          vec2 neighborNormal = vec2(neighborDir.y, -neighborDir.x);
          vec2 bisector = normal + neighborNormal;
          if (length(bisector) > 0.000001) {
            vec2 miter = normalize(bisector);
            miter *= min(2.0, 1.0 / max(dot(miter, normal), 0.000001));
            miter.x /= aspect;
            offset = position.x < 0.0 ? -miter : miter;
          }
        }
      }
      offset *= linewidth;`);
    // Preserve hover dimming when Three's coverage shader rounds an endcap.
    shader.fragmentShader=shader.fragmentShader.replace('alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );','alpha = opacity * (1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 ));');
    if(!striped)return;
    shader.uniforms.stripeColors={value:ids.map(id=>new THREE.Color(overviewRouteColor(id)))};
    shader.vertexShader=`attribute float instanceStripeStart;
      attribute float instanceStripeEnd;
      varying float vStripeDistance;\n${shader.vertexShader}`.replace('gl_Position = clip;',`
      vStripeDistance = mix(instanceStripeStart, instanceStripeEnd, clamp(position.y, 0.0, 1.0));
      if (!joined) vStripeDistance += (position.y < 0.0 ? -0.5 : position.y > 1.0 ? 0.5 : 0.0) * linewidth;
      gl_Position = clip;`);
    shader.fragmentShader=`uniform vec3 stripeColors[${ids.length}];
      varying float vStripeDistance;\n${shader.fragmentShader}`.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );',`
      float stripe = max(0.0, vStripeDistance) / ${OVERVIEW_STRIPE_PX.toFixed(1)};
      float boundary = floor(stripe + 0.5);
      float blendWidth = max(fwidth(stripe), 0.0001) * 0.5;
      int before = int(mod(max(0.0, boundary - 1.0), ${ids.length.toFixed(1)}));
      int after = int(mod(boundary, ${ids.length.toFixed(1)}));
      vec3 stripeColor = mix(stripeColors[before], stripeColors[after], smoothstep(boundary - blendWidth, boundary + blendWidth, stripe));
      gl_FragColor = vec4(stripeColor, alpha);`);
  };
  material.customProgramCacheKey=()=>`overview-route-joins-${striped?ids.length:0}`;
  return overviewLineDepth(material);
}

function joinAttributes(buckets){
  const incoming=new Map(),outgoing=new Map(),edges=[];
  const key=(source,point)=>`${source}|${point.join(',')}`;
  const add=(map,key,edge)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(edge);};
  for(const batch of buckets.values()){
    batch.previous=[];batch.next=[];batch.joins=[];
    for(const run of batch.runs){
      let phase=run.phaseKm;
      for(let i=3;i<run.positions.length;i+=3){
        const start=run.positions.slice(i-3,i),end=run.positions.slice(i,i+3);
        const endPhase=phase+Math.hypot(end[0]-start[0],end[2]-start[2]);
        const edge={batch,start,end,phase,endPhase,source:run.sourceId};edges.push(edge);
        add(outgoing,key(edge.source,start),edge);add(incoming,key(edge.source,end),edge);
        phase=endPhase;
      }
    }
  }
  for(const edge of edges){
    const previous=incoming.get(key(edge.source,edge.start))?.find(candidate=>Math.abs(candidate.endPhase-edge.phase)<0.00001);
    const next=outgoing.get(key(edge.source,edge.end))?.find(candidate=>Math.abs(candidate.phase-edge.endPhase)<0.00001);
    edge.batch.previous.push(...(previous?.start||edge.start));
    edge.batch.next.push(...(next?.end||edge.end));
    edge.batch.joins.push(previous?1:0,next?1:0);
  }
}

// Shared corridors are one piece of geometry with a continuous outline. Group
// disconnected runs by their member IDs to keep the number of draw calls small.
export class OverviewRouteStripes {
  constructor(){this.group=new THREE.Group();this.batches=[];this.phasePaths=new Map();this.viewKey='';}
  setRoutes(routes){
    this.clear();
    const buckets=new Map();
    for(const run of buildOverviewRouteNetwork(routes)){
      const key=run.ids.join('|');
      if(!buckets.has(key))buckets.set(key,{ids:run.ids,runs:[],segments:[]});
      const batch=buckets.get(key),offset=batch.segments.length/6;
      for(let i=3;i<run.positions.length;i+=3)batch.segments.push(...run.positions.slice(i-3,i+3));
      batch.runs.push({...run,offset});
    }
    joinAttributes(buckets);
    const phaseSources=new Set([...buckets.values()].filter(batch=>batch.ids.length>1).flatMap(batch=>batch.runs.map(run=>run.sourceId)));
    for(const route of routes){
      if(!phaseSources.has(route.id))continue;
      const positions=canonicalRoutePositions(route.positions),count=positions.length/3;
      const km=new Float64Array(count),pixels=new Float64Array(count);
      for(let i=1;i<count;i++)km[i]=km[i-1]+Math.hypot(positions[i*3]-positions[i*3-3],positions[i*3+2]-positions[i*3-1]);
      this.phasePaths.set(route.id,{positions,km,pixels});
    }
    for(const batch of buckets.values()){
      const geometry=new LineSegmentsGeometry().setPositions(batch.segments);
      geometry.setAttribute('instancePrevious',new THREE.InstancedBufferAttribute(new Float32Array(batch.previous),3));
      geometry.setAttribute('instanceNext',new THREE.InstancedBufferAttribute(new Float32Array(batch.next),3));
      geometry.setAttribute('instanceJoins',new THREE.InstancedBufferAttribute(new Float32Array(batch.joins),2));
      batch.geometry=geometry;
      if(batch.ids.length>1){
        const count=batch.segments.length/6;
        geometry.setAttribute('instanceStripeStart',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('instanceStripeEnd',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
      }
      const halo=new LineSegments2(geometry,routeMaterial(batch.ids,true));
      const line=new LineSegments2(geometry,routeMaterial(batch.ids));
      halo.renderOrder=20;line.renderOrder=21;halo.frustumCulled=false;line.frustumCulled=false;
      this.group.add(halo,line);this.batches.push(batch);
    }
  }
  setDimmed(dimmed){for(const line of this.group.children){
    line.material.opacity=dimmed ? .3 : .99;
    // Coverage uses opacity as a sample mask; disable it while blending the
    // dimmed network so hover doesn't apply the fade twice.
    line.material.alphaToCoverage=!dimmed;
  }}
  update(camera,width,height){
    camera.updateMatrixWorld();
    const matrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const key=`${width},${height},${matrix.elements.join(',')}`;
    if(key===this.viewKey)return;
    this.viewKey=key;
    const point=new THREE.Vector3();
    for(const path of this.phasePaths.values()){
      let lastX=0,lastY=0;
      for(let i=0;i<path.pixels.length;i++){
        point.fromArray(path.positions,i*3).applyMatrix4(matrix);
        const x=point.x*width/2,y=point.y*height/2;
        if(i)path.pixels[i]=path.pixels[i-1]+Math.hypot(x-lastX,y-lastY);
        lastX=x;lastY=y;
      }
    }
    const phasePixels=(sourceId,phaseKm)=>{
      const path=this.phasePaths.get(sourceId);if(!path||!phaseKm)return 0;
      let low=0,high=path.km.length-1;
      while(high-low>1){const middle=(low+high)>>1;if(path.km[middle]<=phaseKm)low=middle;else high=middle;}
      const span=path.km[high]-path.km[low],t=span?THREE.MathUtils.clamp((phaseKm-path.km[low])/span,0,1):0;
      return THREE.MathUtils.lerp(path.pixels[low],path.pixels[high],t);
    };
    for(const batch of this.batches){
      if(batch.ids.length<2)continue;
      const start=batch.geometry.getAttribute('instanceStripeStart'),end=batch.geometry.getAttribute('instanceStripeEnd');
      for(const {positions,offset,sourceId,phaseKm} of batch.runs){
        let distance=phasePixels(sourceId,phaseKm),lastX=0,lastY=0;
        for(let i=0;i<positions.length;i+=3){
          point.fromArray(positions,i).applyMatrix4(matrix);
          const x=point.x*width/2,y=point.y*height/2;
          if(i){const index=offset+i/3-1;start.array[index]=distance;distance+=Math.hypot(x-lastX,y-lastY);end.array[index]=distance;}
          lastX=x;lastY=y;
        }
      }
      start.needsUpdate=true;end.needsUpdate=true;
    }
  }
  clear(){
    for(const batch of this.batches)batch.geometry.dispose();
    for(const line of this.group.children)line.material.dispose();
    this.group.clear();this.batches=[];this.phasePaths.clear();this.viewKey='';
  }
}
