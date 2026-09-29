import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameHandoff} from '../src/frame-handoff.js';
import {Diorama} from '../src/diorama.js';
import * as THREE from 'three';

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

test('fading regional terrain cannot write invisible depth over the incoming landscape',()=>{
  const source=new THREE.ShaderMaterial({uniforms:{uMask:{value:new THREE.Texture()}},vertexShader:'vWorld = world.xyz * 10.0;',fragmentShader:'void main(){gl_FragColor=vec4(1.0);}'});
  const chunk=new THREE.Group();chunk.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),source));
  const context=Diorama.prototype.rideContext.call({rideAnchor:()=>new THREE.Vector3(),chunks:[{group:chunk,phase:0}]},{bbox:{west:-120.6,east:-120.59,south:39.835,north:39.84}});
  const copy=context.group.children[0].children[0];
  for(const progress of [0,.1,.2,.5,.9,1]){
    context.update(progress);
    assert.equal(copy.material.depthWrite,false);assert.equal(copy.renderOrder,-20);
  }
  assert.equal(source.depthWrite,true,'Borrowed overview material must be unchanged');
  context.dispose();chunk.children[0].geometry.dispose();source.dispose();
});
