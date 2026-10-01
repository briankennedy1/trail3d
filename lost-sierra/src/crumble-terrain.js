import * as THREE from 'three';
import { TERRAIN_FRAG, SIDE_FRAG } from './terrain-shaders.js';
import { ARRIVAL_BLOOM } from '../../src/arrival-bloom.ts';

// The regional landscape breaks into irregular, rock-like pieces around a
// focus. Pieces are baked into two meshes and animated on the GPU, so the
// whole landscape is a couple of draw calls and every piece moves smoothly.

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function hash(i,j,k){let h=Math.imul(i|0,374761393)^Math.imul(j|0,668265263)^Math.imul(k|0,1274126177);h=Math.imul(h^(h>>>13),1103515245);return ((h^(h>>>16))>>>0)/4294967296;}
function noise(x,z,k){const i=Math.floor(x),j=Math.floor(z),u=x-i,v=z-j,su=u*u*(3-2*u),sv=v*v*(3-2*v);const a=hash(i,j,k),b=hash(i+1,j,k),c=hash(i,j+1,k),d=hash(i+1,j+1,k);return a+(b-a)*su+(c-a)*sv+(a-b-c+d)*su*sv;}

// Pieces are smallest where the land breaks away and grow with distance.
const LEVELS=[1.15,2.3,4.6,9.2];
const pieceSize=distance=>clamp(1.15+distance*.16,1.15,9.2);

const CRUMBLE=/* glsl */`
uniform float uProgress;  // 0 intact .. 1 gone
uniform float uRebuild;   // 0: break away from the focus outward; 1: rebuild from it outward
uniform float uReach;
uniform float uDrop;
uniform vec2 uFocusMin;
uniform vec2 uFocusMax;
uniform float uFocusRadius;
uniform float uFloor;
attribute vec3 aPivot;
attribute float aSeed;
varying float vGone;
varying float vCore;
vec3 rotateAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
// crest: the lower top of a wall edge, or -1 for the top surface.
void crumble(inout vec3 p, inout vec3 n, float crest) {
  vGone = 0.0;
  vCore = aSeed < 0.0 ? 1.0 : 0.0;
  if (aSeed < 0.0) return;
  vec2 away = aPivot.xz - clamp(aPivot.xz, uFocusMin, uFocusMax);
  float dist = max(length(away) - uFocusRadius, 0.0);
  vec2 dir = length(away) > 1e-4 ? normalize(away) : vec2(cos(aSeed * 6.2832), sin(aSeed * 6.2832));
  float r1 = fract(aSeed * 7.31), r2 = fract(aSeed * 13.7), r3 = fract(aSeed * 3.19);
  // A front of breaking ground travels away from the focus, a little ragged.
  float order = pow(clamp(dist / uReach, 0.0, 1.0), 0.6);
  order = mix(order, 1.0 - order, uRebuild);
  const float SPREAD = 0.55;
  float start = clamp(order + (r1 - 0.5) * 0.14, 0.0, 1.0) * SPREAD;
  float t = clamp((uProgress - start) / (1.0 - SPREAD), 0.0, 1.0);
  if (t <= 0.0) return;
  // The ground cracks and settles, then drops under gravity, toppling
  // outward over its broken edge. Played backward, it rises and settles home.
  float crack = smoothstep(0.0, 0.14, t);
  // A deep column of rock would streak as it sinks: it crumbles from below
  // into a thin slab of ground instead.
  if (crest > -0.5 && p.y < uFloor + 0.001) p.y = mix(p.y, crest - 0.25, smoothstep(0.06, 0.5, t));
  float fall = max(t - 0.08, 0.0) / 0.92;
  fall *= fall;
  vec3 outward = vec3(dir.x, 0.0, dir.y);
  vec3 axis = normalize(cross(vec3(0.0, 1.0, 0.0), outward));
  float tilt = 0.01 * crack + (0.22 + 0.2 * r2) * fall;
  float spin = (r3 - 0.5) * 0.45 * fall;
  vec3 local = rotateAxis(rotateAxis(p - aPivot, vec3(0.0, 1.0, 0.0), spin), axis, tilt);
  n = rotateAxis(rotateAxis(n, vec3(0.0, 1.0, 0.0), spin), axis, tilt);
  p = aPivot + local + outward * (0.025 * crack + uDrop * 0.07 * fall)
    - vec3(0.0, 0.04 * crack + uDrop * (0.8 + 0.4 * r2) * fall, 0.0);
  // Wash away into the paper as it sinks (see finish()).
  vGone = smoothstep(0.04, 1.0, fall);
}
`;

