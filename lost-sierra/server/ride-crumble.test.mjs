import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {crumbleLandscape} from '../../src/ride-crumble.ts';
function terrain(){
 const group=new THREE.Group(),geometry=new THREE.PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);
 group.add(new THREE.Mesh(geometry,new THREE.ShaderMaterial()));return group;
}
test('identical terrain has no animated triangles',()=>{
 const group=terrain();crumbleLandscape(group).preserve([-10,10,-10,10]);
 const moving=group.children[0],fixed=group.children[1];
 assert.equal(moving.geometry.getAttribute('position').count,0);
 assert.equal(fixed.geometry.getAttribute('position').count,96);
 assert.equal(fixed.material.uniforms.uCrumble,undefined);
});
test('partial overlap moves only the outer strip and keeps shared terrain out of the crumble shader',()=>{
 for(const departing of [false,true]){
  const group=terrain(),update=crumbleLandscape(group,departing);update.preserve([-5,10,-10,10]);update(1);
  assert.equal((group.children[0]).geometry.getAttribute('position').count,24);
  if(departing)assert.equal(group.children.length,1);
  else {const fixed=group.children[1];assert.equal(fixed.geometry.getAttribute('position').count,72);assert.equal(fixed.material.uniforms.uCrumble,undefined);}
 }
});
