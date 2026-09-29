import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Diorama} from '../src/diorama.js';

test('route label stem stays attached to rendered start through orbit and zoom',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({geometry:{coordinates:[[-120.5,39.8],[-120.45,39.75],[-120.4,39.7]]}})});
  const map=Object.create(Diorama.prototype);
  Object.assign(map,{
    region:{bbox:{west:-121,east:-120,south:39,north:40},width:2,height:2,scale:1,data:new Uint16Array([1000,1500,1800,2000])},
    overviewRoute:new THREE.Group(),routePopup:{style:{},setAttribute(){}},
    element:{clientWidth:1280,clientHeight:720},camera:new THREE.OrthographicCamera(-70,70,40,-40,.05,1200),
  });
  try{await map.loadOverviewRoute({id:'test-ride',name:'Test ride'});}finally{globalThis.fetch=originalFetch;}
  const startAttribute=map.overviewRoute.children[0].geometry.attributes.instanceStart;
  const start=new THREE.Vector3().fromBufferAttribute(startAttribute,0);
  map.routePopupPoint=map.routeLabelAnchor;
  for(const angle of [0,.8,2.4,4.7])for(const zoom of [.65,1,4,12]){
    map.camera.position.set(Math.sin(angle)*100,70,Math.cos(angle)*100);
    map.camera.lookAt(0,3,0);map.camera.zoom=zoom;map.camera.updateProjectionMatrix();map.camera.updateMatrixWorld();
    map.positionRoutePopup();
    const projected=start.clone().project(map.camera);
    assert.ok(Math.abs(parseFloat(map.routePopup.style.left)-(projected.x*.5+.5)*1280)<.001);
    assert.ok(Math.abs(parseFloat(map.routePopup.style.top)+15-(-projected.y*.5+.5)*720)<.001);
  }
  for(const line of map.overviewRoute.children){line.geometry.dispose();line.material.dispose();}
});