const TOP_VERT=/* glsl */`
attribute float aEle;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vScene;
varying vec2 vUv;
varying float vDepth;
varying float vEle;
${CRUMBLE}
void main() {
  vUv = uv;
  vDepth = 0.0;
  vEle = aEle;
  vec3 p = position, n = normal;
  crumble(p, n, -1.0);
  vNormal = n;
  // Paint is fixed to the ground at rest, so it travels with each piece.
  vWorld = position * 10.0;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vScene = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SIDE_VERT=/* glsl */`
attribute float aTop;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vScene;
varying float vTop;
${CRUMBLE}
void main() {
  vTop = aTop * 10.0;
  vec3 p = position, n = normal;
  crumble(p, n, aTop);
  vNormal = n;
  vWorld = position * 10.0;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vScene = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Falling pieces wash out of the painting in ragged blooms, paling at the
// wet edge, while the rest stays opaque. The static core gives way to the
// arriving detailed terrain (see ARRIVAL_BLOOM). `paper` is the paint's
// fixed surface coordinate, so the wash travels with each piece.
const finish=(fragment,paper,pale)=>`varying float vGone;\nvarying float vCore;\nvarying vec3 vScene;\n${ARRIVAL_BLOOM}\n`+fragment.replace(/}\s*$/,`
  if (vCore > 0.5 && arrived(vScene)) discard;
  if (vGone > 0.0) {
    vec2 paper = ${paper};
    float wash = 0.72 * vnoise(paper / 7.0) + 0.28 * vnoise(paper / 2.4 + 7.3);
    float reach = vGone * 1.25 - 0.12;
    if (wash < reach) discard;
    float wet = 1.0 - smoothstep(0.0, 0.08, wash - reach);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, PAPER, clamp(${pale} * vGone + 0.5 * wet, 0.0, 1.0));
  }
}`);

export function crumbleUniforms(){
  return {uProgress:{value:0},uRebuild:{value:0},uReach:{value:1},uDrop:{value:6},uArrival:{value:0},
    uFocusMin:{value:new THREE.Vector2()},uFocusMax:{value:new THREE.Vector2()},uFocusRadius:{value:0},uFloor:{value:0}};
}

export function crumbleMaterials(uniforms,mask,lightDir,base){
  const top=new THREE.ShaderMaterial({vertexShader:TOP_VERT,fragmentShader:finish(TERRAIN_FRAG,'vWorld.xz','0.35'),
    uniforms:{...uniforms,uMask:{value:mask},uLightDir:{value:lightDir},uFocus:{value:0}}});
  const side=new THREE.ShaderMaterial({vertexShader:SIDE_VERT,fragmentShader:finish(SIDE_FRAG,'vec2(vWorld.x + vWorld.z, vWorld.y)','0.8'),side:THREE.DoubleSide,
    uniforms:{...uniforms,uBase:{value:base*10},uLightDir:{value:lightDir},uFocus:{value:0}}});
  return {top,side};
}

