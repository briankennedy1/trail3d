import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fitRideHome} from '../../src/ride-home-framing.ts';

test('automatic home fits wide and tall terrain clear of desktop and mobile cards',()=>{
  const home={position:[-180,160,-370],target:[0,0,0],zoom:1.27};
  for(const [width,height,frame] of [
    [1280,720,{left:16,right:864,top:105,bottom:696}],
    [390,844,{left:16,right:374,top:100,bottom:330}],
  ])for(const [x,y,z] of [[100,30,50],[30,65,100]]){
    const points=[];for(const px of [-x,x])for(const py of [-20,y])for(const pz of [-z,z])points.push(new THREE.Vector3(px,py,pz));
    const view=fitRideHome(home,points,2,{width,height,...frame});
    const camera=new THREE.OrthographicCamera(-58*width/height,58*width/height,58,-58,.1,3000);
    camera.position.fromArray(view.position);camera.lookAt(new THREE.Vector3(...view.target));camera.zoom=view.zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld();
    for(const point of points){
      const projected=point.clone().project(camera),sx=(projected.x+1)*width/2,sy=(1-projected.y)*height/2;
      assert.ok(sx>=frame.left&&sx<=frame.right,`x ${sx} outside frame`);
      assert.ok(sy>=frame.top&&sy<=frame.bottom,`y ${sy} outside frame`);
    }
    assert.deepEqual(home,{position:[-180,160,-370],target:[0,0,0],zoom:1.27});
  }
});
