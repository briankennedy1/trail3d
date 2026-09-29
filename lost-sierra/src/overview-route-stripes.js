import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { overviewRouteColor } from './overview-route-colors.js';
import { buildOverviewRouteNetwork, canonicalRoutePositions } from './overview-route-network.js';

export const OVERVIEW_STRIPE_PX=9;

function stripedMaterial(ids){
  const material=new LineMaterial({color:overviewRouteColor(ids[0]),linewidth:3.375,transparent:true,opacity:.99,depthTest:true,depthWrite:false});
  if(ids.length===1)return material;
  material.onBeforeCompile=shader=>{
    shader.uniforms.stripeColors={value:ids.map(id=>new THREE.Color(overviewRouteColor(id)))};
    shader.vertexShader=`attribute float instanceStripeStart;
      attribute float instanceStripeEnd;
      varying float vStripeDistance;\n${shader.vertexShader}`.replace('gl_Position = clip;',`
      vStripeDistance = mix(instanceStripeStart, instanceStripeEnd, clamp(position.y, 0.0, 1.0));
      vStripeDistance += (position.y < 0.0 ? -0.5 : position.y > 1.0 ? 0.5 : 0.0) * linewidth;
      gl_Position = clip;`);
    shader.fragmentShader=`uniform vec3 stripeColors[${ids.length}];
      varying float vStripeDistance;\n${shader.fragmentShader}`.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );',`
      int stripeIndex = int(mod(floor(max(0.0, vStripeDistance) / ${OVERVIEW_STRIPE_PX.toFixed(1)}), ${ids.length.toFixed(1)}));
      gl_FragColor = vec4(stripeColors[stripeIndex], alpha);`);
  };
  material.customProgramCacheKey=()=>`overview-route-stripes-${ids.length}`;
  return material;
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
      batch.geometry=geometry;
      if(batch.ids.length>1){
        const count=batch.segments.length/6;
        geometry.setAttribute('instanceStripeStart',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('instanceStripeEnd',new THREE.InstancedBufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
      }
      const halo=new LineSegments2(geometry,new LineMaterial({color:0xfff9df,linewidth:5.25,transparent:true,opacity:.99,depthTest:true,depthWrite:false}));
      const line=new LineSegments2(geometry,stripedMaterial(batch.ids));
      halo.renderOrder=20;line.renderOrder=21;halo.frustumCulled=false;line.frustumCulled=false;
      this.group.add(halo,line);this.batches.push(batch);
    }
  }
  setDimmed(dimmed){for(const line of this.group.children)line.material.opacity=dimmed ? .3 : .99;}
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