// focus: null (intact), {rect:{minX,minZ,maxX,maxZ}} with an exact cut along
// the rectangle, or {circle:{x,z,radius}} keeping an island of whole pieces.
export function buildCrumble(d,{X,Z,EX,base,focus=null}){
  const west=d.bbox.west,north=d.bbox.north;
  const dx=(d.bbox.east-west)/(d.width-1)*X,dz=(north-d.bbox.south)/(d.height-1)*Z;
  const x0=(west+120.6)*X,z0=(39.835-north)*Z;
  const rect=focus?.rect,circle=focus?.circle;
  // Grid lines at the rectangle's edges, so the cut matches the detailed terrain.
  const axis=(count,extra)=>{const lines=[...Array(count).keys()];for(const f of extra)if(f>0&&f<count-1&&lines.every(l=>Math.abs(l-f)>.02))lines.push(f);return Float64Array.from(lines).sort();};
  const cols=axis(d.width,rect?[(rect.minX-x0)/dx,(rect.maxX-x0)/dx]:[]),rows=axis(d.height,rect?[(rect.minZ-z0)/dz,(rect.maxZ-z0)/dz]:[]);
  const nc=cols.length,nr=rows.length;
  const at=(i,j)=>d.data[clamp(j,0,d.height-1)*d.width+clamp(i,0,d.width-1)];
  const bilinear=(f,g)=>{f=clamp(f,0,d.width-1);g=clamp(g,0,d.height-1);const i=Math.min(Math.floor(f),d.width-2),j=Math.min(Math.floor(g),d.height-2),u=f-i,v=g-j;return (at(i,j)*(1-u)*(1-v)+at(i+1,j)*u*(1-v)+at(i,j+1)*(1-u)*v+at(i+1,j+1)*u*v)/d.scale;};
  // Same triangle split as the overview mesh, so routes stay on the ground.
  const surface=(f,g)=>{const i=Math.min(Math.floor(f),d.width-2),j=Math.min(Math.floor(g),d.height-2),u=f-i,v=g-j,a=at(i,j),b=at(i+1,j),c=at(i,j+1),e=at(i+1,j+1);return (u+v<=1?a+(b-a)*u+(c-a)*v:e+(c-e)*(1-u)+(b-e)*(1-v))/d.scale;};
  const n=nc*nr,gx=new Float32Array(n),gy=new Float32Array(n),gz=new Float32Array(n),ge=new Float32Array(n),gn=new Float32Array(n*3),gu=new Float32Array(n*2);
  for(let r=0;r<nr;r++)for(let c=0;c<nc;c++){
    const k=r*nc+c,f=cols[c],g=rows[r],e=surface(f,g);
    gx[k]=x0+f*dx;gz[k]=z0+g*dz;gy[k]=e/1000*EX;ge[k]=e;gu[k*2]=f/(d.width-1);gu[k*2+1]=1-g/(d.height-1);
    const nx=-(bilinear(f+1,g)-bilinear(f-1,g))/1000*EX/(2*dx),nz=-(bilinear(f,g+1)-bilinear(f,g-1))/1000*EX/(2*dz),len=Math.hypot(nx,1,nz);
    gn[k*3]=nx/len;gn[k*3+1]=1/len;gn[k*3+2]=nz/len;
  }

  // Distance from where the ground breaks away.
  const edgeDistance=rect?(x,z)=>Math.hypot(Math.max(rect.minX-x,0,x-rect.maxX),Math.max(rect.minZ-z,0,z-rect.maxZ))
    :circle?(x,z)=>Math.abs(Math.hypot(x-circle.x,z-circle.z)-circle.radius):()=>0;
  // Seeds on jittered grids of several sizes; each grid cell holds a seed
  // only where its size suits the distance from the break.
  const minX=x0-dx,minZ=z0-dz,spanX=(nc+2)*dx,spanZ=(nr+2)*dz;
  const levels=LEVELS.map((size,level)=>{
    const w=Math.ceil(spanX/size)+1,h=Math.ceil(spanZ/size)+1,sx=new Float32Array(w*h),sz=new Float32Array(w*h),live=new Uint8Array(w*h);
    for(let j=0;j<h;j++)for(let i=0;i<w;i++){
      const want=pieceSize(edgeDistance(minX+(i+.5)*size,minZ+(j+.5)*size));
      if((level>0&&want<size)||(level<LEVELS.length-1&&want>=size*2))continue;
      const k=j*w+i;live[k]=1;sx[k]=minX+(i+.15+.7*hash(i,j,level*2+1))*size;sz[k]=minZ+(j+.15+.7*hash(i,j,level*2+2))*size;
    }
    return {size,w,h,sx,sz,live};
  });
  const offsets=[];let total=0;for(const level of levels){offsets.push(total);total+=level.w*level.h;}
  const seedX=new Float32Array(total),seedZ=new Float32Array(total);
  levels.forEach((level,l)=>{seedX.set(level.sx,offsets[l]);seedZ.set(level.sz,offsets[l]);});
  const nearest=(x,z)=>{
    // Wobble the boundaries so pieces break along ragged, natural lines.
    const amp=pieceSize(edgeDistance(x,z))*.32;
    x+=(noise(x/1.1,z/1.1,7)-.5+.5*(noise(x/.37,z/.37,9)-.5))*amp;z+=(noise(x/1.1,z/1.1,8)-.5+.5*(noise(x/.37,z/.37,10)-.5))*amp;
    let best=-1,bestD=Infinity;
    for(let ring=1;best<0;ring++)for(let l=0;l<levels.length;l++){
      const {size,w,h,sx,sz,live}=levels[l],ci=Math.floor((x-minX)/size),cj=Math.floor((z-minZ)/size);
      for(let j=Math.max(cj-ring,0);j<=Math.min(cj+ring,h-1);j++)for(let i=Math.max(ci-ring,0);i<=Math.min(ci+ring,w-1);i++){
        const k=j*w+i;if(!live[k])continue;
        const ex=sx[k]-x,ez=sz[k]-z,dd=ex*ex+ez*ez;if(dd<bestD){bestD=dd;best=offsets[l]+k;}
      }
    }
    return best;
  };

  // Assign every triangle to a piece; piece 0 is the static core.
  const triCount=(nc-1)*(nr-1)*2,triPiece=new Int32Array(triCount),pieceOf=new Map();
  const corner=[[0,nc,1],[1,nc,nc+1]];
  for(let r=0;r<nr-1;r++)for(let c=0;c<nc-1;c++)for(let s=0;s<2;s++){
    const a=r*nc+c,[p,q,o]=corner[s],cx=(gx[a+p]+gx[a+q]+gx[a+o])/3,cz=(gz[a+p]+gz[a+q]+gz[a+o])/3;
    let piece=0;
    if(rect){if(cx<rect.minX||cx>rect.maxX||cz<rect.minZ||cz>rect.maxZ)piece=nearest(cx,cz)+1;}
    else if(circle){const seed=nearest(cx,cz);if(Math.hypot(seedX[seed]-circle.x,seedZ[seed]-circle.z)>=circle.radius)piece=seed+1;}
    if(piece&&!pieceOf.has(piece))pieceOf.set(piece,pieceOf.size+1);
    triPiece[(r*(nc-1)+c)*2+s]=piece?pieceOf.get(piece):0;
  }
  const pieces=pieceOf.size+1,sumX=new Float64Array(pieces),sumZ=new Float64Array(pieces),sumY=new Float64Array(pieces),count=new Float64Array(pieces);
  for(let t=0;t<triCount;t++){const piece=triPiece[t],quad=t>>1,c=quad%(nc-1),r=(quad-c)/(nc-1),a=r*nc+c,[p,q,o]=corner[t&1];
    sumX[piece]+=gx[a+p]+gx[a+q]+gx[a+o];sumZ[piece]+=gz[a+p]+gz[a+q]+gz[a+o];sumY[piece]+=gy[a+p]+gy[a+q]+gy[a+o];count[piece]+=3;}
  const pivots=new Float32Array(pieces*3),seeds=new Float32Array(pieces);
  let reach=1;
  for(let piece=0;piece<pieces;piece++){
    const x=sumX[piece]/count[piece],z=sumZ[piece]/count[piece];
    pivots.set([x,(sumY[piece]/count[piece]+base)/2,z],piece*3);
    seeds[piece]=piece?hash(piece,pieces,3):-1;
    if(piece)reach=Math.max(reach,rect?edgeDistance(x,z):Math.max(Math.hypot(x-circle.x,z-circle.z)-circle.radius,0));
  }

  // Top surface: grid vertices are shared within a piece and split between pieces.
  const top=new Buffers(n*1.15|0,[['position',3],['normal',3],['uv',2],['aEle',1],['aPivot',3],['aSeed',1]]);
  const first=new Int32Array(n).fill(-1),firstPiece=new Int32Array(n),extra=new Map(),index=new Uint32Array(triCount*3);
  const vertex=(k,piece)=>{
    if(first[k]>=0&&firstPiece[k]===piece)return first[k];
    if(first[k]>=0){const key=k*pieces+piece,known=extra.get(key);if(known!==undefined)return known;}
    const v=top.add(gx[k],gy[k],gz[k],gn[k*3],gn[k*3+1],gn[k*3+2],gu[k*2],gu[k*2+1],ge[k],pivots[piece*3],pivots[piece*3+1],pivots[piece*3+2],seeds[piece]);
    if(first[k]<0){first[k]=v;firstPiece[k]=piece;}else extra.set(k*pieces+piece,v);
    return v;
  };
  // Walls wherever a triangle edge borders another piece or the map's edge.
  const side=new Buffers(65536,[['position',3],['normal',3],['aTop',1],['aPivot',3],['aSeed',1]]),sideIndex=[];
  const wall=(k,m,piece,cx,cz)=>{
    let nx=gz[m]-gz[k],nz=gx[k]-gx[m];const len=Math.hypot(nx,nz)||1;nx/=len;nz/=len;
    if(nx*((gx[k]+gx[m])/2-cx)+nz*((gz[k]+gz[m])/2-cz)<0){nx=-nx;nz=-nz;}
    const crest=Math.min(gy[k],gy[m]),px=pivots[piece*3],py=pivots[piece*3+1],pz=pivots[piece*3+2],seed=seeds[piece],v=side.count;
    side.add(gx[k],gy[k],gz[k],nx,0,nz,crest,px,py,pz,seed);side.add(gx[m],gy[m],gz[m],nx,0,nz,crest,px,py,pz,seed);
    side.add(gx[m],base,gz[m],nx,0,nz,crest,px,py,pz,seed);side.add(gx[k],base,gz[k],nx,0,nz,crest,px,py,pz,seed);
    sideIndex.push(v,v+1,v+2,v,v+2,v+3);
  };
  const triAt=(r,c,s)=>r<0||c<0||r>=nr-1||c>=nc-1?-1:triPiece[(r*(nc-1)+c)*2+s];
  for(let r=0;r<nr-1;r++)for(let c=0;c<nc-1;c++){
    const a=r*nc+c,b=a+1,cc=a+nc,e=cc+1,t=(r*(nc-1)+c)*2,p1=triPiece[t],p2=triPiece[t+1];
    index[t*3]=vertex(a,p1);index[t*3+1]=vertex(cc,p1);index[t*3+2]=vertex(b,p1);
    index[t*3+3]=vertex(b,p2);index[t*3+4]=vertex(cc,p2);index[t*3+5]=vertex(e,p2);
    const c1x=(gx[a]+gx[cc]+gx[b])/3,c1z=(gz[a]+gz[cc]+gz[b])/3,c2x=(gx[b]+gx[cc]+gx[e])/3,c2z=(gz[b]+gz[cc]+gz[e])/3;
    if(triAt(r,c-1,1)!==p1)wall(a,cc,p1,c1x,c1z);
    if(triAt(r-1,c,1)!==p1)wall(b,a,p1,c1x,c1z);
    if(p1!==p2){wall(cc,b,p1,c1x,c1z);wall(b,cc,p2,c2x,c2z);}
    if(triAt(r+1,c,0)!==p2)wall(cc,e,p2,c2x,c2z);
    if(triAt(r,c+1,0)!==p2)wall(e,b,p2,c2x,c2z);
  }
  const topGeometry=top.geometry();topGeometry.setIndex(new THREE.BufferAttribute(index,1));
  const sideGeometry=side.geometry();sideGeometry.setIndex(sideIndex);
  const focusMin=rect?[rect.minX,rect.minZ]:circle?[circle.x,circle.z]:[0,0],focusMax=rect?[rect.maxX,rect.maxZ]:focusMin;
  return {top:topGeometry,side:sideGeometry,base,reach,focusMin,focusMax,radius:circle?.radius??0,pieces:pieces-1};
}

