import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyContextLabels,restrictContextLabelsToRoute} from '../src/context-labels.js';
import {rideContextForMap} from '../../src/ride-context-data.ts';
import {regionalRideData} from '../src/ride-data.js';

const map={bbox:{west:0,east:1,south:0,north:1},widthM:1000,heightM:1000,lakes:[]};
const feature=(name,lines,extra={})=>({name,kind:'road',importance:1,length:1000,lines,...extra});

test('labels require actual route contact, including crossings between GPS vertices',()=>{
  const features=[
    feature('Crossing',[[[500,0],[500,1000]]]),
    feature('Endpoint',[[[100,500],[100,300]]]),
    feature('Nearby',[[[100,520],[900,520]]]),
    feature('Elsewhere in terrain',[[[100,100],[900,100]]]),
  ];
  restrictContextLabelsToRoute(features,[[100,500],[900,500]],map);
  assert.deepEqual(features.map(f=>f.showLabel),[true,true,false,false]);
  assert.deepEqual(features[3].lines,[[[100,100],[900,100]]],'Geographic context remains intact');
});

test('small mapping offsets, collinear overlap and repeated GPS points are handled',()=>{
  const features=[
    feature('Offset',[[[200,508],[800,508]]]),
    feature('Too far',[[[200,511],[800,511]]]),
    feature('Overlap',[[[300,500],[600,500]]]),
    feature('Off endpoint',[[[911,500],[950,500]]]),
  ];
  restrictContextLabelsToRoute(features,[[100,500],[100,500],[900,500]],map);
  assert.deepEqual(features.map(f=>f.showLabel),[true,false,true,false]);
});

test('show-all and named selections cannot restore labels outside the route',()=>{
  for(const setting of [{mode:'all',names:[]},{mode:'only',names:['Unrelated']}]){
    const features=[feature('Unrelated',[[[100,100],[900,100]]])];
    applyContextLabels(features,setting);
    restrictContextLabelsToRoute(features,[[100,500],[900,500]],map);
    assert.equal(features[0].showLabel,false);
  }
  const features=[feature('Hidden crossing',[[[500,0],[500,1000]]],{showLabel:false})];
  restrictContextLabelsToRoute(features,[[100,500],[900,500]],map);
  assert.equal(features[0].showLabel,false,'Explicit hiding is retained');
});

test('standalone place labels require contact, while named lakes use their shoreline',()=>{
  const features=[
    feature('At route',[],{labelCoordinates:[.5,.5]}),
    feature('Distant place',[],{labelCoordinates:[.5,.8]}),
    feature('Pond',[],{labelCoordinates:[.5,.8]}),
  ];
  const lakeMap={...map,lakes:[{name:'Pond',outer:[[400,500],[600,500],[600,900],[400,900]]}]};
  restrictContextLabelsToRoute(features,[[100,500],[900,500]],lakeMap);
  assert.deepEqual(features.map(f=>f.showLabel),[true,false,true]);
  restrictContextLabelsToRoute(features,[],lakeMap);
  assert.ok(features.every(f=>f.showLabel===false));
});

test('both Mt. Hough options remove unrelated creeks while retaining the climbing road',()=>{
  const root=new URL('../',import.meta.url);
  const source=JSON.parse(fs.readFileSync(new URL('public/terrain/ride-context.geojson',root)));
  for(const id of ['mt-hough-classic-loop','mt-hough-tollgate-option']){
    const track=JSON.parse(fs.readFileSync(new URL(`data/routes/${id}.geojson`,root)));
    const meta=JSON.parse(fs.readFileSync(new URL(`public/terrain/${id}/terrain.json`,root)));
    const binary=fs.readFileSync(new URL(`public/terrain/${id}/terrain.bin`,root));
    const {data}=regionalRideData(track,meta,new Uint16Array(binary.buffer,binary.byteOffset,binary.length/2));
    const features=rideContextForMap(source,data.map);
    restrictContextLabelsToRoute(features,data.ride.points,data.map);
    assert.equal(features.find(f=>f.name==='Mount Hough Road')?.showLabel,true,id);
    assert.equal(features.find(f=>f.name==='Taylor Creek')?.showLabel,false,id);
    assert.equal(features.find(f=>f.name==='Hough Creek')?.showLabel,false,id);
  }
});
