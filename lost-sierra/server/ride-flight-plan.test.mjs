import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFlightPlan } from '../../src/ride-flight-plan.ts';

test('default follow keeps the home heading while following terrain and the route',()=>{
  let home={position:[-80,70,-140],target:[5,0,10],zoom:1.2};
  let clearanceChecks=0;
  const plan=createFlightPlan({total:16000,orbitRadius:90,viewScale:1,introEnd:.25,
    getHome:()=>home,
    routePoint:d=>new THREE.Vector3(Math.min(16000,Math.max(0,d))/300,0,0),
    clearSightHeight:()=>{clearanceChecks++;return 50;},
  });
  const checkHeading=()=>{
    const expected=Math.atan2(home.position[0]-home.target[0],home.position[2]-home.target[2]);
    for(let i=0;i<=100;i++){
      const shot=plan.flightShot(i/100);
      assert.ok(Math.abs(shot.angle-expected)<1e-12,'Playback introduced an orbit');
      assert.ok(shot.height>=52.5,'Terrain clearance was lost');
    }
  };
  checkHeading();
  assert.ok(clearanceChecks>0);
  assert.ok(plan.flightShot(1).center.distanceTo(plan.flightShot(0).center)>20,'Camera stopped following');
  assert.equal(plan.timeAtProgress(1),16000/(1609.344/0.7));
  home={...home,position:[130,70,90]};
  plan.invalidate();
  checkHeading();
});

test('explicit ride camera angles still control the flight',()=>{
  const plan=createFlightPlan({total:16000,orbitRadius:90,viewScale:1,introEnd:.25,
    getHome:()=>({position:[-80,70,-140],target:[0,0,0],zoom:1.2}),
    routePoint:()=>new THREE.Vector3(),clearSightHeight:()=>0,
    angleBeats:[[0,-155.6],[.44,-20],[.54,0],[.60,75],[.72,120],[.85,170],[1,170]],
  });
  assert.ok(plan.flightShot(1).angle-plan.flightShot(0).angle>5,'Custom visibility orbit was lost');
  assert.equal(plan.timeAtProgress(1),16000/(1609.344/0.7));
});

test('ride length scales playback duration while timeline scrubbing stays reversible',()=>{
  const plans=[10,20,30].map(miles=>createFlightPlan({
    total:miles*1609.344,orbitRadius:90,viewScale:1,introEnd:.25,
    getHome:()=>({position:[-80,70,-140],target:[0,0,0],zoom:1.2}),
    routePoint:d=>new THREE.Vector3(d/300,0,0),clearSightHeight:()=>0,
  }));
  for(const [i,duration] of [7,14,21].entries()){
    const plan=plans[i];
    assert.ok(Math.abs(plan.timeAtProgress(1)-duration)<1e-10);
    assert.equal(plan.progressAtTime(duration),1);
    for(const progress of [.1,.5,.9])assert.ok(Math.abs(plan.progressAtTime(plan.timeAtProgress(progress))-progress)<.000001);
  }
});
