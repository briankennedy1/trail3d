import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectTrack, regionalRideData } from '../src/ride-data.js';
import { validateEntry } from './store.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
test('the shared adapter preserves the original cleaned Beckwourth geometry',()=>{
  const map=read('../../public/beckwourth/map.json'),original=read('../../public/beckwourth/ride.json');
  const track=read('../data/beckwourth-track.geojson');
  const bytes=fs.readFileSync(new URL('../../public/beckwourth/terrain.bin',import.meta.url));
  const ride=projectTrack(track,map,new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2));
  assert.equal(ride.points.length,original.points.length);
  for(let i=0;i<ride.points.length;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(ride.points[i][axis]-original.points[i][axis])<1e-7);
  assert.deepEqual(ride.points[0],ride.points.at(-1));
});
test('another ride gets its own terrain, home, elevation fallback and flags',()=>{
  const meta={bbox:{west:-121,east:-120.3,south:39.5,north:40.2},width:8,height:8,scale:4,source:'Test height field'};
  const raw=new Uint16Array(64).fill(6000);
  const track={geometry:{coordinates:[[-120.9,39.7],[-120.89,39.71]]}};
  const flag={name:'Test viewpoint',longitude:-120.88,latitude:39.705,color:'#c8613d'};
  const result=regionalRideData(track,meta,raw,[flag]);
  assert.ok(result.data.map.bbox.west<=-120.9&&result.data.map.bbox.east>=flag.longitude);
  assert.equal(result.data.ride.points[0][2],1500);
  assert.deepEqual(result.pointsOfInterest,[flag]);
  assert.equal(result.data.heights.byteLength,result.data.map.grid.width*result.data.map.grid.height*2);
  assert.equal(regionalRideData(track,meta,raw).pointsOfInterest.length,0);
  const moved=regionalRideData({geometry:{coordinates:[[-120.6,40],[-120.55,40.05]]}},meta,raw);
  assert.notDeepEqual(result.home,moved.home);
  assert.notDeepEqual(result.data.map.bbox,moved.data.map.bbox);
});
test('route settings accept named flags and reject unsafe links or invalid camera data',()=>{
  const entry={id:'test',kind:'ride',name:'Test',area:'Portola',status:'draft',coordinates:{lat:39.8,lng:-120.45}};
  const point={name:'Park',latitude:39.8,longitude:-120.45,color:'#34877b',url:'https://example.com/park'};
  const viewer={pointsOfInterest:[point],angleBeats:[[0,-155],[1,170]]};
  assert.deepEqual(validateEntry({...entry,viewer}).viewer,viewer);
  assert.throws(()=>validateEntry({...entry,viewer:{pointsOfInterest:[{...point,url:'javascript:alert(1)'}]}}));
  assert.throws(()=>validateEntry({...entry,viewer:{angleBeats:[[0,0],[.7,45],[.5,90],[1,180]]}}));
  assert.throws(()=>validateEntry({...entry,viewer:{home:{position:[NaN,0,0],target:[0,0,0],zoom:1}}}));
  assert.throws(()=>validateEntry({...entry,viewer:{data:{}}}));
});
test('per-ride context label settings validate exact names without changing legacy viewer settings',()=>{
  const entry={id:'test',kind:'ride',name:'Test',area:'Portola',status:'draft',coordinates:{lat:39.8,lng:-120.45}};
  const labels={mode:'only',names:['Gray Eagle Creek','Gold Lake Highway']};
  assert.deepEqual(validateEntry({...entry,viewer:{contextLabels:labels}}).viewer.contextLabels,labels);
  assert.deepEqual(validateEntry({...entry,viewer:{home:{position:[1,2,3],target:[0,0,0],zoom:1}}}).viewer.home.position,[1,2,3]);
  for(const contextLabels of [
    {mode:'only',names:[]},{mode:'hide',names:['']},{mode:'all',names:['Road']},
    {mode:'unknown',names:[]},{mode:'none',names:'Road'},{mode:'hide',names:[' Road']},
    {mode:'hide',names:['Road'],extra:true},
  ])assert.throws(()=>validateEntry({...entry,viewer:{contextLabels}}));
});
