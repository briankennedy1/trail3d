import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {OverviewRouteStripes,OVERVIEW_STRIPE_PX} from '../src/overview-route-stripes.js';

test('shared lines use one outline and screen-distance stripes that follow zoom without time animation',()=>{
  const positions=[];for(let x=0;x<=1.001;x+=.02)positions.push(x,0,0);
  const network=new OverviewRouteStripes();
  network.setRoutes([{id:'a',positions},{id:'b',positions}]);
  assert.equal(network.batches.length,1);
  assert.equal(network.group.children.length,2,'one outline and one striped core');
  assert.deepEqual(network.batches[0].ids,['a','b']);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
  camera.position.set(0,10,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  network.update(camera,1000,1000);
  const end=network.batches[0].geometry.getAttribute('instanceStripeEnd');
  const length=end.array.at(-1),version=end.version;
  assert.ok(Math.abs(length-500)<.01);
  network.update(camera,1000,1000);
  assert.equal(end.version,version,'stationary camera does not rewrite stripe phase');
  camera.zoom=2;camera.updateProjectionMatrix();network.update(camera,1000,1000);
  assert.ok(Math.abs(end.array.at(-1)-length*2)<.01,'twice the projected length produces twice the stripe count');
  assert.equal(OVERVIEW_STRIPE_PX,9);
  network.setRoutes([{id:'b',positions}]);
  assert.equal(network.batches[0].geometry.getAttribute('instanceStripeEnd'),undefined,'filtering to one route restores a solid line');
  network.clear();assert.equal(network.group.children.length,0);
});

test('shared runs retain their screen-space phase after a unique approach',()=>{
  const positions=[];for(let i=0;i<=50;i++)positions.push(i/50,0,0);
  const network=new OverviewRouteStripes();
  network.setRoutes([{id:'a',positions},{id:'b',positions:positions.slice(20*3)}]);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
  camera.position.set(0,10,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  network.update(camera,1000,1000);
  const shared=network.batches.find(batch=>batch.ids.length===2);
  assert.ok(shared.runs[0].phaseKm>.35);
  assert.ok(Math.abs(shared.geometry.getAttribute('instanceStripeStart').array[0]-shared.runs[0].phaseKm*500)<.01);
  network.clear();
});

test('joins stay connected through bends and changes in shared-route membership',()=>{
  const positions=[];for(let i=0;i<=50;i++)positions.push(i/50,0,i>25?(i-25)/100:0);
  const network=new OverviewRouteStripes();
  network.setRoutes([{id:'a',positions},{id:'b',positions:positions.slice(20*3,40*3)}]);
  let capped=0,joined=0;
  for(const batch of network.batches){
    const geometry=batch.geometry,joins=geometry.getAttribute('instanceJoins');
    const start=geometry.getAttribute('instanceStart'),end=geometry.getAttribute('instanceEnd');
    const previous=geometry.getAttribute('instancePrevious'),next=geometry.getAttribute('instanceNext');
    for(let i=0;i<joins.count;i++){
      if(joins.getX(i)){joined++;assert.ok(previous.getX(i)<start.getX(i),'start miter follows the preceding path segment');}else capped++;
      if(joins.getY(i)){joined++;assert.ok(next.getX(i)>end.getX(i),'end miter follows the next path segment');}else capped++;
    }
  }
  assert.ok(network.batches.some(batch=>batch.ids.length===2));
  assert.ok(joined>50);
  assert.equal(capped,2,'only the complete path endpoints have caps, including across batch boundaries');
  network.clear();
});

test('independent routes keep their endcaps even when they meet at one point',()=>{
  const network=new OverviewRouteStripes();
  network.setRoutes([{id:'a',positions:[-.1,0,0,0,0,0]},{id:'b',positions:[0,0,0,0,0,.1]}]);
  const caps=network.batches.reduce((count,batch)=>count+[...batch.geometry.getAttribute('instanceJoins').array].filter(join=>!join).length,0);
  assert.equal(caps,4,'a crossing or separate route start is not spliced into another route');
  network.clear();
});
