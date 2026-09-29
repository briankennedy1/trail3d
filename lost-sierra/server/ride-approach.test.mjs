import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameApproachTarget } from '../../src/ride-approach.ts';

// The regression was visible between endpoints: zoom overtook the geographic
// pan and threw Beckwourth off the screen. Check the entire projected path.
test('approach keeps the destination in frame across zoom, orbit, and screen shapes',()=>{
  for(const aspect of [561/765,1440/900])for(const x of [-170,120]){
    const from={position:new THREE.Vector3(x-530,780,-1050),target:new THREE.Vector3(x,0,-150),zoom:.055};
    const destination=new THREE.Vector3(-7.219,-2,-7.331);
    const toOffset=new THREE.Vector3(-73.69,69.642,-153.779).sub(destination);
    const fromOffset=from.position.clone().sub(from.target);
    const camera=new THREE.OrthographicCamera(-29*aspect,29*aspect,29,-29,.1,3000);
    camera.position.copy(from.position);camera.lookAt(from.target);camera.zoom=from.zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const start=destination.clone().project(camera);
    assert.ok(Math.abs(start.x)<1&&Math.abs(start.y)<1);
    for(let i=0;i<=100;i++){
      const t=i/100,zoom=Math.exp(THREE.MathUtils.lerp(Math.log(from.zoom),Math.log(1.2733),t));
      const offset=fromOffset.clone().lerp(toOffset,t);
      const target=frameApproachTarget(from.target.clone().lerp(destination,t),offset,zoom,t,from,destination,camera.up);
      camera.position.copy(target).add(offset);camera.lookAt(target);camera.zoom=zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld();
      const point=destination.clone().project(camera);
      assert.ok(Math.abs(point.x-start.x*(1-t))<1e-9);
      assert.ok(Math.abs(point.y-start.y*(1-t))<1e-9);
      assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1,'Destination left the viewport');
      if(i===0)assert.ok(target.distanceTo(from.target)<1e-9,'Starting camera jumped');
      if(i===100)assert.ok(target.distanceTo(destination)<1e-9,'Home camera changed');
    }
  }
});
