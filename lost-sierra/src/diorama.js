import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_FRAG, SIDE_VERT, SIDE_FRAG } from './terrain-shaders.js';
THREE.ColorManagement.enabled=false;
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const D2R=Math.PI/180, X=111.32*Math.cos(39.835*D2R), Z=111.32, EX=2.3;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=t=>t*t*t*(t*(t*6-15)+10);
function world(lon,lat,e=0){return new THREE.Vector3((lon+120.6)*X,e/1000*EX,(39.835-lat)*Z);}
async function dataset(name){const [meta,buffer]=await Promise.all([fetch(`/terrain/${name}.json`).then(r=>{if(!r.ok)throw Error('Terrain unavailable');return r.json();}),fetch(`/terrain/${name}.bin`).then(r=>{if(!r.ok)throw Error('Terrain unavailable');return r.arrayBuffer();})]);return {...meta,data:new Uint16Array(buffer)};}
function sample(d,lon,lat){const xx=clamp((lon-d.bbox.west)/(d.bbox.east-d.bbox.west))*(d.width-1),yy=clamp((d.bbox.north-lat)/(d.bbox.north-d.bbox.south))*(d.height-1),x=Math.min(Math.floor(xx),d.width-2),y=Math.min(Math.floor(yy),d.height-2),u=xx-x,v=yy-y,a=d.data[y*d.width+x],b=d.data[y*d.width+x+1],c=d.data[(y+1)*d.width+x],e=d.data[(y+1)*d.width+x+1];return (a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+e*u*v)/d.scale;}
export class Diorama {
  constructor(element,labels,{onArea,onProgress,onEnd,onManual}) {
    Object.assign(this,{element,labels,onArea,onProgress,onEnd,onManual});
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.05,1200);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
    this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    this.scene.background=new THREE.Color('#f6efe0');
    element.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=false;this.controls.panSpeed=1.6;this.controls.zoomSpeed=1.4;this.controls.screenSpacePanning=false;this.controls.zoomToCursor=true;this.controls.minZoom=.65;this.controls.maxZoom=22;this.controls.minPolarAngle=.55;this.controls.maxPolarAngle=1.35;this.controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
    this.controls.minDistance=2;this.controls.maxDistance=420;
    this.controls.addEventListener('start',()=>{this.tween=null;if(this.playing){this.pause();this.onManual?.();}});
    this.scene.add(new THREE.HemisphereLight(0xf6f2e2,0x6b7863,2.1));
    const sun=new THREE.DirectionalLight(0xfff5da,2);sun.position.set(-70,150,90);this.scene.add(sun);
    const mask=new THREE.DataTexture(new Uint8Array([0,0,255,255]),1,1);mask.needsUpdate=true;
    this.topMat=new THREE.ShaderMaterial({vertexShader:TERRAIN_VERT,fragmentShader:TERRAIN_FRAG,uniforms:{uMask:{value:mask},uLightDir:{value:new THREE.Vector3(-.55,.9,-.45).normalize()},uFocus:{value:0}}});
    this.home={target:new THREE.Vector3(0,3,0),position:new THREE.Vector3(-90,125,-160)};
    this.camera.position.copy(this.home.position);this.controls.target.copy(this.home.target);this.controls.update();
    this.chunks=[];this.markers=[];this.progress=0;this.crumble=0;this.crumbleTarget=0;this.active=null;
    this.routeGroup=new THREE.Group();this.scene.add(this.routeGroup);
    this.rider=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:0x23704b}));
    this.rider.visible=false;this.scene.add(this.rider);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(element);this.resize();
    this.last=performance.now();this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);
  }
  projection(){const w=this.element.clientWidth,h=this.element.clientHeight||1;const height=this.camera.position.distanceTo(this.controls.target)*.62*(w>700?1:1.45),width=height*w/h;const sx=w>700?width*180/w:0,sy=w>700?0:-height*.20;this.camera.left=-width/2+sx;this.camera.right=width/2+sx;this.camera.top=height/2+sy;this.camera.bottom=-height/2+sy;this.camera.updateProjectionMatrix();}
  resize(){const {width,height}=this.element.getBoundingClientRect();this.renderer.setSize(width,height);this.projection();}
  async init(entries){
    [this.region,this.beck]=await Promise.all([dataset('region'),dataset('beckwourth')]);
    const rb=this.region.bbox;const center=world((rb.west+rb.east)/2,(rb.south+rb.north)/2,1400);this.home.target.copy(center);this.home.position.copy(center).add(new THREE.Vector3(-75,105,-135).multiplyScalar(Math.max((rb.north-rb.south)*Z,(rb.east-rb.west)*X)/111.32));this.camera.position.copy(this.home.position);this.controls.target.copy(center);
    this.buildTerrain(this.region,16,false);
    this.detailTerrain=this.buildTerrain(this.beck,Math.max(this.beck.width,this.beck.height),true);this.detailTerrain.visible=false;
    this.setEntries(entries);
  }
  elevation(lon,lat){const b=this.beck.bbox;return sample(lon>=b.west&&lon<=b.east&&lat>=b.south&&lat<=b.north?this.beck:this.region,lon,lat);}
  buildTerrain(d,step,detail){
    const parent=new THREE.Group();this.scene.add(parent);
    const minBase=(detail?1350:150)/1000*EX;
    const wallMaterial=new THREE.ShaderMaterial({vertexShader:SIDE_VERT,fragmentShader:SIDE_FRAG,side:THREE.DoubleSide,uniforms:{uBase:{value:minBase*10},uLightDir:{value:new THREE.Vector3(-.55,.9,-.45).normalize()},uFocus:{value:0}}});
    const dx=(d.bbox.east-d.bbox.west)/(d.width-1)*X,dz=(d.bbox.north-d.bbox.south)/(d.height-1)*Z;
    const get=(i,j)=>d.data[clamp(j,0,d.height-1)*d.width+clamp(i,0,d.width-1)]/d.scale;
    for(let j0=0;j0<d.height-1;j0+=step)for(let i0=0;i0<d.width-1;i0+=step){
      const w=Math.min(step,d.width-1-i0)+1,h=Math.min(step,d.height-1-j0)+1;
      const lon=i=>d.bbox.west+i/(d.width-1)*(d.bbox.east-d.bbox.west),lat=j=>d.bbox.north-j/(d.height-1)*(d.bbox.north-d.bbox.south);
      const center=world(lon(i0+(w-1)/2),lat(j0+(h-1)/2));
      const g=new THREE.Group();g.position.copy(center);parent.add(g);
      const positions=[],normals=[],elevations=[],uv=[],indices=[];
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){
        const ii=i+i0,jj=j+j0,e=get(ii,jj),p=world(lon(ii),lat(jj),e).sub(center);
        positions.push(...p);elevations.push(e);uv.push(ii/(d.width-1),1-jj/(d.height-1));
        const norm=new THREE.Vector3(-(get(ii+1,jj)-get(ii-1,jj))/1000*EX/(2*dx),1,-(get(ii,jj+1)-get(ii,jj-1))/1000*EX/(2*dz)).normalize();normals.push(...norm);
        if(i<w-1&&j<h-1){const a=j*w+i;indices.push(a,a+w,a+1,a+1,a+w,a+w+1);}
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('aEle',new THREE.Float32BufferAttribute(elevations,1));geometry.setAttribute('aDepth',new THREE.Float32BufferAttribute(elevations.map(()=>0),1));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
      g.add(new THREE.Mesh(geometry,this.topMat));
      const sides=[],tops=[];
      function edge(a,b){const p=new THREE.Vector3(...positions.slice(a*3,a*3+3)),q=new THREE.Vector3(...positions.slice(b*3,b*3+3));const vertices=[p,q,new THREE.Vector3(p.x,minBase,p.z),q,new THREE.Vector3(q.x,minBase,q.z),new THREE.Vector3(p.x,minBase,p.z)];for(const v of vertices){sides.push(...v);tops.push(Math.max(p.y,q.y));}}
      for(let i=0;i<w-1;i++){edge(i+1,i);edge((h-1)*w+i,(h-1)*w+i+1);}for(let j=0;j<h-1;j++){edge(j*w,(j+1)*w);edge((j+1)*w+w-1,j*w+w-1);}
      const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(sides,3));wall.setAttribute('aTop',new THREE.Float32BufferAttribute(tops,1));wall.computeVertexNormals();const side=new THREE.Mesh(wall,wallMaterial);g.add(side);
      if(!detail)this.chunks.push({group:g,home:center.clone(),phase:Math.abs(Math.sin(i0*27.1+j0*19.8)),keep:false});
    }
    return parent;
  }
  setEntries(entries){
    this.entries=entries;this.markers.forEach(m=>m.element.remove());this.markers=[];
    const areas=new Map();for(const e of entries){if(!areas.has(e.area))areas.set(e.area,[]);areas.get(e.area).push(e);}
    for(const [area,rows] of areas){const lon=rows.reduce((s,e)=>s+e.coordinates.lng,0)/rows.length,lat=rows.reduce((s,e)=>s+e.coordinates.lat,0)/rows.length;
      const element=document.createElement('button');element.className='map-marker';element.textContent=area;
      const count=document.createElement('span');count.className='marker-count';count.textContent=rows.length;element.append(count);element.ariaLabel=`Explore ${rows.length} places in ${area}`;element.onclick=()=>this.onArea(area);this.labels.append(element);
      this.markers.push({element,area,position:world(lon,lat,sample(this.region,lon,lat)).add(new THREE.Vector3(0,2,0))});
    }
    const element=document.createElement('span');element.className='map-marker everstoke';element.textContent='EVERSTOKE';this.labels.append(element);
    this.markers.push({element,area:null,position:world(-120.6121166,39.780746,sample(this.region,-120.6121166,39.780746)).add(new THREE.Vector3(0,2,0))});
  }
  move(target,position,duration=2.1){this.tween={start:performance.now(),duration:this.reduced?.25:duration,fromZoom:this.camera.zoom,from:this.camera.position.clone(),fromTarget:this.controls.target.clone(),to:position.clone(),target:target.clone()};}
  async select(entry,track){
    this.pause();this.active=entry;this.track=track;this.progress=0;this.rider.visible=false;this.clearRoute();
    let center,span;
    if(track){
      this.points=track.geometry.coordinates.map(([lon,lat])=>world(lon,lat,this.elevation(lon,lat)).add(new THREE.Vector3(0,.014,0)));
      this.distances=[0];for(let i=1;i<this.points.length;i++)this.distances.push(this.distances[i-1]+Math.hypot((track.geometry.coordinates[i][0]-track.geometry.coordinates[i-1][0])*X,(track.geometry.coordinates[i][1]-track.geometry.coordinates[i-1][1])*Z));
      const box=new THREE.Box3().setFromPoints(this.points);center=box.getCenter(new THREE.Vector3());const size=box.getSize(new THREE.Vector3());span=Math.max(size.x,size.z,4);
      const positions=this.points.flatMap(p=>p.toArray());
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      const wideGeo=new LineGeometry();wideGeo.setPositions(positions);this.route=new Line2(wideGeo,new LineMaterial({color:0xedaa29,linewidth:3.375,depthTest:true}));this.routeGroup.add(this.route);
      this.completed=new THREE.Line(geo.clone(),new THREE.LineBasicMaterial({color:0xf4cb4c,depthTest:true}));this.completed.position.y=.004;this.completed.geometry.setDrawRange(0,0);this.routeGroup.add(this.completed);geo.dispose();
    }else{
      this.points=null;center=world(entry.coordinates.lng,entry.coordinates.lat,this.elevation(entry.coordinates.lng,entry.coordinates.lat));span=15;
    }
    // Use the detailed cutout only for the bundled, matching track; new uploads use the regional terrain.
    this.useDetail=entry.id==='beckwourth-peak'&&track?.properties.sourceUrl==='https://www.trailforks.com/ridelog/view/124349783/';
    if(this.useDetail){const a=world(this.beck.bbox.west,this.beck.bbox.north,this.beck.min),b=world(this.beck.bbox.east,this.beck.bbox.south,this.beck.max);center=a.clone().add(b).multiplyScalar(.5);span=Math.max(Math.abs(a.x-b.x),Math.abs(a.z-b.z));}
    this.focusCenter=center;this.focusSpan=span;
    this.detailTerrain.visible=this.useDetail;
    this.detailTerrain.scale.setScalar(1);
    for(const c of this.chunks)c.keep=!this.useDetail&&Math.hypot(c.home.x-center.x,c.home.z-center.z)<Math.max(span*.72,11);
    this.crumbleTarget=1;
    const distance=this.useDetail?span*1.6:Math.max(span*1.65,26);
    this.focusPose={target:center.clone(),position:center.clone().add(new THREE.Vector3(-distance*.45,distance*.48,-distance))};
    this.move(this.focusPose.target,this.focusPose.position,2.7);
  }
  clearRoute(){for(const c of [...this.routeGroup.children]){c.geometry.dispose();c.material.dispose();this.routeGroup.remove(c);}this.route=null;this.completed=null;}
  reset(){this.pause();this.active=null;this.points=null;this.track=null;this.rider.visible=false;this.clearRoute();this.crumbleTarget=0;this.move(this.home.target,this.home.position,2.5);}
  setProgress(f,show=true){if(!this.points)return;this.progress=clamp(f);const distance=this.distances.at(-1)*this.progress;let lo=0,hi=this.distances.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(this.distances[mid]<distance)lo=mid+1;else hi=mid;}const i=Math.max(1,lo),t=(distance-this.distances[i-1])/(this.distances[i]-this.distances[i-1]||1);this.rider.position.copy(this.points[i-1]).lerp(this.points[i],clamp(t));this.rider.visible=show;this.completed?.geometry.setDrawRange(0,i+1);this.onProgress?.(this.progress);}
  play(){if(!this.points)return;if(this.progress>=.999)this.setProgress(0);this.playing=true;this.playStartProgress=this.progress;this.playStarted=performance.now();this.followStart=this.followPose(this.progress);this.move(this.followStart.target,this.followStart.position,2);}
  pause(){this.playing=false;}
  followPose(f){const angle=.5+f*.55,span=this.focusSpan*1.65;return {target:this.focusCenter.clone(),position:this.focusCenter.clone().add(new THREE.Vector3(-Math.sin(angle)*span,span*.48,-Math.cos(angle)*span))};}
  north(){this.pause();this.onManual?.();const offset=this.camera.position.clone().sub(this.controls.target),radius=offset.length();if(Math.abs(Math.atan2(offset.x,offset.z))<.02){const pose=this.active?this.focusPose:this.home;this.move(pose.target,pose.position,1.5);}else this.move(this.controls.target,this.controls.target.clone().add(new THREE.Vector3(0,radius*.68,radius*.733)),1.5);}
  control(action,dt){this.tween=null;if(this.playing){this.pause();this.onManual?.();}const offset=this.camera.position.clone().sub(this.controls.target);if(action==='left'||action==='right')offset.applyAxisAngle(new THREE.Vector3(0,1,0),(action==='left'?1:-1)*dt*.8);else{const spherical=new THREE.Spherical().setFromVector3(offset);spherical.phi=clamp(spherical.phi+(action==='up'?-1:1)*dt*.6,.55,1.35);offset.setFromSpherical(spherical);}this.camera.position.copy(this.controls.target).add(offset);}
  frame(now){requestAnimationFrame(this.frame);const dt=Math.min((now-this.last)/1000,.05);this.last=now;
    const speed=this.reduced?8:.57;this.crumble+=Math.sign(this.crumbleTarget-this.crumble)*Math.min(Math.abs(this.crumbleTarget-this.crumble),dt*speed);
    if(this.region){
      for(const c of this.chunks){const a=c.keep?0:ease(clamp((this.crumble-c.phase*.22)/.78));c.group.visible=a<.995;c.group.position.copy(c.home);c.group.position.y=-a*(85+c.phase*40);c.group.rotation.set(a*.3*(c.phase-.5),a*.12,a*.3*(.5-c.phase));c.group.scale.setScalar(1-a*.75);}
      if(!this.active&&this.crumble<.02)this.detailTerrain.visible=false;
    }
    if(this.held)this.control(this.held,dt);
    if(this.tween){const t=this.tween,p=clamp((now-t.start)/1000/t.duration),s=ease(p);this.camera.zoom=THREE.MathUtils.lerp(t.fromZoom,1,s);this.camera.position.lerpVectors(t.from,t.to,s);this.controls.target.lerpVectors(t.fromTarget,t.target,s);if(p>=1)this.tween=null;}
    if(this.playing){
      const elapsed=(now-this.playStarted)/1000;
      // Ease into the orbit and progress during the end of the camera approach.
      const running=Math.max(0,elapsed-1.4),ramp=.8;
      const effective=running<ramp?running*running/(2*ramp):running-ramp/2;
      const f=clamp(this.playStartProgress+effective/45);this.setProgress(f);
      if(!this.tween){const pose=this.followPose(f),s=1-Math.exp(-dt*2.2);this.camera.position.lerp(pose.position,s);this.controls.target.lerp(pose.target,s);}
      if(f>=1){this.pause();this.onEnd?.();}
    }
    this.controls.update();this.projection();
    const needle=document.querySelector('#compass-needle');if(needle){const delta=this.camera.position.clone().sub(this.controls.target);needle.style.transform=`rotate(${Math.atan2(delta.x,delta.z)}rad)`;}
    const boxes=[];
    for(const marker of this.markers){
      if(this.active){marker.element.style.display='none';continue;}
      const p=marker.position.clone().project(this.camera);const w=this.element.clientWidth,h=this.element.clientHeight,x=(p.x*.5+.5)*w,y=(-p.y*.5+.5)*h;
      const visible=p.z>-1&&p.z<1&&x>20&&x<w-20&&y>45&&y<h-85;
      const width=marker.element.offsetWidth||90;const rect={x:x-width/2,y:y-25,w:width,h:32};const overlap=boxes.some(b=>rect.x<b.x+b.w&&rect.x+rect.w>b.x&&rect.y<b.y+b.h&&rect.y+rect.h>b.y);
      marker.element.style.display=visible&&!overlap?'flex':'none';marker.element.style.left=`${x}px`;marker.element.style.top=`${y}px`;if(visible&&!overlap)boxes.push(rect);
    }
    this.renderer.render(this.scene,this.camera);
  }
}
