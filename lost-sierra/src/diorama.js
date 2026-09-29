import * as THREE from 'three';
import {overviewRouteColor} from './overview-route-colors.js';
import {OverviewRouteStripes} from './overview-route-stripes.js';
import { TERRAIN_VERT, TERRAIN_FRAG, SIDE_VERT, SIDE_FRAG } from './terrain-shaders.js';
THREE.ColorManagement.enabled=false;
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { roadEdgePoint } from '../../src/ride-context-data.ts';
const D2R=Math.PI/180, X=111.32*Math.cos(39.835*D2R), Z=111.32, EX=2.3;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=t=>t*t*t*(t*(t*6-15)+10);
function world(lon,lat,e=0){return new THREE.Vector3((lon+120.6)*X,e/1000*EX,(39.835-lat)*Z);}
async function dataset(name){const [meta,buffer]=await Promise.all([fetch(`/terrain/${name}.json`).then(r=>{if(!r.ok)throw Error('Terrain unavailable');return r.json();}),fetch(`/terrain/${name}.bin`).then(r=>{if(!r.ok)throw Error('Terrain unavailable');return r.arrayBuffer();})]);return {...meta,data:new Uint16Array(buffer)};}
function sample(d,lon,lat){const xx=clamp((lon-d.bbox.west)/(d.bbox.east-d.bbox.west))*(d.width-1),yy=clamp((d.bbox.north-lat)/(d.bbox.north-d.bbox.south))*(d.height-1),x=Math.min(Math.floor(xx),d.width-2),y=Math.min(Math.floor(yy),d.height-2),u=xx-x,v=yy-y,a=d.data[y*d.width+x],b=d.data[y*d.width+x+1],c=d.data[(y+1)*d.width+x],e=d.data[(y+1)*d.width+x+1];return (a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+e*u*v)/d.scale;}
// Match the overview mesh's triangle surfaces so the route stays on the ground.
function surfaceElevation(d,lon,lat){
  const gx=clamp((lon-d.bbox.west)/(d.bbox.east-d.bbox.west))*(d.width-1),gy=clamp((d.bbox.north-lat)/(d.bbox.north-d.bbox.south))*(d.height-1);
  const x=Math.min(Math.floor(gx),d.width-2),y=Math.min(Math.floor(gy),d.height-2),u=gx-x,v=gy-y;
  const a=d.data[y*d.width+x],b=d.data[y*d.width+x+1],c=d.data[(y+1)*d.width+x],e=d.data[(y+1)*d.width+x+1];
  return (u+v<=1?a+(b-a)*u+(c-a)*v:e+(c-e)*(1-u)+(b-e)*(1-v))/d.scale;
}
export class Diorama {
  constructor(element,labels,{onArea,onRide}) {
    Object.assign(this,{element,labels,onArea,onRide});
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
    this.controls.addEventListener('start',()=>{this.tween=null;});
    this.scene.add(new THREE.HemisphereLight(0xf6f2e2,0x6b7863,2.1));
    const sun=new THREE.DirectionalLight(0xfff5da,2);sun.position.set(-70,150,90);this.scene.add(sun);
    const mask=new THREE.DataTexture(new Uint8Array([0,0,255,255]),1,1);mask.needsUpdate=true;
    this.topMat=new THREE.ShaderMaterial({vertexShader:TERRAIN_VERT,fragmentShader:TERRAIN_FRAG,uniforms:{uMask:{value:mask},uLightDir:{value:new THREE.Vector3(-.55,.9,-.45).normalize()},uFocus:{value:0}}});
    this.home={target:new THREE.Vector3(0,3,0),position:new THREE.Vector3(-90,125,-160)};
    this.camera.position.copy(this.home.position);this.controls.target.copy(this.home.target);this.controls.update();
    this.chunks=[];this.markers=[];this.crumble=0;this.crumbleTarget=0;this.active=null;
    this.rivers=new THREE.Group();this.scene.add(this.rivers);this.riverMarkers=[];
    this.highways=new THREE.Group();this.scene.add(this.highways);this.highwayMarkers=[];
    this.overviewRoute=new THREE.Group();this.scene.add(this.overviewRoute);
    this.overviewNetwork=new OverviewRouteStripes();this.scene.add(this.overviewNetwork.group);
    this.setupRoutePopup();
    this.routeGroup=new THREE.Group();this.scene.add(this.routeGroup);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(element);this.resize();
    this.last=performance.now();this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);
  }
  projection(){const w=this.element.clientWidth,h=this.element.clientHeight||1;const height=this.camera.position.distanceTo(this.controls.target)*.62*(w>700?1:1.45),width=height*w/h;const sx=w>700?width*180/w:0,sy=w>700?0:-height*.20;this.camera.left=-width/2+sx;this.camera.right=width/2+sx;this.camera.top=height/2+sy;this.camera.bottom=-height/2+sy;this.camera.updateProjectionMatrix();}
  resize(){const {width,height}=this.element.getBoundingClientRect();this.renderer.setSize(width,height);this.projection();}
  async init(entries,savedHome){
    [this.region,this.beck,this.lakeWater]=await Promise.all([dataset('region'),dataset('beckwourth'),
      fetch('/terrain/lake-davis-loop/terrain.json').then(r=>{if(!r.ok)throw Error('Lake shoreline unavailable');return r.json();}).then(meta=>meta.waterbodies||[]).catch(error=>{console.warn(error);return [];})]);
    const rb=this.region.bbox;const center=world((rb.west+rb.east)/2,(rb.south+rb.north)/2,1400);this.home.target.copy(center);this.home.position.copy(center).add(new THREE.Vector3(-75,105,-135).multiplyScalar(Math.max((rb.north-rb.south)*Z,(rb.east-rb.west)*X)/111.32));this.camera.position.copy(this.home.position);this.controls.target.copy(center);
    this.overviewTerrain=this.buildTerrain(this.region,16,false);
    this.detailTerrain=this.buildTerrain(this.beck,Math.max(this.beck.width,this.beck.height),true);this.detailTerrain.visible=false;
    if(savedHome)this.setHome(savedHome);
    this.camera.position.copy(this.home.position);this.controls.target.copy(this.home.target);this.camera.zoom=this.home.zoom||1;this.controls.update();this.projection();
    this.setEntries(entries);
    await Promise.all([this.loadHighways(),this.loadRiver(),...entries.filter(entry=>entry.hasTrack).map(entry=>this.loadOverviewRoute(entry))]);
    this.overviewRoutesReady=true;this.rebuildOverviewRoutes();
  }
  async loadRiver(){
    try{
      const response=await fetch('/terrain/feather-river.geojson');if(!response.ok)throw Error('River data unavailable');
      const data=await response.json(),segments=[];
      const point=(lon,lat)=>world(lon,lat,surfaceElevation(this.region,lon,lat)).add(new THREE.Vector3(0,.006,0));
      for(const feature of data.features){
        const coordinates=feature.geometry.coordinates;
        for(let i=0;i<coordinates.length-1;i++){
          const a=coordinates[i],b=coordinates[i+1],steps=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*X,(b[1]-a[1])*Z)/.025));
          let previous=point(...a);
          for(let j=1;j<=steps;j++){
            const t=j/steps,next=point(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);
            segments.push(...previous,...next);previous=next;
          }
        }
      }
      // Batch the individual NHD reaches into two draws, preserving gaps between branches.
      for(const [color,width,order] of [[0xb6c8c8,4.5,6],[0x78999f,2.6,7]]){
        const geometry=new LineSegmentsGeometry();geometry.setPositions(segments);
        const line=new LineSegments2(geometry,new LineMaterial({color,linewidth:width,transparent:true,opacity:.82,depthTest:true,depthWrite:false}));
        line.renderOrder=order;line.frustumCulled=false;this.rivers.add(line);
      }
    }catch(error){console.warn('Could not show the Feather River:',error);}
  }
  async loadHighways(){
    try{
      const response=await fetch('/terrain/highways.geojson');if(!response.ok)throw Error('Highway data unavailable');
      const data=await response.json();
      for(const feature of data.features){
        const coordinates=feature.geometry.coordinates,positions=[];
        const add=(lon,lat)=>positions.push(...world(lon,lat,surfaceElevation(this.region,lon,lat)).add(new THREE.Vector3(0,.009,0)));
        for(let i=0;i<coordinates.length-1;i++){
          const a=coordinates[i],b=coordinates[i+1],steps=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*X,(b[1]-a[1])*Z)/.025));
          for(let j=0;j<steps;j++){const t=j/steps;add(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}
        }
        add(...coordinates.at(-1));
        for(const [color,width,order] of [[0xf8f2e4,3.8,10],[0x777d74,1.7,11]]){
          const geometry=new LineGeometry();geometry.setPositions(positions);
          const line=new Line2(geometry,new LineMaterial({color,linewidth:width,transparent:true,opacity:.92,depthTest:true,depthWrite:false}));
          line.renderOrder=order;line.frustumCulled=false;this.highways.add(line);
        }
      }
      for(const label of data.labels){
        const [lon,lat]=label.coordinates,element=document.createElement('span');
        element.className='map-marker highway-marker';element.setAttribute('aria-label',`Highway ${label.route}`);
        // California G28-2 marker: domed shield, green field, white border and legend.
        const arcId=`highway-legend-${this.highwayMarkers.length}`;
        element.innerHTML=`<svg viewBox="0 0 100 104" aria-hidden="true"><defs><path id="${arcId}" d="M17 42 Q50 23 83 42"/></defs><path d="M50 3 C26 7 4 32 4 65 L4 85 Q4 96 16 98 Q50 104 84 98 Q96 96 96 85 L96 65 C96 32 74 7 50 3Z" fill="#006b42" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><text fill="#fff" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing=".4"><textPath href="#${arcId}" startOffset="50%" text-anchor="middle">CALIFORNIA</textPath></text><text x="50" y="88" fill="#fff" font-family="Arial, sans-serif" font-size="55" font-weight="600" letter-spacing="-2" text-anchor="middle">${label.route}</text></svg>`;this.labels.append(element);
        this.highwayMarkers.push({element,position:world(lon,lat,surfaceElevation(this.region,lon,lat)).add(new THREE.Vector3(0,.4,0))});
      }
      // Town directions belong at the highway's actual terrain-boundary crossing.
      for(const [route,name,axis,direction] of [[49,'To Nevada City',1,-1],[70,'To Reno',0,1],[89,'To Truckee',1,-1],[89,'To Susanville',1,1]]){
        const lines=data.features.filter(feature=>feature.properties.route===route).map(feature=>feature.geometry.coordinates);
        const exit=roadEdgePoint(lines,this.region.bbox,axis,direction);if(!exit)continue;
        const [lon,lat]=exit;
        const element=document.createElement('span');element.className='map-marker highway-destination';element.textContent=name;
        this.labels.append(element);
        this.highwayMarkers.push({element,destination:true,position:world(lon,lat,surfaceElevation(this.region,lon,lat)).add(new THREE.Vector3(0,.4,0))});
      }
    }catch(error){console.warn('Could not show the overview highways:',error);}
  }
  setupRoutePopup(){
    const canvas=this.renderer.domElement,popup=document.createElement('a');
    popup.className='map-marker overview-route-popup';popup.hidden=true;
    this.element.parentElement.append(popup);this.routePopup=popup;
    const raycaster=new THREE.Raycaster();raycaster.params.Line2={threshold:9};this.routeRaycaster=raycaster;
    const scheduleHide=()=>{clearTimeout(this.routePopupTimer);this.routePopupTimer=setTimeout(()=>{if(!popup.matches(':hover')&&!popup.contains(document.activeElement))this.hideRoutePopup();},250);};
    canvas.addEventListener('pointermove',event=>{
      if(event.buttons){if(this.routePress&&Math.hypot(event.clientX-this.routePress.x,event.clientY-this.routePress.y)>6)this.routePress.dragged=true;this.hideRoutePopup();return;}
      this.routePointer={x:event.clientX,y:event.clientY};
    });
    canvas.addEventListener('pointerleave',()=>{this.routePointer=null;scheduleHide();});
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      const hit=this.hitOverviewRoute(event.clientX,event.clientY);
      this.routePress=hit?{x:event.clientX,y:event.clientY,open:!popup.hidden&&this.overviewRouteEntry===hit.entry.id,entryId:hit.entry.id,dragged:false}:null;
      if(hit)this.showRoutePopup(hit);else this.hideRoutePopup();
    });
    canvas.addEventListener('pointerup',event=>{
      const press=this.routePress;this.routePress=null;
      if(!press||press.dragged||Math.hypot(event.clientX-press.x,event.clientY-press.y)>6)return;
      const hit=this.hitOverviewRoute(event.clientX,event.clientY);if(!hit||hit.entry.id!==press.entryId)return;
      if(press.open){this.hideRoutePopup();this.onRide?.(hit.entry.id);}else this.showRoutePopup(hit);
    });
    canvas.addEventListener('pointercancel',()=>{this.routePress=null;this.hideRoutePopup();});
    canvas.addEventListener('wheel',()=>this.hideRoutePopup(),{passive:true});
    popup.addEventListener('pointerenter',()=>clearTimeout(this.routePopupTimer));
    popup.addEventListener('pointerleave',scheduleHide);
    popup.addEventListener('focus',()=>clearTimeout(this.routePopupTimer));
    popup.addEventListener('blur',scheduleHide);
    popup.addEventListener('keydown',event=>{if(event.key==='Escape')this.hideRoutePopup();});
    popup.addEventListener('click',event=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();this.hideRoutePopup();this.onRide?.(this.overviewRouteEntry);
    });
    this.controls.addEventListener('start',()=>{this.routePointer=null;});
  }
  hitOverviewRoute(x,y){
    if(this.suspended||this.active||!this.overviewRoute.visible||!this.overviewRoute.children.length)return null;
    const rect=this.renderer.domElement.getBoundingClientRect();
    const raycaster=this.routeRaycaster;raycaster.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),this.camera);
    const lines=this.overviewRoute.children.filter(group=>group.visible).map(group=>group.children.at(-1));
    // Hidden original lines still provide exact route picking beneath the shared network.
    for(const line of lines)line.material.resolution.set(rect.width,rect.height);
    const hit=raycaster.intersectObjects(lines,false)[0];if(!hit)return null;
    const point=hit.pointOnLine||hit.point;
    // Match terrain occlusion: a route behind a mountain cannot trigger a popup.
    const projected=point.clone().project(this.camera);raycaster.setFromCamera(new THREE.Vector2(projected.x,projected.y),this.camera);
    const ground=raycaster.intersectObject(this.overviewTerrain,true)[0];
    if(ground&&ground.distance+.025<point.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction))return null;
    return hit.object.parent.userData;
  }
  showRoutePopup(route){
    this.mapHoveredRoute=route.entry.id;this.highlightOverviewRoute(route.entry.id);
    this.overviewRouteEntry=route.entry.id;this.routeLabelAnchor=route.anchor;
    this.routePopup.href=`/?ride=${encodeURIComponent(route.entry.id)}`;
    this.routePopup.textContent=route.entry.name;
    this.routePopup.setAttribute('aria-label',`Explore ${route.entry.name}`);
    clearTimeout(this.routePopupTimer);this.routePopupTimer=null;this.routePopupPoint=this.routeLabelAnchor;this.routePopup.hidden=false;
    this.renderer.domElement.style.cursor='pointer';this.positionRoutePopup();
  }
  hideRoutePopup(){
    if(this.mapHoveredRoute&&this.highlightedOverview===this.mapHoveredRoute)this.highlightOverviewRoute(null);
    this.mapHoveredRoute=null;
    clearTimeout(this.routePopupTimer);this.routePopupTimer=null;this.routePopup.hidden=true;this.routePopupPoint=null;this.routePointer=null;
    this.renderer.domElement.style.cursor='';
  }
  positionRoutePopup(){
    if(!this.routePopupPoint)return;
    const p=this.routePopupPoint.clone().project(this.camera),w=this.element.clientWidth,h=this.element.clientHeight;
    this.routePopup.style.left=`${(p.x*.5+.5)*w}px`;
    // The map-marker stem is 15 CSS pixels long. Its tip, not the label box,
    // must land on the projected route start at every zoom and camera angle.
    this.routePopup.style.top=`${(-.5*p.y+.5)*h-15}px`;
  }
  async loadOverviewRoute(entry){
    try{
      const response=await fetch(`/api/tracks/${entry.id}`);
      if(!response.ok)throw Error('Overview route unavailable');
      const track=await response.json(),coordinates=track.geometry.coordinates,positions=[];
      const add=(lon,lat)=>positions.push(...world(lon,lat,surfaceElevation(this.region,lon,lat)).add(new THREE.Vector3(0,.012,0)));
      for(let i=0;i<coordinates.length-1;i++){
        const a=coordinates[i],b=coordinates[i+1];
        const steps=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*X,(b[1]-a[1])*Z)/.025));
        for(let j=0;j<steps;j++){const t=j/steps;add(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}
      }
      add(...coordinates.at(-1));
      const group=new THREE.Group();
      for(const [color,width,order] of [[0xfff9df,5.25,20],[overviewRouteColor(entry.id),3.375,21]]){
        const geometry=new LineGeometry();geometry.setPositions(positions);
        const line=new Line2(geometry,new LineMaterial({color,linewidth:width,transparent:true,opacity:.99,depthTest:true,depthWrite:false}));
        line.renderOrder=order;line.frustumCulled=false;group.add(line);
      }
      // Each route owns its start anchor and geometry; filters affect them separately.
      group.userData={entry,positions,anchor:new THREE.Vector3(...positions.slice(0,3))};
      this.overviewRoute.add(group);
    }catch(error){console.warn(`Could not show ${entry.name} on the overview:`,error);}
  }
  elevation(lon,lat){const b=this.beck.bbox;return sample(lon>=b.west&&lon<=b.east&&lat>=b.south&&lat<=b.north?this.beck:this.region,lon,lat);}
  buildTerrain(d,step,detail){
    const parent=new THREE.Group();this.scene.add(parent);
    const topMaterial=detail?this.topMat:this.topMat.clone();
    if(!detail){
      // Paint the mapped shoreline directly into the terrain so water follows
      // the same occlusion and crumble animation, including its island holes.
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;
      const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(0,0,255)';ctx.fillRect(0,0,2048,2048);
      ctx.fillStyle='rgb(255,110,255)';
      for(const lake of this.lakeWater||[]){
        ctx.beginPath();
        for(const ring of lake.rings){
          ring.forEach(([lon,lat],i)=>{
            const x=(lon-d.bbox.west)/(d.bbox.east-d.bbox.west)*2048,y=(d.bbox.north-lat)/(d.bbox.north-d.bbox.south)*2048;
            if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
          });ctx.closePath();
        }
        ctx.fill('evenodd');
      }
      const mask=new THREE.CanvasTexture(canvas);
      topMaterial.uniforms.uMask.value=mask;
    }
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
      g.add(new THREE.Mesh(geometry,topMaterial));
      const sides=[],tops=[];
      function edge(a,b){const p=new THREE.Vector3(...positions.slice(a*3,a*3+3)),q=new THREE.Vector3(...positions.slice(b*3,b*3+3));const vertices=[p,q,new THREE.Vector3(p.x,minBase,p.z),q,new THREE.Vector3(q.x,minBase,q.z),new THREE.Vector3(p.x,minBase,p.z)];for(const v of vertices){sides.push(...v);tops.push(Math.max(p.y,q.y));}}
      for(let i=0;i<w-1;i++){edge(i+1,i);edge((h-1)*w+i,(h-1)*w+i+1);}for(let j=0;j<h-1;j++){edge(j*w,(j+1)*w);edge((j+1)*w+w-1,j*w+w-1);}
      const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(sides,3));wall.setAttribute('aTop',new THREE.Float32BufferAttribute(tops,1));wall.computeVertexNormals();const side=new THREE.Mesh(wall,wallMaterial);g.add(side);
      if(!detail)this.chunks.push({group:g,home:center.clone(),phase:Math.abs(Math.sin(i0*27.1+j0*19.8)),keep:false});
    }
    return parent;
  }
  highlightOverviewRoute(id){
    this.highlightedOverview=id;
    const selected=this.overviewRoute.children.find(group=>group.userData.entry.id===id);
    this.overviewNetwork?.setDimmed(!!selected);
    for(const group of this.overviewRoute.children){
      const highlighted=group===selected;
      const [halo,line]=group.children;
      halo.material.linewidth=highlighted?8:5.25;
      line.material.linewidth=highlighted?5:3.375;
      line.material.color.set(overviewRouteColor(group.userData.entry.id));
      for(const [index,stroke] of group.children.entries()){
        stroke.material.visible=!this.overviewRoutesReady||highlighted;
        stroke.material.opacity=selected&&!highlighted ? .3 : .99;
        stroke.renderOrder=highlighted?22+index:20+index;
      }
    }
  }
  rebuildOverviewRoutes(){
    if(!this.overviewRoutesReady)return;
    const visible=new Set(this.entries.map(entry=>entry.id));
    this.overviewNetwork.setRoutes(this.overviewRoute.children.filter(group=>visible.has(group.userData.entry.id)).map(group=>({id:group.userData.entry.id,positions:group.userData.positions})));
    this.highlightOverviewRoute(null);
  }
  setEntries(entries){
    this.highlightOverviewRoute(null);
    this.entries=entries;this.markers.forEach(m=>m.element.remove());this.markers=[];
    this.rebuildOverviewRoutes();
    const areas=new Map();for(const e of entries){if(!areas.has(e.area))areas.set(e.area,[]);areas.get(e.area).push(e);}
    for(const [area,rows] of areas){
      if(rows.length<2)continue;
      const lon=rows.reduce((s,e)=>s+e.coordinates.lng,0)/rows.length,lat=rows.reduce((s,e)=>s+e.coordinates.lat,0)/rows.length;
      const element=document.createElement('button');element.className='map-marker';element.textContent=area;
      const count=document.createElement('span');count.className='marker-count';count.textContent=rows.length;element.append(count);element.ariaLabel=`Explore ${rows.length} places in ${area}`;element.onclick=()=>this.onArea(area);this.labels.append(element);
      this.markers.push({element,area,position:world(lon,lat,sample(this.region,lon,lat)).add(new THREE.Vector3(0,2,0))});
    }
    const element=document.createElement('a');element.className='map-marker';element.textContent='Everstoke';element.href='https://everstoke.bike/';element.target='_blank';element.rel='noopener noreferrer';element.setAttribute('aria-label','Everstoke (opens in a new tab)');this.labels.append(element);
    this.markers.push({element,area:null,position:world(-120.6121166,39.780746,sample(this.region,-120.6121166,39.780746)).add(new THREE.Vector3(0,2,0))});
  }
  move(target,position,duration=2.1,zoom=1){this.tween={zoom,start:performance.now(),duration:this.reduced?.25:duration,fromZoom:this.camera.zoom,from:this.camera.position.clone(),fromTarget:this.controls.target.clone(),to:position.clone(),target:target.clone()};}
  rideAnchor(map){
    const metersLon=111320*Math.cos((map.bbox.south+map.bbox.north)*Math.PI/360);
    return world(map.bbox.west+map.widthM/2/metersLon,map.bbox.south+map.heightM/2/111320,1898);
  }
  rideEntryView(map,viewScale=1){
    // Match the current regional framing in the ride's local-meter coordinates.
    const anchor=this.rideAnchor(map);
    const shift=new THREE.Vector3((this.camera.left+this.camera.right)/2,(this.camera.top+this.camera.bottom)/2,0).applyQuaternion(this.camera.quaternion);
    const convert=point=>point.clone().add(shift).sub(anchor).multiplyScalar(10).toArray();
    return {position:convert(this.camera.position),target:convert(this.controls.target),zoom:58*viewScale*this.camera.zoom/((this.camera.top-this.camera.bottom)*10)};
  }
  rideContext(map){
    // Borrow regional geometry in the shared ride scene. Both landscapes are
    // now projected by one camera, so the crumble cannot drift behind a fade.
    const anchor=this.rideAnchor(map),group=new THREE.Group(),materials=[];let disposed=false;
    group.scale.setScalar(10);group.position.copy(anchor).multiplyScalar(-10);
    const pieces=this.chunks.map(chunk=>{
      const copy=chunk.group.clone(true);group.add(copy);
      const fade={value:1};
      copy.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const source=mesh.material,material=source.clone();materials.push(material);mesh.material=material;
        if(source.uniforms.uMask)material.uniforms.uMask.value=source.uniforms.uMask.value;
        // Keep the regional watercolor texture fixed when changing origins.
        material.uniforms.uRideAnchor={value:anchor.clone().multiplyScalar(10)};
        material.vertexShader='uniform vec3 uRideAnchor;\n'+material.vertexShader.replace('vWorld = world.xyz * 10.0;','vWorld = world.xyz + uRideAnchor;');
        material.uniforms.uDeparture=fade;
        material.fragmentShader='uniform float uDeparture;\n'+material.fragmentShader.replace(/}\s*$/, 'gl_FragColor.a *= uDeparture;\n}');
        material.transparent=true;material.depthWrite=true;
      });
      const bounds=new THREE.Box3().setFromObject(chunk.group);
      const a=world(map.bbox.west,map.bbox.north),b=world(map.bbox.east,map.bbox.south);
      const overlaps=bounds.max.x>=a.x&&bounds.min.x<=b.x&&bounds.max.z>=a.z&&bounds.min.z<=b.z;
      return {copy,fade,overlaps,home:copy.position.clone(),phase:chunk.phase};
    });
    return {group,
      update(progress){
        // Local chunks dissolve in place into detailed terrain; only the
        // surrounding landscape drops. No falling block cuts through the ride.
        for(const p of pieces){
          const t=ease(clamp((progress-(p.overlaps?0:p.phase*.12))/(p.overlaps?.22:.62)));
          p.fade.value=1-t;p.copy.visible=t<1;
          if(!p.overlaps){p.copy.position.y=p.home.y-t*(12+p.phase*8);p.copy.rotation.x=t*.12*(p.phase-.5);}
        }
      },
      dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const material of materials)material.dispose();},
    };
  }
  async select(entry,track,animate=true){
    this.active=entry;this.track=track;this.clearRoute();
    let center,span;
    if(track){
      this.points=track.geometry.coordinates.map(([lon,lat])=>world(lon,lat,this.elevation(lon,lat)).add(new THREE.Vector3(0,.014,0)));
      const box=new THREE.Box3().setFromPoints(this.points);center=box.getCenter(new THREE.Vector3());const size=box.getSize(new THREE.Vector3());span=Math.max(size.x,size.z,4);
      const positions=this.points.flatMap(p=>p.toArray());
      const wideGeo=new LineGeometry();wideGeo.setPositions(positions);this.route=new Line2(wideGeo,new LineMaterial({color:0xedaa29,linewidth:3.375,depthTest:true}));this.routeGroup.add(this.route);

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
    if(animate)this.move(this.focusPose.target,this.focusPose.position,2.7);
    else{
      this.tween=null;this.crumble=1;this.camera.zoom=1;
      this.camera.position.copy(this.focusPose.position);this.controls.target.copy(this.focusPose.target);
      this.controls.update();this.projection();
    }
  }
  clearRoute(){for(const c of [...this.routeGroup.children]){c.geometry.dispose();c.material.dispose();this.routeGroup.remove(c);}this.route=null;}
  captureHome(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),zoom:this.camera.zoom};}
  setHome(home){this.home={position:new THREE.Vector3(...home.position),target:new THREE.Vector3(...home.target),zoom:home.zoom};}
  reset(animate=true){
    this.active=null;this.points=null;this.track=null;this.clearRoute();this.crumbleTarget=0;
    if(animate){this.move(this.home.target,this.home.position,2.5,this.home.zoom||1);return;}
    // Prepare an exact home frame underneath the ride's return animation.
    this.tween=null;this.crumble=0;this.held=null;
    this.camera.position.copy(this.home.position);this.controls.target.copy(this.home.target);this.camera.zoom=this.home.zoom||1;
    for(const chunk of this.chunks){chunk.group.visible=true;chunk.group.position.copy(chunk.home);chunk.group.rotation.set(0,0,0);chunk.group.scale.setScalar(1);}
    this.detailTerrain.visible=false;this.highways.visible=true;this.rivers.visible=true;this.overviewRoute.visible=true;
    this.overviewNetwork.group.visible=true;
    for(const group of this.overviewRoute.children)group.visible=this.entries?.some(entry=>entry.id===group.userData.entry.id);
    this.controls.update();this.projection();this.overviewNetwork.update(this.camera,this.element.clientWidth,this.element.clientHeight);this.renderer.render(this.scene,this.camera);
  }
  north(){const offset=this.camera.position.clone().sub(this.controls.target),radius=offset.length();if(Math.abs(Math.atan2(offset.x,offset.z))<.02){const pose=this.active?this.focusPose:this.home;this.move(pose.target,pose.position,1.5,pose.zoom||1);}else this.move(this.controls.target,this.controls.target.clone().add(new THREE.Vector3(0,radius*.68,radius*.733)),1.5);}
  control(action,dt){this.tween=null;const offset=this.camera.position.clone().sub(this.controls.target);if(action==='left'||action==='right')offset.applyAxisAngle(new THREE.Vector3(0,1,0),(action==='left'?1:-1)*dt*.8);else{const spherical=new THREE.Spherical().setFromVector3(offset);spherical.phi=clamp(spherical.phi+(action==='up'?-1:1)*dt*.6,.55,1.35);offset.setFromSpherical(spherical);}this.camera.position.copy(this.controls.target).add(offset);}
  frame(now){requestAnimationFrame(this.frame);const dt=Math.min((now-this.last)/1000,.05);this.last=now;
    if(this.suspended){this.hideRoutePopup();return;}
    const speed=this.reduced?8:.57;this.crumble+=Math.sign(this.crumbleTarget-this.crumble)*Math.min(Math.abs(this.crumbleTarget-this.crumble),dt*speed);
    this.highways.visible=!this.active&&this.crumble<.02;this.rivers.visible=this.highways.visible;
    this.overviewRoute.visible=!this.active&&this.crumble<.02;
    this.overviewNetwork.group.visible=this.overviewRoute.visible;
    for(const group of this.overviewRoute.children)group.visible=this.entries?.some(entry=>entry.id===group.userData.entry.id);
    if(!this.routePopup.hidden&&!this.entries?.some(entry=>entry.id===this.overviewRouteEntry))this.hideRoutePopup();
    if(this.region){
      for(const c of this.chunks){const a=c.keep?0:ease(clamp((this.crumble-c.phase*.22)/.78));c.group.visible=a<.995;c.group.position.copy(c.home);c.group.position.y=-a*(85+c.phase*40);c.group.rotation.set(a*.3*(c.phase-.5),a*.12,a*.3*(.5-c.phase));c.group.scale.setScalar(1-a*.75);}
      if(!this.active&&this.crumble<.02)this.detailTerrain.visible=false;
    }
    if(this.held)this.control(this.held,dt);
    if(this.tween){const t=this.tween,p=clamp((now-t.start)/1000/t.duration),s=ease(p);this.camera.zoom=THREE.MathUtils.lerp(t.fromZoom,t.zoom,s);this.camera.position.lerpVectors(t.from,t.to,s);this.controls.target.lerpVectors(t.fromTarget,t.target,s);if(p>=1)this.tween=null;}
    this.controls.update();this.projection();
    if(this.overviewNetwork.group.visible)this.overviewNetwork.update(this.camera,this.element.clientWidth,this.element.clientHeight);
    if(!this.overviewRoute.visible||this.held||this.tween)this.hideRoutePopup();
    else if(this.routePointer){
      const pointer=this.routePointer;this.routePointer=null;const hit=this.hitOverviewRoute(pointer.x,pointer.y);
      if(hit)this.showRoutePopup(hit);
      else if(!this.routePopup.hidden&&!this.routePopupTimer)this.routePopupTimer=setTimeout(()=>{this.routePopupTimer=null;if(!this.routePopup.matches(':hover')&&!this.routePopup.contains(document.activeElement))this.hideRoutePopup();},250);
    }
    if(!this.routePopup.hidden)this.positionRoutePopup();
    const needle=document.querySelector('#compass-needle');if(needle){const delta=this.camera.position.clone().sub(this.controls.target);needle.style.transform=`rotate(${Math.atan2(delta.x,delta.z)}rad)`;}
    const boxes=[];
    for(const marker of [...this.markers,...this.highwayMarkers,...this.riverMarkers]){
      if(this.active||((this.highwayMarkers.includes(marker)||this.riverMarkers.includes(marker))&&!this.highways.visible)){marker.element.style.display='none';continue;}
      const p=marker.position.clone().project(this.camera);const w=this.element.clientWidth,h=this.element.clientHeight,x=(p.x*.5+.5)*w+(marker.offsetX||0),y=(-p.y*.5+.5)*h;
      const visible=p.z>-1&&p.z<1&&x>20&&x<w-20&&y>45&&y<h-(marker.destination?25:85);
      const width=marker.element.offsetWidth||90;const rect={x:x-width/2,y:y-25,w:width,h:32};const overlap=boxes.some(b=>rect.x<b.x+b.w&&rect.x+rect.w>b.x&&rect.y<b.y+b.h&&rect.y+rect.h>b.y);
      marker.element.style.display=visible&&!overlap?'flex':'none';marker.element.style.left=`${x}px`;marker.element.style.top=`${y}px`;if(visible&&!overlap)boxes.push(rect);
    }
    this.renderer.render(this.scene,this.camera);
  }
}
