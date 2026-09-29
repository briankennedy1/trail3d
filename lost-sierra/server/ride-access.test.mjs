import test from 'node:test';
import assert from 'node:assert/strict';
import {routeStartParkingLinks} from '../src/ride-access.js';

test('start flags follow the parking field while other landmarks keep their links',()=>{
  const start={name:'Route start',latitude:39.84,longitude:-120.85,url:'https://www.trailforks.com/ridelog/view/80488775/'};
  const peak={...start,name:'Buzzard Roost Ridge',url:'https://www.peakbagger.com/'};
  const parking='https://maps.app.goo.gl/dMWgUQ9zvk9EmSez5';
  assert.deepEqual(routeStartParkingLinks([start,peak],parking),[{...start,url:parking},peak]);
  assert.match(start.url,/trailforks/); // Do not mutate CMS data.
});

test('unconfigured start and trailhead flags open Google Maps coordinates',()=>{
  for(const name of ['Route start','Route start / finish','Chapman Creek Trailhead']){
    const [point]=routeStartParkingLinks([{name,latitude:39.84,longitude:-120.85,url:'https://www.trailforks.com/'}]);
    assert.equal(point.url,'https://www.google.com/maps/search/?api=1&query=39.84,-120.85');
  }
});

test('existing Google Maps place links are preserved when parking is blank',()=>{
  const point={name:'Route start',latitude:39.84,longitude:-120.85,url:'https://maps.app.goo.gl/dMWgUQ9zvk9EmSez5'};
  assert.deepEqual(routeStartParkingLinks([point],''),[point]);
});

test('point-to-point rides get green start and red finish flags with separate parking links',async()=>{
  const {routeEndpointFlags,START_FLAG_COLOR,FINISH_FLAG_COLOR}=await import('../src/ride-access.js');
  const peak={name:'Peak',latitude:39.81,longitude:-120.85,color:'#ed8b23',url:'https://www.peakbagger.com/'};
  const points=[{name:'Route start',latitude:39.8,longitude:-120.88,color:'#123456'},peak];
  const entry={startMapsUrl:'https://maps.app.goo.gl/start',finishMapsUrl:'https://maps.app.goo.gl/finish'};
  const coordinates=[[-120.88,39.8],[-120.85,39.84]];
  const flags=routeEndpointFlags(points,entry,coordinates,false);
  assert.equal(flags[0].color,START_FLAG_COLOR);assert.equal(flags[0].url,entry.startMapsUrl);
  const finish=flags.find(p=>p.name==='Route Finish');
  assert.equal(finish.color,FINISH_FLAG_COLOR);assert.equal(finish.url,entry.finishMapsUrl);
  assert.equal(finish.latitude,39.84);assert.deepEqual(flags[1],peak);
  assert.equal(points[0].color,'#123456');
  const loop=routeEndpointFlags(points,entry,coordinates,true);
  assert.equal(loop[0].name,'Route Start / Finish');assert.equal(loop.length,2);
});
