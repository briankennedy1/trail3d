import test from 'node:test';
import assert from 'node:assert/strict';
import { availableContextLabels, coordinatesMapsUrl } from '../src/admin-labels.js';

test('CMS suggests context labels intersecting the padded track even when endpoints are outside',()=>{
  const track={geometry:{coordinates:[[-120.60,39.70],[-120.59,39.71]]}};
  const feature=(name,kind,coordinates,className='river')=>({properties:{name,kind,class:className},geometry:{type:'LineString',coordinates}});
  const source={features:[
    feature('Crossing Road','road',[[-120.7,39.705],[-120.5,39.705]],'primary'),
    feature('Crossing Road','road',[[-120.62,39.7],[-120.58,39.7]],'primary'),
    feature('Nearby Creek','waterway',[[-120.62,39.706],[-120.58,39.706]]),
    feature('Far River','waterway',[[-120.9,39.9],[-120.8,39.9]]),
    feature('Forest Road 25N42','road',[[-120.7,39.705],[-120.5,39.705]],'primary'),
  ]};
  assert.deepEqual(availableContextLabels(source,track,{id:'test'}),['Crossing Road','Nearby Creek']);
  assert.deepEqual(availableContextLabels(source,track,{id:'buzzards-roost-ridge'}),['Crossing Road','Nearby Creek','To Laporte','To Quincy']);
  assert.deepEqual(availableContextLabels(source,track,{id:'mt-elwell-hard-way'}),['Crossing Road','Mill Pond','Nearby Creek']);
  assert.deepEqual(availableContextLabels(source,null,{id:'test'}),[]);
});

test('parking coordinate paste becomes a Google Maps URL and existing links are left alone',()=>{
  assert.equal(coordinatesMapsUrl(' 39.75, -120.6 '),'https://www.google.com/maps/search/?api=1&query=39.75,-120.6');
  assert.equal(coordinatesMapsUrl('https://maps.app.goo.gl/example'),null);
  assert.equal(coordinatesMapsUrl('93, -120.6'),null);
  assert.equal(coordinatesMapsUrl('39.75, -181'),null);
  assert.equal(coordinatesMapsUrl('39.75 -120.6'),null);
});
