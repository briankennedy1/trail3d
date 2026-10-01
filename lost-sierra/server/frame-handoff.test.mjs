import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameHandoff} from '../src/frame-handoff.js';
import {Diorama} from '../src/diorama.js';
import * as THREE from 'three';
import {buildCrumble} from '../src/crumble-terrain.js';
import {arrivalAt} from '../../src/arrival-bloom.ts';

function fixture(){
  const children=[];
  const host={append(frame){children.push(frame);}};
  const snapshot=()=>{
    let finish;
    const frame={removed:false,animate(){
      const animation={finished:new Promise(resolve=>{finish=resolve;}),cancel(){finish();},finish(){finish();}};
      frame.animation=animation;return animation;
    },remove(){frame.removed=true;children.splice(children.indexOf(frame),1);}};
    return {frame};
  };
  return {handoff:new FrameHandoff(host),children,snapshot};
}

test('a replacement retains one painted map until its reveal completes',async()=>{
  const {handoff,children,snapshot}=fixture(),old=snapshot();
  handoff.hold(old);
  const revealing=handoff.reveal();
  assert.deepEqual(children,[old.frame]);assert.equal(old.frame.removed,false);
  old.frame.animation.finish();await revealing;
  assert.deepEqual(children,[]);assert.equal(handoff.current,null);
});

test('rapid selections reuse the held frame and a canceled dissolve cannot remove it',async()=>{
  const {handoff,children,snapshot}=fixture(),old=snapshot();
  handoff.hold(old);const obsoleteReveal=handoff.reveal();
  assert.equal(handoff.hold(),old);await obsoleteReveal;
  assert.deepEqual(children,[old.frame]);assert.equal(old.frame.removed,false);
  await handoff.reveal(true);
  assert.deepEqual(children,[]);
});

test('a newer painted frame replaces the old one without leaving layered stale frames',async()=>{
  const {handoff,children,snapshot}=fixture(),old=snapshot(),next=snapshot();
  handoff.hold(old);const obsoleteReveal=handoff.reveal();
  handoff.hold(next);await obsoleteReveal;
  assert.equal(old.frame.removed,true);assert.deepEqual(children,[next.frame]);
  await handoff.reveal(true);assert.deepEqual(children,[]);
});

// A small sloping landscape in the regional dataset format.
function region(){
  const width=48,height=48,data=new Uint16Array(width*height);
  for(let j=0;j<height;j++)for(let i=0;i<width;i++)data[j*width+i]=(1500+i*7+j*5+40*Math.sin(i*.4)*Math.cos(j*.3))*4;
  return {bbox:{west:-120.7,east:-120.5,south:39.75,north:39.9},width,height,scale:4,data};
}
const X=111.32*Math.cos(39.835*Math.PI/180),Z=111.32,EX=2.3,world=(lon,lat)=>[(lon+120.6)*X,(39.835-lat)*Z];

test('the regional ground breaks exactly along the detailed ride terrain',()=>{
  const [minX,minZ]=world(-120.63,39.84),[maxX,maxZ]=world(-120.57,39.8);
  const built=buildCrumble(region(),{X,Z,EX,base:.345,focus:{rect:{minX,minZ,maxX,maxZ}}});
  const position=built.top.attributes.position,seed=built.top.attributes.aSeed,pivot=built.top.attributes.aPivot,index=built.top.index.array;
  assert.ok(built.pieces>3,'The surrounding land breaks into several pieces');
  const inside=(x,z)=>x>=minX-1e-4&&x<=maxX+1e-4&&z>=minZ-1e-4&&z<=maxZ+1e-4;
  for(let t=0;t<index.length;t+=3){
    const v=[index[t],index[t+1],index[t+2]],core=seed.getX(v[0])<0;
    for(const k of v){
      assert.equal(seed.getX(k)<0,core,'A triangle belongs to one piece');
      assert.equal(pivot.getX(k),pivot.getX(v[0]));
      // Static ground lies inside the ride rectangle; nothing outside stays.
      if(core)assert.ok(inside(position.getX(k),position.getZ(k)));
    }
    if(!core){const cx=(position.getX(v[0])+position.getX(v[1])+position.getX(v[2]))/3,cz=(position.getZ(v[0])+position.getZ(v[1])+position.getZ(v[2]))/3;assert.ok(!inside(cx,cz)||cx===minX||cx===maxX||cz===minZ||cz===maxZ);}
  }
  assert.ok(built.side.index.count>0,'Broken edges get rock walls');
});

test('the departing regional ground stays opaque and depth-tested during the ride handoff',()=>{
  const map={bbox:{west:-120.63,east:-120.57,south:39.8,north:39.84}};
  const diorama={region:region(),lakeMask:new THREE.Texture(),topMat:{uniforms:{uLightDir:{value:new THREE.Vector3(0,1,0)}}},rideAnchor:()=>new THREE.Vector3()};
  const context=Diorama.prototype.rideContext.call(diorama,map);
  const meshes=context.group.children;
  assert.equal(meshes.length,2);
  for(const progress of [0,.1,.3,.6,1]){
    context.update(progress);
    for(const mesh of meshes){
      assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.depthWrite,true);
      assert.equal(mesh.material.uniforms.uProgress.value,progress);
      // The core hands each pixel to the detailed terrain on the same schedule.
      assert.equal(mesh.material.uniforms.uArrival.value,arrivalAt(progress));
      assert.equal(mesh.material.uniforms.uRebuild.value,0);
    }
  }
  context.dispose();
  // Returning rebuilds outward from the ride, unless it interrupts the entry.
  const back=Diorama.prototype.rideContext.call(diorama,map,{rebuild:true});back.update(1);back.update(.4);
  assert.equal(back.group.children[0].material.uniforms.uRebuild.value,1);back.dispose();
  const early=Diorama.prototype.rideContext.call(diorama,map,{rebuild:true});early.update(.6);early.update(.3);
  assert.equal(early.group.children[0].material.uniforms.uRebuild.value,0);early.dispose();
});