// Interleaved, growable vertex storage.
class Buffers{
  constructor(capacity,layout){this.layout=layout;this.stride=layout.reduce((sum,[,size])=>sum+size,0);this.count=0;this.data=new Float32Array(capacity*this.stride);}
  // Fixed arity keeps this hot path free of allocations.
  add(a,b,c,d,e,f,g,h,i,j,k,l,m){
    const o=this.count*this.stride;
    if(o+13>this.data.length){const next=new Float32Array(this.data.length*2);next.set(this.data);this.data=next;}
    const v=this.data;v[o]=a;v[o+1]=b;v[o+2]=c;v[o+3]=d;v[o+4]=e;v[o+5]=f;v[o+6]=g;v[o+7]=h;v[o+8]=i;v[o+9]=j;v[o+10]=k;
    if(this.stride>11){v[o+11]=l;v[o+12]=m;}
    return this.count++;
  }
  geometry(){
    const geometry=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(this.data.slice(0,this.count*this.stride),this.stride);
    let offset=0;for(const [name,size] of this.layout){geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,size,offset));offset+=size;}
    return geometry;
  }
}

export function applyCrumble(uniforms,meshes,built){
  uniforms.uReach.value=built.reach;uniforms.uFloor.value=built.base;
  uniforms.uFocusMin.value.set(...built.focusMin);uniforms.uFocusMax.value.set(...built.focusMax);uniforms.uFocusRadius.value=built.radius;
  for(const [mesh,geometry] of [[meshes.top,built.top],[meshes.side,built.side]]){mesh.geometry.dispose();mesh.geometry=geometry;}
}
